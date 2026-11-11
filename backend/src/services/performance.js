import { many, one } from '../db.js';
import { config } from '../config.js';
import { addDays, today } from '../util.js';

/*
 * Work performance for one person over a period, built only from task workflow data and
 * time logged on tasks — never from online presence.
 *
 *  Task completion rate  = completed in period ÷ tasks assigned and open at some point in the period × 100
 *  On-time completion    = completed on or before the due date ÷ completed × 100 (tasks without a due date count as on time)
 *  Work progress         = average reported progress of tasks still open
 *  Avg completion time   = average time from a task being sent to its completion
 */

const TZ = config.timezone || 'Asia/Karachi';
const round = (n, d = 0) => (n === null || n === undefined || !isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (a, b) => (b ? round((a / b) * 100) : null);

const ACTIVITY_GROUPS = [
  ['Task planning', /^(task\.(created|sent|updated|deleted)|ai\.suggested)$/],
  ['Task work', /^(task\.(done|in_progress|todo|progress)|time\.logged|post\.recorded)$/],
  ['Communication', /^(task\.(comment|clarification)|announcement\.)/],
  ['Products & accounts', /^(product\.|account\.)/],
  ['Data & reports', /^(snapshots\.|metrics\.|report\.|review|checklist|file\.|link\.)/],
  ['Team & settings', /^(user\.|ai\.key|system\.|backup)/],
];

export function bucketsFor(from, to) {
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const size = days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
  const out = [];
  let d = from;
  while (d <= to) {
    let end;
    if (size === 'day') end = d;
    else if (size === 'week') end = addDays(d, 6);
    else { const [y, m] = d.split('-').map(Number); end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
    if (end > to) end = to;
    out.push({ start: d, end });
    d = addDays(end, 1);
  }
  return { size, buckets: out, days };
}

const nice = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const localDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });

