import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { requireProductAccess, productIdsFor } from '../access.js';
import { notify, productAudience, adminIds } from '../notify.js';
import { ah, parse, zDate, today } from '../util.js';
import { PLATFORMS } from './accounts.js';

/* Content tasks: the Admin shares content + instructions, the manager publishes and reports back. */

export const productTasks = Router({ mergeParams: true });
export const myTasks = Router();

const TASK_SELECT = `
  SELECT t.*, p.name AS product_name, ua.name AS assigned_name, uc.name AS created_by_name, ud.name AS completed_by_name,
    (SELECT coalesce(json_agg(json_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size) ORDER BY f.id), '[]')
       FROM files f WHERE f.task_id = t.id) AS files,
    (SELECT coalesce(json_agg(json_build_object('id', x.id, 'platform', x.platform, 'url', x.url, 'posted_on', x.posted_on) ORDER BY x.posted_on), '[]')
       FROM posts x WHERE x.task_id = t.id) AS posts
  FROM tasks t
  JOIN products p ON p.id = t.product_id
  LEFT JOIN users ua ON ua.id = t.assigned_to
  LEFT JOIN users uc ON uc.id = t.created_by
  LEFT JOIN users ud ON ud.id = t.completed_by`;

const ORDER = `ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
  CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
  t.due_date NULLS LAST, t.id DESC`;

const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  caption: z.string().max(5000).nullish(),
  hashtags: z.string().max(1000).nullish(),
  instructions: z.string().max(5000).nullish(),
  platforms: z.array(z.enum(PLATFORMS)).max(20).default([]),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  due_date: zDate.or(z.literal('')).nullish(),
  assigned_to: z.number().int().positive().nullish(),
});

productTasks.use(requireProductAccess());

