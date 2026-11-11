import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { canAccessProduct, productIdsFor } from '../access.js';
import { PRODUCT_TYPES } from '../services/kpiTemplates.js';
import { setupProductChecklist, suggestionsFor } from '../services/checklistTemplates.js';
import { ah, parse, zDate, today, weekStart, addDays, isoWeekKey } from '../util.js';

/*
 * Routines per product (plus a company-wide list). Managers see the company list and
 * the products they work on; admins see everything.
 */
const router = Router();

async function scopeOf(req) {
  const raw = req.query.scope ?? req.body?.scope ?? 'company';
  if (raw === 'company' || raw === '' || raw === null) return 'company';
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || !(await canAccessProduct(req.user, id))) {
    const e = new Error('Product not found.'); e.status = 404; throw e;
  }
  return id;
}
const scopeSql = (scope, i = 1) => (scope === 'company' ? 'product_id IS NULL' : `product_id = $${i}`);
const scopeArgs = (scope) => (scope === 'company' ? [] : [scope]);

/** Company-wide + each product the user can see, with today's daily progress. */
router.get('/scopes', ah(async (req, res) => {
  const ids = await productIdsFor(req.user);
  const d = today(), wk = isoWeekKey(d), mo = d.slice(0, 7);
  const rows = await many(
    `SELECT p.id, p.name, p.color, p.category,
       count(t.id) FILTER (WHERE t.frequency = 'daily')::int AS daily,
       count(c.task_id) FILTER (WHERE t.frequency = 'daily')::int AS daily_done,
       count(t.id) FILTER (WHERE t.frequency <> 'daily')::int AS other,
       count(c.task_id) FILTER (WHERE t.frequency <> 'daily')::int AS other_done
     FROM products p
     LEFT JOIN checklist_tasks t ON t.product_id = p.id AND t.active
     LEFT JOIN checklist_completions c ON c.task_id = t.id AND c.period_key = CASE t.frequency WHEN 'daily' THEN $2 WHEN 'weekly' THEN $3 ELSE $4 END
     WHERE p.archived = FALSE AND p.id = ANY($1) GROUP BY p.id ORDER BY p.name`,
    [ids, d, wk, mo]
  );
  const company = await one(
    `SELECT count(t.id) FILTER (WHERE t.frequency = 'daily')::int AS daily,
       count(c.task_id) FILTER (WHERE t.frequency = 'daily')::int AS daily_done,
       count(t.id) FILTER (WHERE t.frequency <> 'daily')::int AS other,
       count(c.task_id) FILTER (WHERE t.frequency <> 'daily')::int AS other_done
     FROM checklist_tasks t
     LEFT JOIN checklist_completions c ON c.task_id = t.id AND c.period_key = CASE t.frequency WHEN 'daily' THEN $1 WHEN 'weekly' THEN $2 ELSE $3 END
     WHERE t.product_id IS NULL AND t.active`,
    [d, wk, mo]
  );
  res.json([
    { id: 'company', name: 'Company-wide', category: null, typeLabel: 'Security, operations, reporting', ...company },
    ...rows.map((r) => ({ ...r, typeLabel: PRODUCT_TYPES[r.category]?.label || 'Other' })),
  ]);
}));

