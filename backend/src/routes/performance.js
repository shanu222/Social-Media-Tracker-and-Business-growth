import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db.js';
import { audit } from '../audit.js';
import { ah, parse, zDate, today } from '../util.js';
import { personReport, teamReport, ruleInsights } from '../services/performance.js';
import { complete, providerLabel, cacheGet, cacheSet } from '../services/aiProviders.js';
import { renderPerformancePdf } from '../services/performancePdf.js';

/*
 * Performance and productivity reports. The admin sees everyone (including themselves);
 * every other member can only open their own report.
 */
const router = Router();

const filters = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  user_id: z.coerce.number().int().positive().optional(),
  product_id: z.coerce.number().int().positive().optional(),
});

async function build(req) {
  const f = parse(filters, req.query);
  const to = f.to || today();
  const from = f.from || `${to.slice(0, 7)}-01`;
  if (from > to) { const e = new Error('The start date must be before the end date.'); e.status = 400; throw e; }
  if ((new Date(to) - new Date(from)) / 86400000 > 731) { const e = new Error('Choose a period of two years or less.'); e.status = 400; throw e; }
  let userId = f.user_id;
  if (req.user.role !== 'admin') userId = req.user.id;
  if (userId) {
    const r = await personReport(userId, from, to, f.product_id ?? null);
    if (!r) { const e = new Error('Person not found.'); e.status = 404; throw e; }
    return { mode: 'person', ...r, insights: ruleInsights(r) };
  }
  const r = await teamReport(from, to, f.product_id ?? null);
  return { mode: 'team', ...r, insights: ruleInsights(r) };
}

router.get('/', ah(async (req, res) => {
  const r = await build(req);
  if (req.query.product_id) r.product = await one('SELECT id, name FROM products WHERE id = $1', [Number(req.query.product_id)]);
  res.json(r);
}));

const SYSTEM = `You are an operations analyst writing a short, fair management summary of team work data for a company admin.
Use ONLY the numbers provided. Never invent facts, names or causes. Be specific and neutral; no praise inflation, no blame.
Measure work by task outcomes and logged task time, never by online presence.
Reply with JSON only: {"summary": "2-3 sentences", "highlights": ["..."], "concerns": ["..."], "recommendations": ["..."]}
Each list has at most 4 short items (under 25 words each). Use an empty list when there is nothing to say.`;

function compactForAi(r) {
  const base = { period: r.range, previous_period: r.previousRange, product_filter: r.product?.name || 'all products' };
  if (r.mode === 'team') {
    return { ...base, team: r.team, people: r.people.map((p) => ({ name: p.name, title: p.title, role: p.role, now: p.indicators, before: p.previous, time_by_product: p.timeByProduct.map((x) => ({ product: x.name, hours: x.hours })), management: p.management })), time_by_product: r.timeByProduct.map((x) => ({ product: x.name, hours: x.hours })) };
  }
  return { ...base, person: { name: r.user.name, title: r.user.title, role: r.user.role }, now: r.indicators, before: r.previous, management: r.management, time_by_product: r.timeByProduct.map((x) => ({ product: x.name, hours: x.hours })), tasks_by_product: r.tasksByProduct, trend: r.trend, activity: r.activity, overdue_or_stalled: r.attention.map((a) => a.text) };
}

function parseSummary(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('No JSON in reply');
  const o = JSON.parse(text.slice(s, e + 1));
  if (typeof o.summary !== 'string' || !o.summary.trim()) throw new Error('No summary');
  const list = (v) => (Array.isArray(v) ? v.map(String).map((x) => x.slice(0, 300)).slice(0, 4) : []);
  return { summary: o.summary.slice(0, 1200), highlights: list(o.highlights), concerns: list(o.concerns), recommendations: list(o.recommendations) };
}

router.post('/summary', ah(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
  req.query = { ...req.query, ...req.body };
  const r = await build(req);
  const data = compactForAi(r);
  const key = `perf:${JSON.stringify(data)}`;
  const hit = cacheGet(key);
  if (hit && !req.body.refresh) return res.json({ ok: true, ...hit, cached: true });
  try {
    const { result, provider, model, keyLabel } = await complete(SYSTEM, `Work data:\n${JSON.stringify(data)}`, parseSummary);
    const value = { ...result, provider, providerLabel: providerLabel(provider), model, keyLabel };
    cacheSet(key, value);
    await audit(req, 'ai.performance_summary', 'user', r.user?.id ?? null);
    res.json({ ok: true, ...value, cached: false });
  } catch (e) {
    res.json({ ok: false, reason: (e.attempts || []).length ? 'The AI keys could not answer right now.' : 'No AI key is set up yet.', insights: r.insights });
  }
}));

router.get('/pdf', ah(async (req, res) => {
  const r = await build(req);
  if (req.query.product_id) r.product = await one('SELECT id, name FROM products WHERE id = $1', [Number(req.query.product_id)]);
  const pdf = await renderPerformancePdf(r, { generatedBy: req.user.name });
  await audit(req, 'report.performance_downloaded', 'user', r.user?.id ?? null);
  const who = r.mode === 'person' ? r.user.name.replace(/[^\w]+/g, '-') : 'team';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="performance-${who}-${r.range.from}-to-${r.range.to}.pdf"`);
  res.send(pdf);
}));

export default router;
