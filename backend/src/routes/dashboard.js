import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../db.js';
import { growthSummary, checklistCompletion, buildInsights, businessMetrics, monthlyKpis } from '../services/analytics.js';
import { ah, parse, today, addDays, monthRange } from '../util.js';

const router = Router();

router.get('/', ah(async (req, res) => {
  const days = parse(z.coerce.number().int().min(7).max(366).default(30), req.query.days);
  const end = today();
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));

  const [summary, checklist, prevSummary, business, prevBusiness, todayLogged, todayChecklist, actions, streakRows] =
    await Promise.all([
      growthSummary(start, end),
      checklistCompletion(start, end),
      growthSummary(prevStart, prevEnd),
      businessMetrics(start, end, undefined, { manualOnly: true }),
      businessMetrics(prevStart, prevEnd, undefined, { manualOnly: true }),
      one('SELECT count(DISTINCT account_id)::int AS n FROM snapshots WHERE date = $1', [end]),
      one(
        `SELECT count(*)::int AS total,
           count(c.task_id)::int AS done
         FROM checklist_tasks t
         LEFT JOIN checklist_completions c ON c.task_id = t.id AND c.period_key = $1
         WHERE t.active = TRUE AND t.frequency = 'daily'`,
        [end]
      ),
      many(
        `SELECT x.*, a.brand FROM action_items x LEFT JOIN accounts a ON a.id = x.account_id
         WHERE x.done = FALSE ORDER BY x.deadline NULLS LAST, x.id LIMIT 6`
      ),
      many('SELECT DISTINCT date FROM snapshots WHERE date > $1 ORDER BY date DESC', [addDays(end, -120)]),
    ]);

  // Consecutive days (ending today or yesterday) with at least one entry
  const logged = new Set(streakRows.map((r) => r.date));
  let streak = 0;
  let cursor = logged.has(end) ? end : addDays(end, -1);
  while (logged.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  // Followers trajectory: this period vs the previous period, aligned by day
  const trajectory = summary.daily.map((d, i) => ({ date: d.date, total: d.total, previous: prevSummary.daily[i]?.total ?? null, reach: d.reach, engagements: d.engagements }));

  // Audience by platform and by product
  const group = (key) => {
    const m = new Map();
    for (const a of summary.accounts) {
      const k = a[key];
      if (k === null || k === undefined) continue;
      const g = m.get(k) || { key: k, followers: 0, start: 0, net: 0, accounts: 0 };
      g.followers += a.end_followers || 0; g.start += a.start_followers || 0; g.net += a.net_change || 0; g.accounts++;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, growth_pct: g.start ? Math.round((g.net / g.start) * 1000) / 10 : null })).sort((x, y) => y.followers - x.followers);
  };
  const productNames = new Map((await many('SELECT id, name, color FROM products WHERE archived = FALSE')).map((p) => [p.id, p]));
  const products = group('product_id').filter((g) => productNames.has(g.key)).map((g) => ({ ...g, id: g.key, name: productNames.get(g.key).name }));
  const platforms = group('platform').map((g) => ({ ...g, platform: g.key }));

  // Business: last 6 months per metric, plus this month's goals
  const month = end.slice(0, 7);
  const months = [];
  for (let k = 5; k >= 0; k--) { const [y, mo] = month.split('-').map(Number); months.push(new Date(Date.UTC(y, mo - 1 - k, 1)).toISOString().slice(0, 7)); }
  const monthly = await Promise.all(months.map((m) => { const r = monthRange(m); return businessMetrics(r.start, r.end, undefined, { manualOnly: true }); }));
  const businessTrend = (monthly[0] || []).filter((m) => !m.auto).map((m) => ({
    id: m.id, name: m.product_name ? `${m.product_name} · ${m.name}` : m.name, unit: m.unit, higher_is_better: m.higher_is_better,
    points: months.map((mo, i) => ({ month: mo, value: monthly[i].find((x) => x.id === m.id)?.value ?? null })),
  })).filter((m) => m.points.some((p) => p.value !== null));
  const goals = (await monthlyKpis(month)).filter((k) => k.target !== null && k.target !== undefined)
    .map((k) => ({ id: k.id, name: k.product_name ? `${k.product_name} · ${k.name}` : k.name, unit: k.unit, value: k.value, target: k.target, higher_is_better: k.higher_is_better }));

  res.json({
    range: { start, end, days },
    trajectory, products, platforms, businessTrend, goals,
    totals: summary.totals,
    previousTotals: prevSummary.totals,
    accounts: summary.accounts,
    series: summary.series,
    checklist,
    business: business.map((m) => ({
      ...m,
      previous: prevBusiness.find((p) => p.id === m.id)?.value ?? null,
    })),
    today: {
      date: end,
      accountsLogged: todayLogged.n,
      checklistDone: todayChecklist.done,
      checklistTotal: todayChecklist.total,
    },
    streak,
    actions,
    insights: buildInsights(summary, checklist),
  });
}));

export default router;
