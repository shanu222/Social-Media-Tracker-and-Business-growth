import { Router } from 'express';
import { z } from 'zod';
import { many, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { ah, parse, zDate, zOptInt, today, addDays } from '../util.js';

const router = Router();

const FIELDS = [
  'followers', 'following', 'posts', 'likes', 'comments', 'shares',
  'reach', 'impressions', 'profile_visits', 'dms_received', 'dms_answered',
];

/** Daily entry sheet: each active account with the selected day's numbers and the
 *  previous known numbers (for pre-filling and showing change). */
router.get(
  '/day',
  ah(async (req, res) => {
    const date = parse(zDate.optional(), req.query.date) || today();
    const rows = await many(
      `SELECT a.id AS account_id, a.brand, a.username, a.platform, a.color,
         to_jsonb(s.*) AS entry, to_jsonb(p.*) AS previous
       FROM accounts a
       LEFT JOIN snapshots s ON s.account_id = a.id AND s.date = $1
       LEFT JOIN LATERAL (
         SELECT date, followers, following, posts FROM snapshots x
         WHERE x.account_id = a.id AND x.date < $1 AND x.followers IS NOT NULL
         ORDER BY date DESC LIMIT 1
       ) p ON TRUE
       WHERE a.archived = FALSE ORDER BY a.id`,
      [date]
    );
    res.json({ date, rows });
  })
);

const rowSchema = z.object({
  account_id: z.number().int().positive(),
  notes: z.string().max(2000).nullish(),
  ...Object.fromEntries(FIELDS.map((f) => [f, zOptInt])),
});

router.put(
  '/day',
  requireRole('manager'),
  ah(async (req, res) => {
    const { date, rows } = parse(z.object({ date: zDate, rows: z.array(rowSchema).max(200) }), req.body);
    if (date > addDays(today(), 1)) return res.status(400).json({ error: 'You cannot log numbers for a future date.' });
    let saved = 0;
    await tx(async (c) => {
      for (const r of rows) {
        const hasData = FIELDS.some((f) => r[f] !== null) || (r.notes && r.notes.trim());
        if (!hasData) {
          await c.query('DELETE FROM snapshots WHERE account_id = $1 AND date = $2', [r.account_id, date]);
          continue;
        }
        const cols = ['account_id', 'date', ...FIELDS, 'notes', 'updated_by'];
        const vals = [r.account_id, date, ...FIELDS.map((f) => r[f]), r.notes || null, req.user.id];
        const ph = cols.map((_, i) => `$${i + 1}`).join(',');
        const upd = [...FIELDS, 'notes', 'updated_by'].map((f) => `${f} = EXCLUDED.${f}`).join(', ');
        await c.query(
          `INSERT INTO snapshots (${cols.join(',')}) VALUES (${ph})
           ON CONFLICT (account_id, date) DO UPDATE SET ${upd}, updated_at = now()`,
          vals
        );
        saved++;
      }
    });
    await audit(req, 'snapshots.saved', 'snapshot', date, { accounts: saved });
    res.json({ ok: true, saved });
  })
);

/** CSV export of all logged numbers in a range. */
router.get(
  '/export.csv',
  ah(async (req, res) => {
    const end = parse(zDate.optional(), req.query.end) || today();
    const start = parse(zDate.optional(), req.query.start) || addDays(end, -90);
    const rows = await many(
      `SELECT s.date, a.brand, a.username, a.platform, ${FIELDS.map((f) => 's.' + f).join(', ')}, s.notes
       FROM snapshots s JOIN accounts a ON a.id = s.account_id
       WHERE s.date BETWEEN $1 AND $2 ORDER BY s.date, a.id`,
      [start, end]
    );
    const header = ['date', 'brand', 'username', 'platform', ...FIELDS, 'notes'];
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header.join(','), ...rows.map((r) => header.map((h) => esc(r[h])).join(','))].join('\n');
    await audit(req, 'snapshots.exported', 'snapshot', null, { start, end, rows: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="social-data-${start}-to-${end}.csv"`);
    res.send(csv);
  })
);

export default router;
