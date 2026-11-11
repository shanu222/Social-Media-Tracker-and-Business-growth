import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { growthSummary, checklistCompletion, buildInsights, businessMetrics, monthlyKpis } from '../services/analytics.js';
import { renderReportPdf } from '../services/reportPdf.js';
import { storageEnabled, putObject, deleteObject } from '../storage.js';
import { ah, parse, zDate, zMonth, today, addDays, weekStart, monthRange, isoWeekKey } from '../util.js';

const router = Router();

async function buildReportData(kind, start, end, month) {
  const [summary, checklist] = await Promise.all([growthSummary(start, end), checklistCompletion(start, end)]);
  let kpis;
  if (kind === 'monthly') {
    kpis = await monthlyKpis(month);
  } else {
    const len = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
    const [cur, prev] = await Promise.all([
      businessMetrics(start, end),
      businessMetrics(addDays(start, -len), addDays(start, -1)),
    ]);
    kpis = cur.map((m) => ({ ...m, previous: prev.find((p) => p.id === m.id)?.value ?? null, target: null, status: null }));
  }
  kpis = kpis.filter((k) => k.value !== null || k.target !== null);

  let reviews = [], summaryText = null;
  const actionMonth = month || end.slice(0, 7);
  if (kind === 'monthly') {
    reviews = await many(
      `SELECT a.brand, r.* FROM account_reviews r JOIN accounts a ON a.id = r.account_id WHERE r.month = $1 ORDER BY a.id`,
      [month]
    );
    summaryText = await one('SELECT * FROM monthly_summaries WHERE month = $1', [month]);
  }
  const actions = await many(
    `SELECT x.title, x.owner, x.deadline, x.done, a.brand FROM action_items x
     LEFT JOIN accounts a ON a.id = x.account_id WHERE x.month = $1 ORDER BY x.done, x.deadline NULLS LAST`,
    [actionMonth]
  );
  const { series, ...rest } = summary;
  return {
    range: { start, end },
    ...rest,
    accounts: rest.accounts.map(({ deltas, ...a }) => a),
    series,
    checklist,
    kpis,
    insights: buildInsights(summary, checklist),
    reviews,
    summary: summaryText,
    actions,
  };
}

router.get('/', ah(async (_req, res) => {
  res.json(
    await many(
      `SELECT r.id, r.title, r.kind, r.start_date, r.end_date, r.storage_key IS NOT NULL AS in_cloud, r.created_at,
         u.name AS created_by_name,
         (r.data->'totals'->>'end_followers')::int AS followers,
         (r.data->'totals'->>'net_change')::int AS net_change
       FROM reports r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.created_at DESC LIMIT 200`
    )
  );
}));

router.post('/', requireRole('manager'), ah(async (req, res) => {
  const b = parse(
    z.object({
      kind: z.enum(['weekly', 'monthly', 'custom']),
      month: zMonth.optional(),
      weekOf: zDate.optional(),
      start: zDate.optional(),
      end: zDate.optional(),
      title: z.string().max(150).optional(),
    }),
    req.body
  );
  let start, end, month, title;
  if (b.kind === 'monthly') {
    month = b.month || today().slice(0, 7);
    ({ start, end } = monthRange(month));
    const label = new Date(start + 'T00:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    title = b.title || `Monthly growth report — ${label}`;
  } else if (b.kind === 'weekly') {
    start = weekStart(b.weekOf || today());
    end = addDays(start, 6);
    title = b.title || `Weekly growth log — ${isoWeekKey(start)}`;
  } else {
    if (!b.start || !b.end || b.start > b.end) return res.status(400).json({ error: 'Choose a start date before the end date.' });
    if ((new Date(b.end) - new Date(b.start)) / 86400000 > 366) return res.status(400).json({ error: 'Custom reports can cover up to one year.' });
    ({ start, end } = b);
    title = b.title || `Growth report — ${start} to ${end}`;
  }
  if (end > today()) end = today() < start ? end : today();

  const data = await buildReportData(b.kind, start, end, month);
  let report = await one(
    'INSERT INTO reports (title, kind, start_date, end_date, data, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [title, b.kind, start, end, data, req.user.id]
  );

  // Keep a copy of the PDF in Cloudflare R2 when storage is configured
  if (storageEnabled) {
    try {
      const pdf = await renderReportPdf({ ...report, created_by_name: req.user.name });
      const key = `reports/${report.id}-${b.kind}-${start}.pdf`;
      await putObject(key, pdf, 'application/pdf');
      report = await one('UPDATE reports SET storage_key = $2 WHERE id = $1 RETURNING *', [report.id, key]);
    } catch (e) {
      console.error('[reports] cloud upload failed:', e.message);
    }
  }
  await audit(req, 'report.generated', 'report', report.id, { title });
  res.status(201).json(report);
}));

router.get('/:id', ah(async (req, res) => {
  const r = await one('SELECT r.*, u.name AS created_by_name FROM reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = $1', [Number(req.params.id)]);
  if (!r) return res.status(404).json({ error: 'Report not found.' });
  res.json(r);
}));

router.get('/:id/pdf', ah(async (req, res) => {
  const r = await one('SELECT r.*, u.name AS created_by_name FROM reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = $1', [Number(req.params.id)]);
  if (!r) return res.status(404).json({ error: 'Report not found.' });
  const pdf = await renderReportPdf(r);
  await audit(req, 'report.downloaded', 'report', r.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-${r.id}-${r.start_date}.pdf"`);
  res.send(pdf);
}));

router.delete('/:id', requireRole('admin'), ah(async (req, res) => {
  const r = await one('DELETE FROM reports WHERE id = $1 RETURNING id, storage_key', [Number(req.params.id)]);
  if (!r) return res.status(404).json({ error: 'Report not found.' });
  if (r.storage_key && storageEnabled) deleteObject(r.storage_key).catch(() => {});
  await audit(req, 'report.deleted', 'report', r.id);
  res.json({ ok: true });
}));

export default router;