/** Tasks + completion state for the week containing `date`, for one scope. */
router.get('/', ah(async (req, res) => {
  const scope = await scopeOf(req);
  const date = parse(zDate.optional(), req.query.date) || today();
  const monday = weekStart(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekKey = isoWeekKey(date);
  const monthKey = date.slice(0, 7);
  const tasks = await many(
    `SELECT * FROM checklist_tasks WHERE active = TRUE AND ${scopeSql(scope)} ORDER BY frequency, position, id`,
    scopeArgs(scope)
  );
  const done = await many(
    `SELECT c.task_id, c.period_key, c.done_at, u.name AS done_by_name
     FROM checklist_completions c LEFT JOIN users u ON u.id = c.done_by
     WHERE c.period_key = ANY($1) AND c.task_id = ANY($2)`,
    [[...days, weekKey, monthKey], tasks.map((t) => t.id)]
  );
  const map = new Map(done.map((d) => [`${d.task_id}|${d.period_key}`, d]));
  const period = (t, key) => ({ key, done: map.has(`${t.id}|${key}`), by: map.get(`${t.id}|${key}`)?.done_by_name });
  res.json({
    scope, date, days, weekKey, monthKey,
    tasks: tasks.map((t) => ({
      ...t,
      periods: t.frequency === 'daily' ? days.map((d) => period(t, d)) : [period(t, t.frequency === 'weekly' ? weekKey : monthKey)],
    })),
  });
}));

router.post('/toggle', requireRole('manager'), ah(async (req, res) => {
  const { task_id, period_key, done } = parse(
    z.object({
      task_id: z.number().int().positive(),
      period_key: z.string().regex(/^(\d{4}-\d{2}-\d{2}|\d{4}-W\d{2}|\d{4}-\d{2})$/),
      done: z.boolean(),
    }),
    req.body
  );
  const t = await one('SELECT product_id FROM checklist_tasks WHERE id = $1', [task_id]);
  if (!t || (t.product_id && !(await canAccessProduct(req.user, t.product_id)))) return res.status(404).json({ error: 'Task not found.' });
  if (done) {
    await query(
      `INSERT INTO checklist_completions (task_id, period_key, done_by) VALUES ($1,$2,$3)
       ON CONFLICT (task_id, period_key) DO NOTHING`,
      [task_id, period_key, req.user.id]
    );
  } else {
    await query('DELETE FROM checklist_completions WHERE task_id = $1 AND period_key = $2', [task_id, period_key]);
  }
  res.json({ ok: true });
}));

/** Admin: the suggested routine for a product, and adding chosen items back */
router.get('/suggestions', requireRole('admin'), ah(async (req, res) => {
  const scope = await scopeOf(req);
  if (scope === 'company') return res.json([]);
  res.json(await tx((c) => suggestionsFor(c, scope)));
}));

router.post('/setup', requireRole('admin'), ah(async (req, res) => {
  const b = parse(z.object({ scope: z.number().int().positive(), keys: z.array(z.string().max(40)).max(80) }), req.body);
  await scopeOf(req);
  const added = await tx(async (c) => {
    // Re-activate previously removed suggestions the admin picked again
    await c.query('UPDATE checklist_tasks SET active = TRUE WHERE product_id = $1 AND tpl_key = ANY($2)', [b.scope, b.keys]);
    return setupProductChecklist(c, b.scope, { onlyKeys: b.keys });
  });
  await audit(req, 'checklist.setup', 'product', b.scope, { keys: b.keys.length });
  res.json({ ok: true, added });
}));

const taskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  scope: z.string().max(200).nullish(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
});

router.post('/tasks', requireRole('admin'), ah(async (req, res) => {
  const b = parse(taskSchema, req.body);
  // The product comes from ?scope= (the body's `scope` field is the task's group label)
  const sc = await scopeOf({ user: req.user, query: { scope: req.query.scope ?? 'company' }, body: {} });
  const pid = sc === 'company' ? null : sc;
  const t = await one(
    `INSERT INTO checklist_tasks (title, scope, frequency, position, product_id)
     VALUES ($1,$2,$3,(SELECT coalesce(max(position),0)+1 FROM checklist_tasks WHERE product_id IS NOT DISTINCT FROM $4),$4) RETURNING *`,
    [b.title, b.scope || null, b.frequency, pid]
  );
  await audit(req, 'checklist.added', 'checklist', t.id, { title: t.title }, pid);
  res.status(201).json(t);
}));

router.put('/tasks/:id(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const b = parse(taskSchema, req.body);
  const t = await one('UPDATE checklist_tasks SET title=$2, scope=$3, frequency=$4 WHERE id=$1 RETURNING *', [
    Number(req.params.id), b.title, b.scope || null, b.frequency,
  ]);
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  res.json(t);
}));

router.delete('/tasks/:id(\\d+)', requireRole('admin'), ah(async (req, res) => {
  // Soft-delete keeps past ticks; a removed suggestion is not re-added automatically
  await query('UPDATE checklist_tasks SET active = FALSE WHERE id = $1', [Number(req.params.id)]);
  await audit(req, 'checklist.removed', 'checklist', req.params.id);
  res.json({ ok: true });
}));

export default router;
