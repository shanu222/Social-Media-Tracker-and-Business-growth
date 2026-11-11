import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { monthlyKpis } from '../services/analytics.js';
import { ah, parse, zDate, zMonth, today } from '../util.js';

const router = Router();

const metricSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60).default('Business'),
  unit: z.string().max(30).nullish(),
  aggregation: z.enum(['sum', 'last', 'avg']).default('sum'),
  higher_is_better: z.boolean().default(true),
});

router.get('/', ah(async (_req, res) => {
  res.json(await many('SELECT * FROM metrics WHERE active = TRUE ORDER BY position, id'));
}));

router.post('/', requireRole('manager'), ah(async (req, res) => {
  const b = parse(metricSchema, req.body);
  const existing = await one('SELECT * FROM metrics WHERE lower(name) = lower($1)', [b.name]);
  if (existing?.active) return res.status(409).json({ error: 'A metric with this name already exists.' });
  const m = existing
    ? await one('UPDATE metrics SET active = TRUE, category=$2, unit=$3, aggregation=$4, higher_is_better=$5 WHERE id=$1 RETURNING *',
        [existing.id, b.category, b.unit || null, b.aggregation, b.higher_is_better])
    : await one(
        `INSERT INTO metrics (name, category, unit, aggregation, higher_is_better, position)
         VALUES ($1,$2,$3,$4,$5,(SELECT coalesce(max(position),0)+1 FROM metrics)) RETURNING *`,
        [b.name, b.category, b.unit || null, b.aggregation, b.higher_is_better]
      );
  await audit(req, 'metric.created', 'metric', m.id, { name: m.name });
  res.status(201).json(m);
}));

router.put('/:id(\\d+)', requireRole('manager'), ah(async (req, res) => {
  const b = parse(metricSchema, req.body);
  const m = await one(
    'UPDATE metrics SET name=$2, category=$3, unit=$4, aggregation=$5, higher_is_better=$6 WHERE id=$1 RETURNING *',
    [Number(req.params.id), b.name, b.category, b.unit || null, b.aggregation, b.higher_is_better]
  );
  if (!m) return res.status(404).json({ error: 'Metric not found.' });
  res.json(m);
}));

router.delete('/:id(\\d+)', requireRole('manager'), ah(async (req, res) => {
  await query('UPDATE metrics SET active = FALSE WHERE id = $1', [Number(req.params.id)]);
  await audit(req, 'metric.removed', 'metric', req.params.id);
  res.json({ ok: true });
}));

/** Values logged for one day */
router.get('/day', ah(async (req, res) => {
  const date = parse(zDate.optional(), req.query.date) || today();
  const rows = await many(
    `SELECT m.*, e.value, e.note FROM metrics m
     LEFT JOIN metric_entries e ON e.metric_id = m.id AND e.date = $1
     WHERE m.active = TRUE ORDER BY m.position, m.id`,
    [date]
  );
  res.json({ date, rows });
}));

router.put('/day', requireRole('manager'), ah(async (req, res) => {
  const { date, entries } = parse(
    z.object({
      date: zDate,
      entries: z.array(z.object({
        metric_id: z.number().int().positive(),
        value: z.union([z.number().finite(), z.null()]),
        note: z.string().max(1000).nullish(),
      })).max(200),
    }),
    req.body
  );
  await tx(async (c) => {
    for (const e of entries) {
      if (e.value === null) {
        await c.query('DELETE FROM metric_entries WHERE metric_id=$1 AND date=$2', [e.metric_id, date]);
      } else {
        await c.query(
          `INSERT INTO metric_entries (metric_id, date, value, note, updated_by) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (metric_id, date) DO UPDATE SET value=EXCLUDED.value, note=EXCLUDED.note,
             updated_by=EXCLUDED.updated_by, updated_at=now()`,
          [e.metric_id, date, e.value, e.note || null, req.user.id]
        );
      }
    }
  });
  await audit(req, 'metrics.saved', 'metric_entry', date, { count: entries.length });
  res.json({ ok: true });
}));

/** Monthly KPI sheet (target / actual / previous / status) */
router.get('/month', ah(async (req, res) => {
  const month = parse(zMonth.optional(), req.query.month) || today().slice(0, 7);
  res.json({ month, rows: await monthlyKpis(month) });
}));

router.put('/targets', requireRole('manager'), ah(async (req, res) => {
  const { month, targets } = parse(
    z.object({
      month: zMonth,
      targets: z.array(z.object({
        metric_id: z.number().int().positive(),
        target: z.union([z.number().finite(), z.null()]),
        comment: z.string().max(1000).nullish(),
      })).max(200),
    }),
    req.body
  );
  await tx(async (c) => {
    for (const t of targets) {
      await c.query(
        `INSERT INTO metric_targets (metric_id, month, target, comment) VALUES ($1,$2,$3,$4)
         ON CONFLICT (metric_id, month) DO UPDATE SET target=EXCLUDED.target, comment=EXCLUDED.comment`,
        [t.metric_id, month, t.target, t.comment || null]
      );
    }
  });
  await audit(req, 'metrics.targets_saved', 'metric_target', month);
  res.json({ ok: true });
}));

export default router;
