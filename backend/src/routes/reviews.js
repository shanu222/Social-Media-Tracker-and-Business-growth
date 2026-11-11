import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { ah, parse, zDate, zMonth, today } from '../util.js';

const router = Router();

/** Monthly review: account-wise analysis, overall summary, action plan */
router.get('/', ah(async (req, res) => {
  const month = parse(zMonth.optional(), req.query.month) || today().slice(0, 7);
  const [accounts, summary, actions] = await Promise.all([
    many(
      `SELECT a.id AS account_id, a.brand, a.username, r.best_post, r.why_worked, r.weakest, r.fix_next, r.rating
       FROM accounts a LEFT JOIN account_reviews r ON r.account_id = a.id AND r.month = $1
       WHERE a.archived = FALSE ORDER BY a.id`,
      [month]
    ),
    one('SELECT * FROM monthly_summaries WHERE month = $1', [month]),
    many(
      `SELECT x.*, a.brand FROM action_items x LEFT JOIN accounts a ON a.id = x.account_id
       WHERE x.month = $1 OR (x.done = FALSE AND (x.month IS NULL OR x.month < $1))
       ORDER BY x.done, x.deadline NULLS LAST, x.id`,
      [month]
    ),
  ]);
  res.json({ month, accounts, summary: summary || { month }, actions });
}));

const text = z.string().max(3000).nullish();

router.put('/account', requireRole('manager'), ah(async (req, res) => {
  const b = parse(
    z.object({
      account_id: z.number().int().positive(), month: zMonth,
      best_post: text, why_worked: text, weakest: text, fix_next: text,
      rating: z.number().int().min(1).max(5).nullish(),
    }),
    req.body
  );
  await query(
    `INSERT INTO account_reviews (account_id, month, best_post, why_worked, weakest, fix_next, rating)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (account_id, month) DO UPDATE SET best_post=EXCLUDED.best_post, why_worked=EXCLUDED.why_worked,
       weakest=EXCLUDED.weakest, fix_next=EXCLUDED.fix_next, rating=EXCLUDED.rating, updated_at=now()`,
    [b.account_id, b.month, b.best_post || null, b.why_worked || null, b.weakest || null, b.fix_next || null, b.rating ?? null]
  );
  res.json({ ok: true });
}));

router.put('/summary', requireRole('manager'), ah(async (req, res) => {
  const b = parse(z.object({ month: zMonth, what_worked: text, what_didnt: text, what_change: text }), req.body);
  await query(
    `INSERT INTO monthly_summaries (month, what_worked, what_didnt, what_change) VALUES ($1,$2,$3,$4)
     ON CONFLICT (month) DO UPDATE SET what_worked=EXCLUDED.what_worked, what_didnt=EXCLUDED.what_didnt,
       what_change=EXCLUDED.what_change, updated_at=now()`,
    [b.month, b.what_worked || null, b.what_didnt || null, b.what_change || null]
  );
  await audit(req, 'review.summary_saved', 'monthly_summary', b.month);
  res.json({ ok: true });
}));

const actionSchema = z.object({
  title: z.string().trim().min(1).max(300),
  account_id: z.number().int().positive().nullish(),
  owner: z.string().max(100).nullish(),
  deadline: zDate.or(z.literal('')).nullish(),
  done: z.boolean().default(false),
  month: zMonth.nullish(),
});

router.post('/actions', requireRole('manager'), ah(async (req, res) => {
  const b = parse(actionSchema, req.body);
  const a = await one(
    'INSERT INTO action_items (title, account_id, owner, deadline, done, month) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [b.title, b.account_id ?? null, b.owner || null, b.deadline || null, b.done, b.month || today().slice(0, 7)]
  );
  await audit(req, 'action.created', 'action', a.id, { title: a.title });
  res.status(201).json(a);
}));

router.put('/actions/:id', requireRole('manager'), ah(async (req, res) => {
  const b = parse(actionSchema, req.body);
  const a = await one(
    'UPDATE action_items SET title=$2, account_id=$3, owner=$4, deadline=$5, done=$6 WHERE id=$1 RETURNING *',
    [Number(req.params.id), b.title, b.account_id ?? null, b.owner || null, b.deadline || null, b.done]
  );
  if (!a) return res.status(404).json({ error: 'Action not found.' });
  res.json(a);
}));

router.delete('/actions/:id', requireRole('manager'), ah(async (req, res) => {
  await query('DELETE FROM action_items WHERE id = $1', [Number(req.params.id)]);
  await audit(req, 'action.deleted', 'action', req.params.id);
  res.json({ ok: true });
}));

export default router;
