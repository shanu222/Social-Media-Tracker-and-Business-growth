import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { ah, parse, zDate, today, weekStart, addDays, isoWeekKey } from '../util.js';

const router = Router();

/** Tasks + completion state for the week containing `date`. */
router.get(
  '/',
  ah(async (req, res) => {
    const date = parse(zDate.optional(), req.query.date) || today();
    const monday = weekStart(date);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const weekKey = isoWeekKey(date);
    const monthKey = date.slice(0, 7);
    const tasks = await many('SELECT * FROM checklist_tasks WHERE active = TRUE ORDER BY frequency, position, id');
    const done = await many(
      `SELECT c.task_id, c.period_key, c.done_at, u.name AS done_by_name
       FROM checklist_completions c LEFT JOIN users u ON u.id = c.done_by
       WHERE c.period_key = ANY($1)`,
      [[...days, weekKey, monthKey]]
    );
    const map = new Map(done.map((d) => [`${d.task_id}|${d.period_key}`, d]));
    res.json({
      date,
      days,
      weekKey,
      monthKey,
      tasks: tasks.map((t) => ({
        ...t,
        periods:
          t.frequency === 'daily'
            ? days.map((d) => ({ key: d, done: map.has(`${t.id}|${d}`), by: map.get(`${t.id}|${d}`)?.done_by_name }))
            : [
                {
                  key: t.frequency === 'weekly' ? weekKey : monthKey,
                  done: map.has(`${t.id}|${t.frequency === 'weekly' ? weekKey : monthKey}`),
                  by: map.get(`${t.id}|${t.frequency === 'weekly' ? weekKey : monthKey}`)?.done_by_name,
                },
              ],
      })),
    });
  })
);

router.post(
  '/toggle',
  requireRole('manager'),
  ah(async (req, res) => {
    const { task_id, period_key, done } = parse(
      z.object({
        task_id: z.number().int().positive(),
        period_key: z.string().regex(/^(\d{4}-\d{2}-\d{2}|\d{4}-W\d{2}|\d{4}-\d{2})$/),
        done: z.boolean(),
      }),
      req.body
    );
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
  })
);

const taskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  scope: z.string().max(200).nullish(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
});

router.post(
  '/tasks',
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(taskSchema, req.body);
    const t = await one(
      `INSERT INTO checklist_tasks (title, scope, frequency, position)
       VALUES ($1,$2,$3,(SELECT coalesce(max(position),0)+1 FROM checklist_tasks)) RETURNING *`,
      [b.title, b.scope || null, b.frequency]
    );
    await audit(req, 'task.created', 'task', t.id, { title: t.title });
    res.status(201).json(t);
  })
);

router.put(
  '/tasks/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const b = parse(taskSchema, req.body);
    const t = await one('UPDATE checklist_tasks SET title=$2, scope=$3, frequency=$4 WHERE id=$1 RETURNING *', [
      Number(req.params.id), b.title, b.scope || null, b.frequency,
    ]);
    if (!t) return res.status(404).json({ error: 'Task not found.' });
    res.json(t);
  })
);

router.delete(
  '/tasks/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    // Soft-delete keeps historical completion data intact
    await query('UPDATE checklist_tasks SET active = FALSE WHERE id = $1', [Number(req.params.id)]);
    await audit(req, 'task.removed', 'task', req.params.id);
    res.json({ ok: true });
  })
);

export default router;
