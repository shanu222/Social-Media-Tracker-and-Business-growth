import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../db.js';
import { growthSummary, checklistCompletion, buildInsights, businessMetrics } from '../services/analytics.js';
import { ah, parse, today, addDays } from '../util.js';

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
      businessMetrics(start, end),
      businessMetrics(prevStart, prevEnd),
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

  res.json({
    range: { start, end, days },
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
