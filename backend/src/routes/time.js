import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { audit } from '../audit.js';
import { canAccessProduct } from '../access.js';
import { ah, parse, zDate } from '../util.js';

/*
 * Time spent on tasks. A person starts a timer on a task they work on and stops it when done,
 * or logs minutes by hand. Only one timer runs per person; starting another stops the first.
 * Timers left running are capped at MAX_TIMER_HOURS so a forgotten timer can't skew reports.
 */
const router = Router();
const MAX_MIN = Number(process.env.MAX_TIMER_HOURS || 10) * 60;

async function taskFor(user, taskId) {
  const t = await one('SELECT id, product_id, title, assigned_to, status FROM tasks WHERE id = $1', [taskId]);
  if (!t || t.status === 'draft' || !(await canAccessProduct(user, t.product_id))) return null;
  if (user.role !== 'admin' && t.assigned_to && t.assigned_to !== user.id) return null;
  return t;
}

/** Stops the user's running timer (optionally only on one task). Returns the stopped entry or null. */
export async function stopTimer(userId, taskId = null) {
  return one(
    `UPDATE task_time SET ended_at = LEAST(now(), started_at + make_interval(mins => $3)),
       minutes = GREATEST(1, LEAST($3, round(extract(epoch FROM now() - started_at) / 60)::int))
     WHERE user_id = $1 AND ended_at IS NULL AND ($2::int IS NULL OR task_id = $2) RETURNING *`,
    [userId, taskId, MAX_MIN]
  );
}

/** Closes timers that have run past the cap (called by the reminder job). */
export async function capStaleTimers() {
  const r = await query(
    `UPDATE task_time SET ended_at = started_at + make_interval(mins => $1), minutes = $1, note = coalesce(note, 'Stopped automatically')
     WHERE ended_at IS NULL AND started_at < now() - make_interval(mins => $1)`, [MAX_MIN]
  );
  return r.rowCount;
}

router.get('/running', ah(async (req, res) => {
  const r = await one(
    `SELECT x.id, x.task_id, x.product_id, x.started_at, t.title AS task_title, p.name AS product_name
     FROM task_time x JOIN tasks t ON t.id = x.task_id JOIN products p ON p.id = x.product_id
     WHERE x.user_id = $1 AND x.ended_at IS NULL`, [req.user.id]
  );
  res.json(r || null);
}));

router.post('/start', ah(async (req, res) => {
  const { task_id } = parse(z.object({ task_id: z.number().int().positive() }), req.body);
  const t = await taskFor(req.user, task_id);
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  if (['done', 'cancelled'].includes(t.status)) return res.status(400).json({ error: 'This task is closed. Reopen it to track time.' });
  await stopTimer(req.user.id);
  const r = await one('INSERT INTO task_time (task_id, product_id, user_id) VALUES ($1,$2,$3) RETURNING *', [t.id, t.product_id, req.user.id]);
  if (t.status === 'todo' && (t.assigned_to === req.user.id || !t.assigned_to)) {
    await query("UPDATE tasks SET status = 'in_progress', updated_at = now() WHERE id = $1", [t.id]);
  }
  res.status(201).json({ ...r, task_title: t.title });
}));

router.post('/stop', ah(async (req, res) => {
  const r = await stopTimer(req.user.id);
  if (!r) return res.status(400).json({ error: 'No timer is running.' });
  await audit(req, 'time.logged', 'task', r.task_id, { minutes: r.minutes, source: 'timer' });
  res.json(r);
}));

router.post('/manual', ah(async (req, res) => {
  const b = parse(z.object({
    task_id: z.number().int().positive(),
    minutes: z.number().int().min(1, 'Enter the time spent').max(MAX_MIN, `At most ${MAX_MIN / 60} hours per entry`),
    date: zDate.optional(),
    note: z.string().trim().max(500).nullish(),
  }), req.body);
  const t = await taskFor(req.user, b.task_id);
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  const startedAt = b.date ? `${b.date}T12:00:00+05:00` : new Date(Date.now() - b.minutes * 60000).toISOString();
  if (new Date(startedAt) > new Date(Date.now() + 86400000)) return res.status(400).json({ error: 'That date is in the future.' });
  const r = await one(
    `INSERT INTO task_time (task_id, product_id, user_id, started_at, ended_at, minutes, source, note)
     VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz + make_interval(mins => $5),$5,'manual',$6) RETURNING *`,
    [t.id, t.product_id, req.user.id, startedAt, b.minutes, b.note || null]
  );
  await audit(req, 'time.logged', 'task', t.id, { minutes: b.minutes, source: 'manual' });
  res.status(201).json(r);
}));

router.get('/task/:taskId(\\d+)', ah(async (req, res) => {
  const t = await taskFor(req.user, Number(req.params.taskId));
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  const entries = await many(
    `SELECT x.id, x.user_id, u.name AS user_name, x.started_at, x.ended_at, x.source, x.note,
       coalesce(x.minutes, GREATEST(0, round(extract(epoch FROM now() - x.started_at) / 60)::int)) AS minutes
     FROM task_time x JOIN users u ON u.id = x.user_id WHERE x.task_id = $1 ORDER BY x.started_at DESC LIMIT 100`, [t.id]
  );
  res.json({ total: entries.reduce((s, e) => s + e.minutes, 0), entries });
}));

router.delete('/:id(\\d+)', ah(async (req, res) => {
  const e = await one('SELECT * FROM task_time WHERE id = $1', [Number(req.params.id)]);
  if (!e || (e.user_id !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ error: 'Entry not found.' });
  await query('DELETE FROM task_time WHERE id = $1', [e.id]);
  await audit(req, 'time.deleted', 'task', e.task_id, { minutes: e.minutes });
  res.json({ ok: true });
}));

export default router;