productTasks.get('/', ah(async (req, res) => {
  const status = ['todo', 'in_progress', 'done', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  res.json(
    await many(`${TASK_SELECT} WHERE t.product_id = $1 ${status ? 'AND t.status = $2' : ''} ${ORDER} LIMIT 300`,
      status ? [req.productId, status] : [req.productId])
  );
}));

productTasks.post('/', requireRole('admin'), ah(async (req, res) => {
  const b = parse(taskSchema, req.body);
  const t = await one(
    `INSERT INTO tasks (product_id, title, caption, hashtags, instructions, platforms, priority, due_date, assigned_to, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.productId, b.title, b.caption || null, b.hashtags || null, b.instructions || null, b.platforms, b.priority,
      b.due_date || null, b.assigned_to ?? null, req.user.id]
  );
  const product = await one('SELECT name FROM products WHERE id = $1', [req.productId]);
  const to = t.assigned_to ? [t.assigned_to] : await productAudience(req.productId);
  await notify(to, {
    kind: 'task', title: `New content to post for ${product.name}`, body: t.title,
    link: `/products/${req.productId}?tab=content&task=${t.id}`, productId: req.productId,
  }, req.user.id);
  await audit(req, 'task.created', 'task', t.id, { title: t.title, platforms: t.platforms }, req.productId);
  res.status(201).json(t);
}));

productTasks.put('/:taskId(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const b = parse(taskSchema, req.body);
  const prev = await one('SELECT * FROM tasks WHERE id = $1 AND product_id = $2', [Number(req.params.taskId), req.productId]);
  if (!prev) return res.status(404).json({ error: 'Task not found.' });
  const t = await one(
    `UPDATE tasks SET title=$2, caption=$3, hashtags=$4, instructions=$5, platforms=$6, priority=$7, due_date=$8,
       assigned_to=$9, updated_at=now() WHERE id=$1 RETURNING *`,
    [prev.id, b.title, b.caption || null, b.hashtags || null, b.instructions || null, b.platforms, b.priority, b.due_date || null, b.assigned_to ?? null]
  );
  if (t.assigned_to && t.assigned_to !== prev.assigned_to) {
    await notify([t.assigned_to], { kind: 'task', title: 'A task was assigned to you', body: t.title, link: `/products/${req.productId}?tab=content&task=${t.id}`, productId: req.productId }, req.user.id);
  }
  await audit(req, 'task.updated', 'task', t.id, { title: t.title }, req.productId);
  res.json(t);
}));

/** Status changes are what the manager does: start, mark posted (done), or reopen. */
productTasks.patch('/:taskId(\\d+)/status', requireRole('manager'), ah(async (req, res) => {
  const b = parse(z.object({
    status: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
    completion_note: z.string().max(2000).nullish(),
  }), req.body);
  if (b.status === 'cancelled' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the admin can cancel a task.' });
  const t = await one(
    `UPDATE tasks SET status=$3, updated_at=now(),
       completed_at = CASE WHEN $3 = 'done' THEN now() ELSE NULL END,
       completed_by = CASE WHEN $3 = 'done' THEN $4::int ELSE NULL END,
       completion_note = CASE WHEN $3 = 'done' THEN $5 ELSE completion_note END
     WHERE id=$1 AND product_id=$2 RETURNING *`,
    [Number(req.params.taskId), req.productId, b.status, req.user.id, b.completion_note || null]
  );
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  const product = await one('SELECT name FROM products WHERE id = $1', [req.productId]);
  if (b.status === 'done') {
    await notify(await productAudience(req.productId), {
      kind: 'done', title: `Posted: ${t.title}`, body: `${req.user.name} marked this as published for ${product.name}.`,
      link: `/products/${req.productId}?tab=content&task=${t.id}`, productId: req.productId,
    }, req.user.id);
  }
  await audit(req, `task.${b.status}`, 'task', t.id, { title: t.title }, req.productId);
  res.json(t);
}));

productTasks.delete('/:taskId(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const t = await one('DELETE FROM tasks WHERE id = $1 AND product_id = $2 RETURNING title', [Number(req.params.taskId), req.productId]);
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  await audit(req, 'task.deleted', 'task', req.params.taskId, { title: t.title }, req.productId);
  res.json({ ok: true });
}));

/** Work queue across all products the user can see. Managers: tasks assigned to them or unassigned. */
myTasks.get('/', ah(async (req, res) => {
  const ids = await productIdsFor(req.user);
  if (!ids.length) return res.json([]);
  const includeDone = req.query.done === 'true';
  const mineOnly = req.user.role !== 'admin';
  const rows = await many(
    `${TASK_SELECT} WHERE t.product_id = ANY($1) AND p.archived = FALSE
       ${includeDone ? "AND t.status <> 'cancelled'" : "AND t.status IN ('todo','in_progress')"}
       ${mineOnly ? 'AND (t.assigned_to = $2 OR t.assigned_to IS NULL)' : ''}
     ${ORDER} LIMIT 300`,
    mineOnly ? [ids, req.user.id] : [ids]
  );
  res.json(rows);
}));

/** Daily reminder job: tasks due today or overdue → notify the assignee (or product members). */
export async function sendDueReminders() {
  const rows = await many(
    `SELECT t.id, t.title, t.due_date, t.product_id, t.assigned_to, p.name AS product_name
     FROM tasks t JOIN products p ON p.id = t.product_id
     WHERE t.status IN ('todo','in_progress') AND t.due_date <= $1 AND p.archived = FALSE`,
    [today()]
  );
  for (const t of rows) {
    const overdue = t.due_date < today();
    const to = t.assigned_to ? [t.assigned_to] : await productAudience(t.product_id);
    await notify(to, {
      kind: 'reminder',
      title: overdue ? `Overdue: ${t.title}` : `Due today: ${t.title}`,
      body: t.product_name,
      link: `/products/${t.product_id}?tab=content&task=${t.id}`,
      productId: t.product_id,
    });
    if (overdue) {
      await notify(await adminIds(), { kind: 'reminder', title: `Overdue on ${t.product_name}`, body: t.title, link: `/products/${t.product_id}?tab=content&task=${t.id}`, productId: t.product_id }, t.assigned_to);
    }
  }
  return rows.length;
}
