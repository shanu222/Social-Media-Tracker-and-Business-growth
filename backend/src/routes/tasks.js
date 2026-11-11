import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { requireProductAccess, productIdsFor } from '../access.js';
import { notify, productAudience, adminIds } from '../notify.js';
import { emailUser, taskEmail } from '../mailer.js';
import { ah, parse, zDate, today, addDays } from '../util.js';
import { PLATFORMS } from './accounts.js';
import { contentTypeFor } from './library.js';
import { stopTimer } from './time.js';

/*
 * Task management: the Admin creates (or approves AI-drafted) tasks for any authorised person.
 * The assignee sees them in their workspace, gets an email, updates progress, comments,
 * asks for clarification and completes them. The Admin is notified of every meaningful change.
 */

export const productTasks = Router({ mergeParams: true });
export const globalTasks = Router();

const TASK_SELECT = `
  SELECT t.*, p.name AS product_name, p.color AS product_color,
    CASE WHEN ua.deleted_at IS NOT NULL THEN ua.name || ' (removed)' ELSE ua.name END AS assigned_name, uc.name AS created_by_name, ud.name AS completed_by_name,
    (SELECT coalesce(json_agg(json_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size) ORDER BY f.id), '[]')
       FROM files f WHERE f.task_id = t.id) AS files,
    (SELECT coalesce(json_agg(json_build_object('id', l.id, 'title', l.title, 'url', l.url, 'content_type', l.content_type) ORDER BY l.id), '[]')
       FROM links l WHERE l.task_id = t.id) AS links,
    (SELECT coalesce(json_agg(json_build_object('id', x.id, 'platform', x.platform, 'url', x.url, 'posted_on', x.posted_on) ORDER BY x.posted_on), '[]')
       FROM posts x WHERE x.task_id = t.id) AS posts,
    (SELECT count(*) FROM task_comments c WHERE c.task_id = t.id AND c.kind <> 'system') AS comment_count,
    (SELECT count(*) FROM task_comments c WHERE c.task_id = t.id AND c.kind = 'clarification') AS clarification_count
  FROM tasks t
  JOIN products p ON p.id = t.product_id
  LEFT JOIN users ua ON ua.id = t.assigned_to
  LEFT JOIN users uc ON uc.id = t.created_by
  LEFT JOIN users ud ON ud.id = t.completed_by`;

const ORDER = `ORDER BY CASE t.status WHEN 'draft' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'todo' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
  CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
  t.due_date NULLS LAST, t.id DESC`;

const linkSchema = z.object({ title: z.string().trim().max(200).optional(), url: z.string().trim().url().max(2000) });

const taskSchema = z.object({
  kind: z.enum(['post', 'general']).default('post'),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(8000).nullish(),
  caption: z.string().max(5000).nullish(),
  hashtags: z.string().max(1000).nullish(),
  instructions: z.string().max(5000).nullish(),
  platforms: z.array(z.enum(PLATFORMS)).max(20).default([]),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  start_date: zDate.or(z.literal('')).nullish(),
  due_date: zDate.or(z.literal('')).nullish(),
  assigned_to: z.number().int().positive().nullish(),
  links: z.array(linkSchema).max(30).optional(),
  send: z.boolean().default(true),
});

const isHttp = (u) => /^https?:\/\//i.test(u);
const taskLink = (t) => `/products/${t.product_id}?tab=tasks&task=${t.id}`;
const bg = (p) => Promise.resolve(p).catch((e) => console.error('[bg]', e.message));