/** Core numbers for one person. Light mode skips lists and trends (used for team tables). */
export async function personPerformance(userId, from, to, { productId = null, light = false } = {}) {
  const params = [userId, from, to, TZ, productId];
  const W = `($2::date)::timestamp AT TIME ZONE $4`;
  const E = `($3::date + 1)::timestamp AT TIME ZONE $4`;
  const P = `($5::int IS NULL OR t.product_id = $5)`;

  const tasks = await many(
    `SELECT t.id, t.title, t.product_id, p.name AS product_name, t.status, t.priority, t.progress, t.due_date,
       coalesce(t.sent_at, t.created_at) AS assigned_at, t.completed_at, t.updated_at,
       (SELECT count(*)::int FROM task_comments c WHERE c.task_id = t.id AND c.kind = 'clarification') AS clarifications
     FROM tasks t JOIN products p ON p.id = t.product_id
     WHERE t.assigned_to = $1 AND t.status NOT IN ('draft','cancelled') AND ${P}
       AND coalesce(t.sent_at, t.created_at) < ${E}
       AND (t.completed_at IS NULL OR t.completed_at >= ${W})`,
    params
  );
  const inRange = (ts) => ts && localDate(ts) >= from && localDate(ts) <= to;
  const completed = tasks.filter((t) => t.status === 'done' && inRange(t.completed_at));
  const onTime = completed.filter((t) => !t.due_date || localDate(t.completed_at) <= t.due_date);
  const open = tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress');
  const now = today();
  const overdue = open.filter((t) => t.due_date && t.due_date < now);
  const hoursToDone = completed.map((t) => (new Date(t.completed_at) - new Date(t.assigned_at)) / 3600000).filter((h) => h >= 0);

  const time = await many(
    `SELECT x.task_id, x.product_id, p.name AS product_name, x.started_at,
       coalesce(x.minutes, GREATEST(0, round(extract(epoch FROM now() - x.started_at) / 60)::int)) AS minutes
     FROM task_time x JOIN products p ON p.id = x.product_id JOIN tasks t ON t.id = x.task_id
     WHERE x.user_id = $1 AND x.started_at >= ${W} AND x.started_at < ${E} AND ${P}`,
    params
  );
  const totalMinutes = time.reduce((s, x) => s + x.minutes, 0);

  const indicators = {
    assigned: tasks.length,
    completed: completed.length,
    in_progress: open.filter((t) => t.status === 'in_progress').length,
    not_started: open.filter((t) => t.status === 'todo').length,
    overdue: overdue.length,
    completion_rate: pct(completed.length, tasks.length),
    on_time_rate: pct(onTime.length, completed.length),
    late: completed.length - onTime.length,
    avg_progress: open.length ? round(open.reduce((s, t) => s + t.progress, 0) / open.length) : null,
    avg_completion_hours: hoursToDone.length ? round(hoursToDone.reduce((a, b) => a + b, 0) / hoursToDone.length, 1) : null,
    hours: round(totalMinutes / 60, 1),
  };
  if (light) return { indicators };

  // Time by product
  const byProduct = new Map();
  for (const x of time) {
    const g = byProduct.get(x.product_id) || { product_id: x.product_id, name: x.product_name, minutes: 0 };
    g.minutes += x.minutes; byProduct.set(x.product_id, g);
  }
  const timeByProduct = [...byProduct.values()].map((g) => ({ ...g, hours: round(g.minutes / 60, 1) })).sort((a, b) => b.minutes - a.minutes);

  // Tasks by product (assigned / completed) for allocation when no time is logged yet
  const taskProducts = new Map();
  for (const t of tasks) {
    const g = taskProducts.get(t.product_id) || { product_id: t.product_id, name: t.product_name, assigned: 0, completed: 0 };
    g.assigned++; if (completed.includes(t)) g.completed++;
    taskProducts.set(t.product_id, g);
  }

  // Trend
  const { size, buckets } = bucketsFor(from, to);
  const trend = buckets.map((b) => {
    const done = completed.filter((t) => { const d = localDate(t.completed_at); return d >= b.start && d <= b.end; });
    const mins = time.filter((x) => { const d = localDate(x.started_at); return d >= b.start && d <= b.end; }).reduce((s, x) => s + x.minutes, 0);
    return { start: b.start, end: b.end, completed: done.length, on_time: done.filter((t) => !t.due_date || localDate(t.completed_at) <= t.due_date).length, hours: round(mins / 60, 1) };
  });

  // Activity (all work actions recorded in the audit log)
  const audits = await many(
    `SELECT action, count(*)::int AS n FROM audit_log WHERE user_id = $1 AND created_at >= ${W} AND created_at < ${E}
       AND action NOT LIKE 'login.%' GROUP BY action`,
    params.slice(0, 4)
  );
  const activity = ACTIVITY_GROUPS.map(([label, re]) => ({ label, count: audits.filter((a) => re.test(a.action)).reduce((s, a) => s + a.n, 0) })).filter((a) => a.count > 0);

  const mgmt = await one(
    `SELECT
       (SELECT count(*)::int FROM tasks t WHERE t.created_by = $1 AND t.created_at >= ${W} AND t.created_at < ${E} AND ${P}) AS tasks_created,
       (SELECT count(*)::int FROM tasks t WHERE t.created_by = $1 AND t.status = 'done' AND t.completed_at >= ${W} AND t.completed_at < ${E} AND ${P}) AS created_tasks_completed,
       (SELECT count(*)::int FROM direct_messages d WHERE d.sender_id = $1 AND d.created_at >= ${W} AND d.created_at < ${E}) AS messages_sent,
       (SELECT count(*)::int FROM announcements a WHERE a.created_by = $1 AND a.created_at >= ${W} AND a.created_at < ${E}) AS announcements,
       (SELECT count(*)::int FROM task_comments c JOIN tasks t ON t.id = c.task_id WHERE c.user_id = $1 AND c.kind <> 'system' AND c.created_at >= ${W} AND c.created_at < ${E} AND ${P}) AS comments`,
    params
  );

  const stalled = open.filter((t) => t.status === 'in_progress' && (Date.now() - new Date(t.updated_at)) / 86400000 >= 5);
  return {
    indicators,
    management: mgmt,
    timeByProduct,
    tasksByProduct: [...taskProducts.values()].sort((a, b) => b.assigned - a.assigned),
    trend: { size, points: trend },
    activity,
    active: open.sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1).slice(0, 12)
      .map((t) => ({ id: t.id, title: t.title, product_id: t.product_id, product_name: t.product_name, status: t.status, progress: t.progress, due_date: t.due_date, overdue: Boolean(t.due_date && t.due_date < now) })),
    achievements: completed.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at)).slice(0, 10)
      .map((t) => ({ id: t.id, title: t.title, product_id: t.product_id, product_name: t.product_name, completed_at: t.completed_at, on_time: !t.due_date || localDate(t.completed_at) <= t.due_date, priority: t.priority })),
    attention: [
      ...overdue.map((t) => ({ type: 'overdue', text: `Overdue since ${nice(t.due_date)}: ${t.title}`, task_id: t.id, product_id: t.product_id })),
      ...stalled.map((t) => ({ type: 'stalled', text: `No update for 5+ days: ${t.title}`, task_id: t.id, product_id: t.product_id })),
      ...open.filter((t) => t.clarifications > 0).map((t) => ({ type: 'clarification', text: `Asked for clarification: ${t.title}`, task_id: t.id, product_id: t.product_id })),
    ].slice(0, 10),
  };
}

