import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { monthlyKpis } from '../services/analytics.js';
import { ah, parse, zDate, zMonth, today } from '../util.js';
import { canAccessProduct, productIdsFor } from '../access.js';
import { PRODUCT_TYPES, typeList, setupProductKpis } from '../services/kpiTemplates.js';

/** ?scope=company (default) or a product id the user can access. Returns 'company' or the id. */
async function scopeOf(req) {
  const raw = req.query.scope ?? req.body?.scope ?? req.body?.product_id ?? 'company';
  if (raw === 'company' || raw === null || raw === '') return 'company';
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || !(await canAccessProduct(req.user, id))) {
    const e = new Error('Product not found.'); e.status = 404; throw e;
  }
  return id;
}

const router = Router();

const metricSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60).default('Business'),
  unit: z.string().max(30).nullish(),
  aggregation: z.enum(['sum', 'last', 'avg']).default('sum'),
  higher_is_better: z.boolean().default(true),
});

router.get('/', ah(async (req, res) => {
  const scope = await scopeOf(req);
  res.json(await many(
    `SELECT * FROM metrics WHERE active = TRUE AND ${scope === 'company' ? 'product_id IS NULL' : 'product_id = $1'} ORDER BY position, id`,
    scope === 'company' ? [] : [scope]
  ));
}));

/** Product types with their suggested KPI sets */
router.get('/types', ah(async (_req, res) => res.json(typeList())));

/** Company-wide plus every product the user can see, with its type and KPI count */
router.get('/scopes', ah(async (req, res) => {
  const ids = await productIdsFor(req.user);
  const month = today().slice(0, 7);
  const rows = await many(
    `SELECT p.id, p.name, p.color, p.category,
       count(m.id) FILTER (WHERE m.active)::int AS metrics,
       count(t.metric_id) FILTER (WHERE m.active AND t.target IS NOT NULL)::int AS targets
     FROM products p LEFT JOIN metrics m ON m.product_id = p.id
     LEFT JOIN metric_targets t ON t.metric_id = m.id AND t.month = $2
     WHERE p.archived = FALSE AND p.id = ANY($1) GROUP BY p.id ORDER BY p.name`,
    [ids, month]
  );
  const company = await one(
    `SELECT count(m.id)::int AS metrics, count(t.metric_id) FILTER (WHERE t.target IS NOT NULL)::int AS targets
     FROM metrics m LEFT JOIN metric_targets t ON t.metric_id = m.id AND t.month = $1 WHERE m.product_id IS NULL AND m.active`, [month]
  );
  res.json([
    { id: 'company', name: 'Company-wide', category: null, typeLabel: 'All of RTL', ...company },
    ...rows.map((r) => ({ ...r, typeLabel: PRODUCT_TYPES[r.category]?.label || 'Other' })),
  ]);
}));

/** Admin: set a product's type and add its KPI set (all suggested metrics, or the chosen ones) */
router.post('/setup', requireRole('admin'), ah(async (req, res) => {
  const b = parse(z.object({ product_id: z.number().int().positive(), type: z.enum(Object.keys(PRODUCT_TYPES)), names: z.array(z.string()).max(30).optional() }), req.body);
  const n = await tx(async (c) => {
    await c.query('UPDATE products SET category = $2 WHERE id = $1', [b.product_id, b.type]);
    return setupProductKpis(c, b.product_id, b.type, b.names || null);
  });
  await audit(req, 'metrics.setup', 'product', b.product_id, { type: b.type, count: n });
  res.json({ ok: true, count: n });
}));

router.post('/', requireRole('admin'), ah(async (req, res) => {
  const b = parse(metricSchema, req.body);
  const scope = await scopeOf(req);
  const pid = scope === 'company' ? null : scope;
  const existing = await one('SELECT * FROM metrics WHERE lower(name) = lower($1) AND product_id IS NOT DISTINCT FROM $2', [b.name, pid]);
  if (existing?.active) return res.status(409).json({ error: 'A metric with this name already exists.' });
  const m = existing
    ? await one('UPDATE metrics SET active = TRUE, category=$2, unit=$3, aggregation=$4, higher_is_better=$5 WHERE id=$1 RETURNING *',
        [existing.id, b.category, b.unit || null, b.aggregation, b.higher_is_better])
    : await one(
        `INSERT INTO metrics (name, category, unit, aggregation, higher_is_better, position, product_id)
         VALUES ($1,$2,$3,$4,$5,(SELECT coalesce(max(position),0)+1 FROM metrics WHERE product_id IS NOT DISTINCT FROM $6),$6) RETURNING *`,
        [b.name, b.category, b.unit || null, b.aggregation, b.higher_is_better, pid]
      );
  await audit(req, 'metric.created', 'metric', m.id, { name: m.name });
  res.status(201).json(m);
}));

router.put('/:id(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const b = parse(metricSchema, req.body);
  const m = await one(
    'UPDATE metrics SET name=$2, category=$3, unit=$4, aggregation=$5, higher_is_better=$6 WHERE id=$1 RETURNING *',
    [Number(req.params.id), b.name, b.category, b.unit || null, b.aggregation, b.higher_is_better]
  );
  if (!m) return res.status(404).json({ error: 'Metric not found.' });
  res.json(m);
}));

router.delete('/:id(\\d+)', requireRole('admin'), ah(async (req, res) => {
  await query('UPDATE metrics SET active = FALSE WHERE id = $1', [Number(req.params.id)]);
  await audit(req, 'metric.removed', 'metric', req.params.id);
  res.json({ ok: true });
}));

/** Values logged for one day */
router.get('/day', ah(async (req, res) => {
  const date = parse(zDate.optional(), req.query.date) || today();
  const scope = await scopeOf(req);
  // Only metrics entered by hand; social metrics come from the accounts automatically
  const rows = await many(
    `SELECT m.*, e.value, e.note FROM metrics m
     LEFT JOIN metric_entries e ON e.metric_id = m.id AND e.date = $1
     WHERE m.active = TRUE AND m.source = 'manual' AND ${scope === 'company' ? 'm.product_id IS NULL' : 'm.product_id = $2'}
     ORDER BY m.position, m.id`,
    scope === 'company' ? [date] : [date, scope]
  );
  res.json({ date, scope, rows });
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
  const ids = await productIdsFor(req.user);
  const allowed = new Set((await many(
    "SELECT id FROM metrics WHERE id = ANY($1) AND source = 'manual' AND (product_id IS NULL OR product_id = ANY($2))",
    [entries.map((e) => e.metric_id), ids]
  )).map((r) => r.id));
  if (entries.some((e) => !allowed.has(e.metric_id))) return res.status(400).json({ error: 'Some of these numbers can’t be edited here.' });
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
  const scope = await scopeOf(req);
  res.json({ month, scope, rows: await monthlyKpis(month, scope) });
}));

router.put('/targets', requireRole('admin'), ah(async (req, res) => {
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