async function validateAssignee(userId, productId, client = { query: (q, p) => query(q, p) }) {
  if (!userId) return;
  const { rows } = await client.query("SELECT id, role, active FROM users WHERE id = $1", [userId]);
  const u = rows[0];
  if (!u || !u.active || u.role === 'viewer') {
    const e = new Error('Tasks can only be assigned to active admins or managers.');
    e.status = 400;
    throw e;
  }
  // Assigning someone gives them access to that product
  if (u.role !== 'admin') {
    await client.query('INSERT INTO product_members (product_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [productId, userId]);
  }
}

async function saveLinks(client, productId, taskId, links, userId) {
  for (const l of links || []) {
    if (!isHttp(l.url)) continue;
    await client.query(
      'INSERT INTO links (product_id, task_id, title, url, content_type, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [productId, taskId, l.title || l.url.replace(/^https?:\/\//, '').slice(0, 80), l.url, contentTypeFor(l.url), userId]
    );
  }
}

async function systemNote(taskId, userId, body) {
  await query("INSERT INTO task_comments (task_id, user_id, kind, body) VALUES ($1,$2,'system',$3)", [taskId, userId, body]);
}

/** Tell the assignee (or everyone on the product) about a sent task — in-app + email. */
async function announce(t, actorId, { kind, title, intro, heading, extra }) {
  const product = await one('SELECT name FROM products WHERE id = $1', [t.product_id]);
  const to = t.assigned_to ? [t.assigned_to] : (await productAudience(t.product_id)).filter((u) => u !== actorId);
  await notify(to, { kind, title, body: t.title, link: taskLink(t), productId: t.product_id }, actorId);
  for (const uid of to) {
    if (uid === actorId) continue;
    const mail = taskEmail({ heading, intro, task: t, productName: product.name, link: taskLink(t), extra });
    bg(emailUser(uid, { subject: `${title} — ${t.title}`, kind, ...mail }));
  }
}

/** Tell admins about progress/completion/clarification. Email only when `email` is true. */
async function tellAdmins(t, actor, { kind, title, intro, heading, email, extra }) {
  const product = await one('SELECT name FROM products WHERE id = $1', [t.product_id]);
  const admins = (await adminIds()).filter((id) => id !== actor.id);
  await notify(admins, { kind, title, body: t.title, link: taskLink(t), productId: t.product_id }, actor.id);
  if (email) {
    for (const id of admins) {
      bg(emailUser(id, { subject: `${title} — ${t.title}`, kind, ...taskEmail({ heading, intro, task: t, productName: product.name, link: taskLink(t), extra }) }));
    }
  }
}

function canWorkOn(user, t) {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager') return false;
  return t.status !== 'draft' && (t.assigned_to === user.id || t.assigned_to === null);
}

/* ---------------- product-scoped routes ---------------- */
productTasks.use(requireProductAccess());

productTasks.get('/', ah(async (req, res) => {
  const status = ['draft', 'todo', 'in_progress', 'done', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const params = [req.productId];
  let where = 't.product_id = $1';
  if (req.user.role !== 'admin') where += " AND t.status <> 'draft'";
  if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
  res.json(await many(`${TASK_SELECT} WHERE ${where} ${ORDER} LIMIT 400`, params));
}));

productTasks.get('/:taskId(\\d+)', ah(async (req, res) => {
  const t = await one(`${TASK_SELECT} WHERE t.id = $1 AND t.product_id = $2`, [Number(req.params.taskId), req.productId]);
  if (!t || (t.status === 'draft' && req.user.role !== 'admin')) return res.status(404).json({ error: 'Task not found.' });
  if (t.assigned_to === req.user.id && !t.seen_at) await query('UPDATE tasks SET seen_at = now() WHERE id = $1', [t.id]);
  const comments = await many(
    `SELECT c.*, u.name AS user_name, u.role AS user_role FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.task_id = $1 ORDER BY c.id`,
    [t.id]
  );
  res.json({ ...t, comments });
}));

productTasks.post('/', requireRole('admin'), ah(async (req, res) => {
  const b = parse(taskSchema, req.body);
  if (b.start_date && b.due_date && b.start_date > b.due_date) return res.status(400).json({ error: 'The start date must be before the due date.' });
  const t = await tx(async (c) => {
    await validateAssignee(b.assigned_to, req.productId, c);
    const { rows } = await c.query(
      `INSERT INTO tasks (product_id, kind, title, description, caption, hashtags, instructions, platforms, priority,
         start_date, due_date, assigned_to, created_by, status, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.productId, b.kind, b.title, b.description || null, b.caption || null, b.hashtags || null, b.instructions || null,
        b.platforms, b.priority, b.start_date || null, b.due_date || null, b.assigned_to ?? null, req.user.id,
        b.send ? 'todo' : 'draft', b.send ? new Date() : null]
    );
    await saveLinks(c, req.productId, rows[0].id, b.links, req.user.id);
    return rows[0];
  });
  if (b.send) {
    await announce(t, req.user.id, {
      kind: 'task', title: 'New task assigned', heading: 'You have a new task',
      intro: `${req.user.name} assigned you a task. Open it to see the details, files and links.`,
    });
  }
  await audit(req, b.send ? 'task.created' : 'task.drafted', 'task', t.id, { title: t.title }, req.productId);
  res.status(201).json(t);
}));

productTasks.put('/:taskId(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const b = parse(taskSchema.omit({ send: true }), req.body);
  const prev = await one('SELECT * FROM tasks WHERE id = $1 AND product_id = $2', [Number(req.params.taskId), req.productId]);
  if (!prev) return res.status(404).json({ error: 'Task not found.' });
  if (b.start_date && b.due_date && b.start_date > b.due_date) return res.status(400).json({ error: 'The start date must be before the due date.' });
  const t = await tx(async (c) => {
    await validateAssignee(b.assigned_to, req.productId, c);
    const { rows } = await c.query(
      `UPDATE tasks SET kind=$2, title=$3, description=$4, caption=$5, hashtags=$6, instructions=$7, platforms=$8, priority=$9,
         start_date=$10, due_date=$11, assigned_to=$12, updated_at=now() WHERE id=$1 RETURNING *`,
      [prev.id, b.kind, b.title, b.description || null, b.caption || null, b.hashtags || null, b.instructions || null,
        b.platforms, b.priority, b.start_date || null, b.due_date || null, b.assigned_to ?? null]
    );
    if (b.links) await saveLinks(c, req.productId, prev.id, b.links, req.user.id);
    return rows[0];
  });

  if (prev.status !== 'draft') {
    const changes = [];
    const fmtD = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'none');
    if ((prev.due_date || null) !== (t.due_date || null)) changes.push(`Due date changed from ${fmtD(prev.due_date)} to ${fmtD(t.due_date)}`);
    if ((prev.start_date || null) !== (t.start_date || null)) changes.push(`Start date changed to ${fmtD(t.start_date)}`);
    if ((prev.instructions || '') !== (t.instructions || '') || (prev.description || '') !== (t.description || '') || (prev.caption || '') !== (t.caption || '')) changes.push('Instructions or content were updated');
    if (prev.priority !== t.priority) changes.push(`Priority changed to ${t.priority}`);
    if (b.links?.length) changes.push(`${b.links.length} link(s) added`);
    if (t.assigned_to && t.assigned_to !== prev.assigned_to) {
      await announce(t, req.user.id, { kind: 'task', title: 'Task assigned to you', heading: 'A task was assigned to you', intro: `${req.user.name} assigned this task to you.` });
    } else if (changes.length) {
      await systemNote(t.id, req.user.id, changes.join('. ') + '.');
      await announce(t, req.user.id, {
        kind: 'task_changed', title: 'Task updated', heading: 'A task you work on was updated',
        intro: `${req.user.name} changed this task.`, extra: changes.map((x) => `• ${x}`).join('\n'),
      });
    }
  }
  await audit(req, 'task.updated', 'task', t.id, { title: t.title }, req.productId);
  res.json(t);
}));

/** Approve an AI draft (or any draft) and send it to the assignee. */
productTasks.post('/:taskId(\\d+)/send', requireRole('admin'), ah(async (req, res) => {
  const t = await one(
    "UPDATE tasks SET status = 'todo', sent_at = now(), updated_at = now() WHERE id = $1 AND product_id = $2 AND status = 'draft' RETURNING *",
    [Number(req.params.taskId), req.productId]
  );
  if (!t) return res.status(404).json({ error: 'Draft not found or already sent.' });
  await announce(t, req.user.id, { kind: 'task', title: 'New task assigned', heading: 'You have a new task', intro: `${req.user.name} assigned you a task.` });
  await audit(req, 'task.sent', 'task', t.id, { title: t.title }, req.productId);
  res.json(t);
}));

async function loadForWork(req, res) {
  const t = await one('SELECT * FROM tasks WHERE id = $1 AND product_id = $2', [Number(req.params.taskId), req.productId]);
  if (!t) { res.status(404).json({ error: 'Task not found.' }); return null; }
  if (!canWorkOn(req.user, t)) { res.status(403).json({ error: 'This task is assigned to someone else.' }); return null; }
  return t;
}

/** Status change: start, complete (progress → 100), reopen, cancel (admin). */
productTasks.patch('/:taskId(\\d+)/status', requireRole('manager'), ah(async (req, res) => {
  const b = parse(z.object({
    status: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
    completion_note: z.string().max(2000).nullish(),
  }), req.body);
  if (b.status === 'cancelled' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the admin can cancel a task.' });
  const prev = await loadForWork(req, res);
  if (!prev) return;
  if (prev.status === 'draft') return res.status(400).json({ error: 'Send the draft first.' });
  const t = await one(
    `UPDATE tasks SET status=$2, updated_at=now(),
       progress = CASE WHEN $2 = 'done' THEN 100 WHEN $2 = 'todo' AND progress = 100 THEN 90 ELSE progress END,
       completed_at = CASE WHEN $2 = 'done' THEN now() ELSE NULL END,
       completed_by = CASE WHEN $2 = 'done' THEN $3::int ELSE NULL END,
       completion_note = CASE WHEN $2 = 'done' THEN $4 ELSE completion_note END
     WHERE id=$1 RETURNING *`,
    [prev.id, b.status, req.user.id, b.completion_note || null]
  );
  if (['done', 'cancelled'].includes(b.status)) {
    // Close any timers still running on this task
    const running = await many('SELECT user_id FROM task_time WHERE task_id = $1 AND ended_at IS NULL', [t.id]);
    for (const r of running) await stopTimer(r.user_id, t.id);
  }
  const label = { todo: 'reopened the task', in_progress: 'started working', done: 'completed the task', cancelled: 'cancelled the task' }[b.status];
  await systemNote(t.id, req.user.id, `${req.user.name} ${label}.${b.completion_note ? ` Note: ${b.completion_note}` : ''}`);
  if (b.status === 'done') {
    await tellAdmins(t, req.user, { kind: 'done', title: 'Task completed', heading: 'A task was completed', intro: `${req.user.name} marked this task as completed.`, email: true, extra: b.completion_note });
  } else if (b.status === 'in_progress' && prev.status === 'todo') {
    await tellAdmins(t, req.user, { kind: 'progress', title: 'Task started', heading: 'Work started', intro: `${req.user.name} started this task.`, email: false });
  }
  await audit(req, `task.${b.status}`, 'task', t.id, { title: t.title }, req.productId);
  res.json(t);
}));

/** Percentage update with an optional note. */
productTasks.patch('/:taskId(\\d+)/progress', requireRole('manager'), ah(async (req, res) => {
  const b = parse(z.object({ progress: z.number().int().min(0).max(100), note: z.string().max(2000).nullish() }), req.body);
  const prev = await loadForWork(req, res);
  if (!prev) return;
  if (prev.status === 'draft' || prev.status === 'cancelled') return res.status(400).json({ error: 'This task is not active.' });
  const t = await one(
    `UPDATE tasks SET progress = $2, updated_at = now(),
       status = CASE WHEN status = 'todo' AND $2 > 0 THEN 'in_progress' ELSE status END
     WHERE id = $1 RETURNING *`,
    [prev.id, b.progress]
  );
  await query("INSERT INTO task_comments (task_id, user_id, kind, body, progress) VALUES ($1,$2,'progress',$3,$4)", [t.id, req.user.id, b.note || null, b.progress]);
  await tellAdmins(t, req.user, {
    kind: 'progress', title: `Progress ${prev.progress}% → ${b.progress}%`, heading: 'Task progress updated',
    intro: `${req.user.name} updated progress to ${b.progress}%.`, email: false, extra: b.note,
  });
  await audit(req, 'task.progress', 'task', t.id, { title: t.title, progress: b.progress }, req.productId);
  res.json(t);
}));

/** Comments & clarification requests. Admin replies reach the assignee by email too. */
productTasks.post('/:taskId(\\d+)/comments', requireRole('manager'), ah(async (req, res) => {
  const b = parse(z.object({
    body: z.string().trim().min(1, 'Write something first').max(4000),
    kind: z.enum(['comment', 'clarification']).default('comment'),
  }), req.body);
  const t = await loadForWork(req, res);
  if (!t) return;
  const c = await one(
    'INSERT INTO task_comments (task_id, user_id, kind, body) VALUES ($1,$2,$3,$4) RETURNING *',
    [t.id, req.user.id, b.kind, b.body]
  );
  if (req.user.role === 'admin') {
    await announce(t, req.user.id, { kind: 'comment', title: `${req.user.name} commented`, heading: 'New comment on your task', intro: `${req.user.name} wrote:`, extra: b.body });
  } else {
    await tellAdmins(t, req.user, {
      kind: b.kind === 'clarification' ? 'clarification' : 'comment',
      title: b.kind === 'clarification' ? 'Clarification requested' : `${req.user.name} commented`,
      heading: b.kind === 'clarification' ? 'Your manager needs clarification' : 'New comment on a task',
      intro: `${req.user.name} wrote:`, extra: b.body, email: b.kind === 'clarification',
    });
  }
  await audit(req, b.kind === 'clarification' ? 'task.clarification' : 'task.comment', 'task', t.id, { title: t.title }, req.productId);
  res.status(201).json({ ...c, user_name: req.user.name, user_role: req.user.role });
}));

/** Add supporting links to a task (assignee or admin). They also go into the product library. */
productTasks.post('/:taskId(\\d+)/links', requireRole('manager'), ah(async (req, res) => {
  const b = parse(linkSchema, req.body);
  if (!isHttp(b.url)) return res.status(400).json({ error: 'Links must start with http:// or https://' });
  const t = await loadForWork(req, res);
  if (!t) return;
  await tx((c) => saveLinks(c, req.productId, t.id, [b], req.user.id));
  await systemNote(t.id, req.user.id, `${req.user.name} added a link: ${b.title || b.url}`);
  if (req.user.role !== 'admin') {
    await tellAdmins(t, req.user, { kind: 'comment', title: 'Link added to task', heading: 'A link was added', intro: `${req.user.name} added a link.`, extra: b.url, email: false });
  }
  await audit(req, 'link.added', 'link', t.id, { title: t.title, url: b.url }, req.productId);
  res.status(201).json({ ok: true });
}));

productTasks.delete('/:taskId(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const t = await one('DELETE FROM tasks WHERE id = $1 AND product_id = $2 RETURNING title', [Number(req.params.taskId), req.productId]);
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  await audit(req, 'task.deleted', 'task', req.params.taskId, { title: t.title }, req.productId);
  res.json({ ok: true });
}));

/* ---------------- cross-product routes ---------------- */

/** Personal workspace: everything assigned to me (or unassigned on my products). */
globalTasks.get('/mine', ah(async (req, res) => {
  const ids = await productIdsFor(req.user);
  if (!ids.length) return res.json([]);
  const admin = req.user.role === 'admin';
  const rows = await many(
    `${TASK_SELECT} WHERE t.product_id = ANY($1) AND p.archived = FALSE AND t.status NOT IN ('draft','cancelled')
       AND (t.status <> 'done' OR t.completed_at > now() - interval '30 days')
       AND ${admin ? '(t.assigned_to = $2 OR t.assigned_to IS NULL)' : '(t.assigned_to = $2 OR t.assigned_to IS NULL)'}
     ${ORDER} LIMIT 400`,
    [ids, req.user.id]
  );
  res.json(rows);
}));

/** Admin control centre: every task, filters, and progress per person. */
globalTasks.get('/all', requireRole('admin'), ah(async (req, res) => {
  const where = ['p.archived = FALSE'];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.product_id) add('t.product_id = ?', Number(req.query.product_id));
  if (req.query.assigned_to === 'none') where.push('t.assigned_to IS NULL');
  else if (req.query.assigned_to) add('t.assigned_to = ?', Number(req.query.assigned_to));
  const st = req.query.status;
  if (st === 'overdue') { add("t.status IN ('todo','in_progress') AND t.due_date < ?", today()); }
  else if (['draft', 'todo', 'in_progress', 'done', 'cancelled'].includes(st)) add('t.status = ?', st);
  else if (st !== 'all') where.push("t.status <> 'cancelled'");
  const tasks = await many(`${TASK_SELECT} WHERE ${where.join(' AND ')} ${ORDER} LIMIT 500`, params);

  const t0 = today();
  const stats = await one(
    `SELECT count(*) FILTER (WHERE t.status = 'todo') AS pending,
            count(*) FILTER (WHERE t.status = 'in_progress') AS in_progress,
            count(*) FILTER (WHERE t.status IN ('todo','in_progress') AND t.due_date < $1) AS overdue,
            count(*) FILTER (WHERE t.status IN ('todo','in_progress') AND t.due_date BETWEEN $1 AND $2) AS due_soon,
            count(*) FILTER (WHERE t.status = 'done' AND t.completed_at >= date_trunc('month', now())) AS done_month,
            count(*) FILTER (WHERE t.status = 'draft') AS drafts
     FROM tasks t JOIN products p ON p.id = t.product_id WHERE p.archived = FALSE`,
    [t0, addDays(t0, 3)]
  );
  const team = await many(
    `SELECT u.id, u.name, u.role,
       count(t.id) FILTER (WHERE t.status IN ('todo','in_progress')) AS open,
       count(t.id) FILTER (WHERE t.status = 'in_progress') AS in_progress,
       count(t.id) FILTER (WHERE t.status IN ('todo','in_progress') AND t.due_date < $1) AS overdue,
       count(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at >= now() - interval '30 days') AS done_30d,
       coalesce(round(avg(t.progress) FILTER (WHERE t.status IN ('todo','in_progress'))), 0) AS avg_progress,
       count(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at >= now() - interval '30 days' AND t.due_date IS NOT NULL
         AND t.completed_at::date <= t.due_date) AS on_time_30d
     FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id
     WHERE u.active = TRUE AND u.role <> 'viewer'
     GROUP BY u.id ORDER BY u.role DESC, u.name`,
    [t0]
  );
  res.json({ stats, team, tasks });
}));

/* ---------------- reminder job ---------------- */

async function once(taskId, kind) {
  const r = await query(
    'INSERT INTO task_reminders (task_id, kind, sent_on) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING task_id',
    [taskId, kind, today()]
  );
  return r.rowCount > 0;
}

/**
 * Runs every morning:
 *  - upcoming: due in REMINDER_DAYS_BEFORE days (default 2) and tomorrow → assignee
 *  - due today → assignee
 *  - overdue → assignee + admins (day 1, then every 3 days)
 *  - pending: sent 3+ days ago and not started → assignee
 *  - daily digest email to admins
 */
export async function sendDueReminders() {
  const t0 = today();
  const before = Number(process.env.REMINDER_DAYS_BEFORE || 2);
  const rows = await many(
    `SELECT t.*, p.name AS product_name FROM tasks t JOIN products p ON p.id = t.product_id
     WHERE t.status IN ('todo','in_progress') AND p.archived = FALSE`
  );
  let sent = 0;
  for (const t of rows) {
    const to = t.assigned_to ? [t.assigned_to] : await productAudience(t.product_id);
    const send = async (kind, title, heading, intro, alsoAdmins = false) => {
      if (!(await once(t.id, kind))) return;
      sent++;
      await notify(to, { kind: 'reminder', title, body: t.title, link: taskLink(t), productId: t.product_id });
      for (const uid of to) bg(emailUser(uid, { subject: `${title} — ${t.title}`, kind: 'reminder', ...taskEmail({ heading, intro, task: t, productName: t.product_name, link: taskLink(t) }) }));
      if (alsoAdmins) {
        const admins = (await adminIds()).filter((a) => !to.includes(a));
        await notify(admins, { kind: 'reminder', title: `${title} (${t.product_name})`, body: t.title, link: taskLink(t), productId: t.product_id });
      }
    };
    if (t.due_date) {
      const daysLeft = Math.round((new Date(t.due_date) - new Date(t0)) / 86400000);
      if (daysLeft === before || (daysLeft === 1 && before !== 1)) {
        await send(`upcoming_${daysLeft}`, `Due in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`, 'Deadline coming up', `This task is due in ${daysLeft} day${daysLeft > 1 ? 's' : ''} and is ${t.progress}% complete.`);
      } else if (daysLeft === 0) {
        await send('due_today', 'Due today', 'This task is due today', `This task is due today and is ${t.progress}% complete.`, t.progress < 50);
      } else if (daysLeft < 0 && ((-daysLeft) === 1 || (-daysLeft) % 3 === 0)) {
        await send('overdue', `Overdue by ${-daysLeft} day${-daysLeft > 1 ? 's' : ''}`, 'This task is overdue', `This task was due ${-daysLeft} day${-daysLeft > 1 ? 's' : ''} ago and is ${t.progress}% complete. Update its progress or ask the admin for a new date.`, true);
      }
    }
    if (t.status === 'todo' && t.sent_at && t.progress === 0 && new Date(t.sent_at) < new Date(Date.now() - 3 * 86400000)) {
      const ageDays = Math.floor((Date.now() - new Date(t.sent_at)) / 86400000);
      if (ageDays % 3 === 0) await send('pending', 'Not started yet', 'A task is waiting for you', `This task was assigned ${ageDays} days ago and hasn't been started.`);
    }
  }
  await adminDigest();
  return sent;
}

async function adminDigest() {
  const t0 = today();
  const [overdue, soon, doneY] = await Promise.all([
    many(`SELECT t.*, p.name AS product_name, u.name AS assigned_name FROM tasks t JOIN products p ON p.id = t.product_id LEFT JOIN users u ON u.id = t.assigned_to
          WHERE t.status IN ('todo','in_progress') AND t.due_date < $1 AND p.archived = FALSE ORDER BY t.due_date`, [t0]),
    many(`SELECT t.*, p.name AS product_name, u.name AS assigned_name FROM tasks t JOIN products p ON p.id = t.product_id LEFT JOIN users u ON u.id = t.assigned_to
          WHERE t.status IN ('todo','in_progress') AND t.due_date BETWEEN $1 AND $2 AND p.archived = FALSE ORDER BY t.due_date`, [t0, addDays(t0, 2)]),
    many(`SELECT t.*, p.name AS product_name, u.name AS assigned_name FROM tasks t JOIN products p ON p.id = t.product_id LEFT JOIN users u ON u.id = t.completed_by
          WHERE t.status = 'done' AND t.completed_at >= now() - interval '1 day'`),
  ]);
  if (!overdue.length && !soon.length && !doneY.length) return;
  const { sendEmail, appUrl } = await import('../mailer.js');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const section = (title, list, color) => list.length ? `<h3 style="margin:18px 0 6px;font-size:15px;color:${color}">${title} (${list.length})</h3><ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6">${list.slice(0, 15).map((t) => `<li><a href="${appUrl()}${taskLink(t)}" style="color:#1b2433">${esc(t.title)}</a> — ${esc(t.product_name)}${t.assigned_name ? `, ${esc(t.assigned_name)}` : ''}${t.status !== 'done' ? `, ${t.progress}%` : ''}${t.due_date && t.status !== 'done' ? `, due ${t.due_date}` : ''}</li>`).join('')}</ul>` : '';
  const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#eef1f4;padding:20px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:14px;padding:22px 24px">
    <h2 style="margin:0 0 4px;color:#172133">Today's task summary</h2><p style="margin:0;color:#5e6a7c;font-size:14px">${t0}</p>
    ${section('Overdue', overdue, '#b8322a')}${section('Due in the next 2 days', soon, '#a86a12')}${section('Completed in the last 24 hours', doneY, '#0b7a62')}
    <p style="margin-top:20px"><a href="${appUrl()}/tasks" style="background:#0b7a62;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open task dashboard</a></p></div></body></html>`;
  const admins = await many("SELECT id FROM users WHERE role = 'admin' AND active = TRUE AND email_notifications = TRUE");
  for (const a of admins) {
    const r = await query('INSERT INTO job_runs (key, run_on) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING key', [`digest:${a.id}`, t0]);
    if (!r.rowCount) continue;
    bg(emailUser(a.id, { subject: `Tasks today: ${overdue.length} overdue, ${soon.length} due soon`, kind: 'digest', html, text: `Overdue: ${overdue.length}\nDue soon: ${soon.length}\nCompleted: ${doneY.length}\n${appUrl()}/tasks` }));
  }
}