export function previousRange(from, to) {
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

export async function personReport(userId, from, to, productId = null) {
  const user = await one('SELECT id, name, title, role, email FROM users WHERE id = $1', [userId]);
  if (!user) return null;
  const prev = previousRange(from, to);
  const [cur, before] = await Promise.all([
    personPerformance(userId, from, to, { productId }),
    personPerformance(userId, prev.from, prev.to, { productId, light: true }),
  ]);
  return { user: { id: user.id, name: user.name, title: user.title, role: user.role }, range: { from, to }, previousRange: prev, ...cur, previous: before.indicators };
}

export async function teamReport(from, to, productId = null) {
  const users = await many("SELECT id, name, title, role FROM users WHERE active = TRUE AND role IN ('admin','manager') ORDER BY role, name");
  const prev = previousRange(from, to);
  const rows = [];
  for (const u of users) {
    const [cur, before] = await Promise.all([
      personPerformance(u.id, from, to, { productId }),
      personPerformance(u.id, prev.from, prev.to, { productId, light: true }),
    ]);
    rows.push({ ...u, indicators: cur.indicators, previous: before.indicators, timeByProduct: cur.timeByProduct, trend: cur.trend, management: cur.management });
  }
  // Team trend: completed and hours per bucket across everyone
  const { size, buckets } = bucketsFor(from, to);
  const trend = buckets.map((b, i) => ({
    start: b.start, end: b.end,
    completed: rows.reduce((s, r) => s + (r.trend.points[i]?.completed || 0), 0),
    hours: round(rows.reduce((s, r) => s + (r.trend.points[i]?.hours || 0), 0), 1),
  }));
  const products = new Map();
  for (const r of rows) for (const p of r.timeByProduct) {
    const g = products.get(p.product_id) || { product_id: p.product_id, name: p.name, minutes: 0 };
    g.minutes += p.minutes; products.set(p.product_id, g);
  }
  const sum = (k) => rows.reduce((s, r) => s + (r.indicators[k] || 0), 0);
  const team = {
    assigned: sum('assigned'), completed: sum('completed'), overdue: sum('overdue'), hours: round(sum('hours'), 1),
    completion_rate: pct(sum('completed'), sum('assigned')),
  };
  return {
    range: { from, to }, previousRange: prev, team,
    people: rows.map(({ trend: _t, ...r }) => r),
    trend: { size, points: trend },
    timeByProduct: [...products.values()].map((g) => ({ ...g, hours: round(g.minutes / 60, 1) })).sort((a, b) => b.minutes - a.minutes),
  };
}

/** Plain-language findings from the numbers (used when AI is unavailable, and as AI input). */
export function ruleInsights(report) {
  const out = [];
  if (report.people) {
    const ppl = report.people.filter((p) => p.indicators.assigned > 0);
    const open = ppl.map((p) => ({ name: p.name, open: p.indicators.not_started + p.indicators.in_progress }));
    if (open.length > 1) {
      const max = open.reduce((a, b) => (b.open > a.open ? b : a)), min = open.reduce((a, b) => (b.open < a.open ? b : a));
      if (max.open >= 3 && max.open >= 2 * Math.max(1, min.open)) out.push({ tone: 'warn', text: `Workload is uneven: ${max.name} has ${max.open} open tasks, ${min.name} has ${min.open}.` });
    }
    for (const p of ppl) {
      if (p.indicators.overdue >= 2) out.push({ tone: 'risk', text: `${p.name} has ${p.indicators.overdue} overdue tasks.` });
      if (p.indicators.on_time_rate !== null && p.indicators.on_time_rate < 60 && p.indicators.completed >= 3) out.push({ tone: 'warn', text: `${p.name} completes ${p.indicators.on_time_rate}% of tasks on time.` });
      if (p.indicators.completion_rate !== null && p.previous.completion_rate !== null && p.indicators.completion_rate - p.previous.completion_rate >= 15) out.push({ tone: 'good', text: `${p.name}'s completion rate rose to ${p.indicators.completion_rate}%.` });
    }
    if (report.timeByProduct.length) out.push({ tone: 'info', text: `Most time went to ${report.timeByProduct[0].name} (${report.timeByProduct[0].hours} h).` });
    return out.slice(0, 6);
  }
  const i = report.indicators, p = report.previous;
  if (i.assigned === 0) return [{ tone: 'info', text: 'No tasks assigned in this period.' }];
  if (i.completion_rate !== null) out.push({ tone: i.completion_rate >= 70 ? 'good' : 'warn', text: `Completed ${i.completed} of ${i.assigned} tasks (${i.completion_rate}%)${p.completion_rate !== null ? `, ${i.completion_rate >= p.completion_rate ? 'up' : 'down'} from ${p.completion_rate}%` : ''}.` });
  if (i.on_time_rate !== null) out.push({ tone: i.on_time_rate >= 80 ? 'good' : 'warn', text: `${i.on_time_rate}% finished on or before the deadline.` });
  if (i.overdue) out.push({ tone: 'risk', text: `${i.overdue} task${i.overdue === 1 ? ' is' : 's are'} overdue.` });
  if (i.avg_completion_hours !== null) out.push({ tone: 'info', text: `A task takes ${i.avg_completion_hours >= 48 ? `${round(i.avg_completion_hours / 24, 1)} days` : i.avg_completion_hours < 1 ? 'under an hour' : `${i.avg_completion_hours} hours`} on average from assignment to completion.` });
  if (report.timeByProduct?.length) out.push({ tone: 'info', text: `${i.hours} h logged, most on ${report.timeByProduct[0].name}.` });
  else if (i.assigned) out.push({ tone: 'info', text: 'No time logged on tasks yet. Use the task timer to track work time.' });
  return out;
}
