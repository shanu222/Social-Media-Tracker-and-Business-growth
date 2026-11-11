import { many, one } from '../db.js';
import { addDays, monthRange, periodKey } from '../util.js';

const round = (n, d = 1) => (n === null || n === undefined || !isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (a, b) => (b ? (a / b) * 100 : null);

function ratingFromGrowth(g, net) {
  if (g === null) return net > 0 ? 4 : null;
  if (g >= 10) return 5;
  if (g >= 4) return 4;
  if (g >= 1) return 3;
  if (g > 0) return 2;
  return 1;
}

function datesBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Aggregate a metric's entries according to its aggregation rule. */
function aggregate(entries, aggregation) {
  if (!entries.length) return null;
  if (aggregation === 'last') return entries[entries.length - 1].value;
  const sum = entries.reduce((s, e) => s + Number(e.value), 0);
  return aggregation === 'avg' ? sum / entries.length : sum;
}

/**
 * Metric values for a period. scope: undefined = every active metric, 'company' = company-wide only,
 * a product id = that product's metrics. Social metrics (source <> 'manual') are calculated from the
 * product's linked accounts; everything else comes from daily entries.
 */
export async function businessMetrics(start, end, scope, { manualOnly = false } = {}) {
  const where = (scope === 'company' ? 'AND m.product_id IS NULL' : Number.isInteger(scope) ? 'AND m.product_id = $1' : '') + (manualOnly ? " AND m.source = 'manual'" : '');
  const metrics = await many(
    `SELECT m.*, p.name AS product_name FROM metrics m LEFT JOIN products p ON p.id = m.product_id
     WHERE m.active = TRUE AND (m.product_id IS NULL OR p.archived = FALSE) ${where}
     ORDER BY p.name NULLS FIRST, m.position, m.id`,
    Number.isInteger(scope) ? [scope] : []
  );
  const entries = await many(
    'SELECT metric_id, date, value FROM metric_entries WHERE date BETWEEN $1 AND $2 ORDER BY date',
    [start, end]
  );
  let social = null;
  if (metrics.some((m) => m.source && m.source !== 'manual')) {
    const sum = await growthSummary(start, end);
    social = new Map();
    for (const a of sum.accounts) {
      if (!a.product_id) continue;
      const g = social.get(a.product_id) || { followers_gained: 0, posts: 0, reach: 0, eng: 0, n: 0 };
      g.followers_gained += a.net_change || 0; g.posts += a.posts_added || 0; g.reach += a.reach || 0;
      g.eng += (a.likes || 0) + (a.comments || 0) + (a.shares || 0); g.n++;
      social.set(a.product_id, g);
    }
  }
  return metrics.map((m) => {
    if (m.source && m.source !== 'manual') {
      const g = social?.get(m.product_id);
      const value = !g ? null : m.source === 'engagement_rate' ? (g.reach ? round((g.eng / g.reach) * 100, 2) : null) : g[m.source];
      return { ...m, value, entries: null, auto: true };
    }
    const own = entries.filter((e) => e.metric_id === m.id);
    return { ...m, value: round(aggregate(own, m.aggregation), 2), entries: own.length, auto: false };
  });
}

/** Monthly KPI sheet: target vs actual vs previous month. */
export async function monthlyKpis(month, scope) {
  const { start, end } = monthRange(month);
  const [y, mo] = month.split('-').map(Number);
  const prevMonth = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
  const prev = monthRange(prevMonth);
  const [cur, last, targets] = await Promise.all([
    businessMetrics(start, end, scope),
    businessMetrics(prev.start, prev.end, scope),
    many('SELECT * FROM metric_targets WHERE month = $1', [month]),
  ]);
  const tmap = new Map(targets.map((t) => [t.metric_id, t]));
  return cur.map((m) => {
    const t = tmap.get(m.id);
    const previous = last.find((x) => x.id === m.id)?.value ?? null;
    let status = null;
    if (t?.target !== null && t?.target !== undefined && m.value !== null) {
      status = m.higher_is_better ? (m.value >= t.target ? 'on' : 'off') : m.value <= t.target ? 'on' : 'off';
    }
    return { ...m, target: t?.target ?? null, comment: t?.comment ?? null, previous, status };
  });
}

/**
 * Core growth computation used by the dashboard and the reports.
 * Follower counts are carried forward on days with no entry.
 */
export async function growthSummary(start, end) {
  const accounts = await many('SELECT id, brand, username, platform, color, two_factor_enabled, product_id, baseline_date, baseline_followers, baseline_posts FROM accounts WHERE archived = FALSE ORDER BY id');
  const snaps = await many(
    `SELECT * FROM snapshots WHERE date <= $2 AND (date >= $1 OR date >= (
        SELECT coalesce(max(date), '1900-01-01') FROM snapshots s2 WHERE s2.account_id = snapshots.account_id AND s2.date < $1
     )) ORDER BY date`,
    [start, end]
  );
  const days = datesBetween(start, end);
  const series = days.map((d) => ({ date: d }));

  const perAccount = accounts.map((a) => {
    const own = snaps.filter((s) => s.account_id === a.id);
    // The starting numbers entered when the account was added count as its first data point
    if (a.baseline_date && a.baseline_date <= end && !own.some((s) => s.date === a.baseline_date && s.followers !== null)) {
      const before0 = own.filter((s) => s.date < start && s.followers !== null).at(-1);
      if (a.baseline_date >= start || !before0 || before0.date < a.baseline_date) {
        own.push({ account_id: a.id, date: a.baseline_date, followers: a.baseline_followers, posts: a.baseline_posts, _baseline: true });
        own.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
      }
    }
    const before = own.filter((s) => s.date < start && s.followers !== null).at(-1);
    const inRange = own.filter((s) => s.date >= start);
    const logged = inRange.filter((s) => !s._baseline);
    const withF = inRange.filter((s) => s.followers !== null);
    const startRow = before || withF[0] || null;
    const endRow = withF.at(-1) || before || null;
    const startF = startRow?.followers ?? null;
    const endF = endRow?.followers ?? null;
    const net = startF !== null && endF !== null ? endF - startF : null;
    const growth = net !== null ? pct(net, startF) : null;

    const startP = (before || inRange.find((s) => s.posts !== null))?.posts ?? null;
    const endP = [...inRange].reverse().find((s) => s.posts !== null)?.posts ?? startP;
    const postsAdded = startP !== null && endP !== null ? endP - startP : null;

    const sum = (k) => logged.reduce((t, s) => t + (s[k] || 0), 0);
    const likes = sum('likes'), comments = sum('comments'), shares = sum('shares');
    const reach = sum('reach'), impressions = sum('impressions');
    const dmsIn = sum('dms_received'), dmsAns = sum('dms_answered');
    const engagementRate = reach ? pct(likes + comments + shares, reach) : null;

    // daily carried-forward follower series
    let carry = before?.followers ?? null;
    const byDate = new Map(withF.map((s) => [s.date, s.followers]));
    days.forEach((d, i) => {
      if (byDate.has(d)) carry = byDate.get(d);
      series[i][`a${a.id}`] = carry;
    });

    // daily deltas (for the growth strip)
    const deltas = [];
    let prevF = before?.followers ?? null;
    for (const d of days) {
      if (byDate.has(d)) {
        const f = byDate.get(d);
        deltas.push(prevF === null ? 0 : f - prevF);
        prevF = f;
      } else deltas.push(null);
    }

    return {
      id: a.id,
      brand: a.brand,
      username: a.username,
      platform: a.platform,
      product_id: a.product_id,
      color: a.color,
      two_factor_enabled: a.two_factor_enabled,
      start_followers: startF,
      end_followers: endF,
      net_change: net,
      growth_pct: round(growth),
      posts_added: postsAdded,
      end_posts: endP,
      likes, comments, shares, reach, impressions,
      engagement_rate: round(engagementRate, 2),
      dms_received: dmsIn,
      dms_answered: dmsAns,
      response_rate: dmsIn ? round(pct(dmsAns, dmsIn)) : null,
      days_logged: logged.length,
      rating: ratingFromGrowth(growth, net ?? 0),
      deltas,
    };
  });

  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const daily = days.map((d) => ({ date: d, reach: 0, engagements: 0, total: null }));
  for (const sn of snaps) {
    const i = dayIdx.get(sn.date);
    if (i === undefined) continue;
    daily[i].reach += sn.reach || 0;
    daily[i].engagements += (sn.likes || 0) + (sn.comments || 0) + (sn.shares || 0);
  }
  series.forEach((row, i) => {
    let t = 0, any = false;
    for (const a of accounts) { const v = row[`a${a.id}`]; if (v !== null && v !== undefined) { t += v; any = true; } }
    daily[i].total = any ? t : null;
  });

  const totStart = perAccount.reduce((t, a) => t + (a.start_followers || 0), 0);
  const totEnd = perAccount.reduce((t, a) => t + (a.end_followers || 0), 0);
  const totReach = perAccount.reduce((t, a) => t + a.reach, 0);
  const totEng = perAccount.reduce((t, a) => t + a.likes + a.comments + a.shares, 0);
  const dmsIn = perAccount.reduce((t, a) => t + a.dms_received, 0);
  const dmsAns = perAccount.reduce((t, a) => t + a.dms_answered, 0);

  const totals = {
    accounts: accounts.length,
    start_followers: totStart,
    end_followers: totEnd,
    net_change: totEnd - totStart,
    growth_pct: round(pct(totEnd - totStart, totStart)),
    posts_added: perAccount.reduce((t, a) => t + (a.posts_added || 0), 0),
    reach: totReach,
    impressions: perAccount.reduce((t, a) => t + a.impressions, 0),
    engagement_rate: round(totReach ? pct(totEng, totReach) : null, 2),
    response_rate: dmsIn ? round(pct(dmsAns, dmsIn)) : null,
    two_factor_coverage: accounts.length ? round(pct(accounts.filter((a) => a.two_factor_enabled).length, accounts.length), 0) : null,
  };

  return { start, end, days, totals, accounts: perAccount, series, daily };
}

export async function checklistCompletion(start, end) {
  const tasks = await many('SELECT id, frequency FROM checklist_tasks WHERE active = TRUE');
  const days = datesBetween(start, end);
  const keys = new Set();
  let expected = 0;
  for (const t of tasks) {
    const periods = new Set(days.map((d) => periodKey(t.frequency, d)));
    expected += periods.size;
    periods.forEach((p) => keys.add(p));
  }
  const row = await one(
    `SELECT count(*)::int AS n FROM checklist_completions c JOIN checklist_tasks t ON t.id = c.task_id
     WHERE t.active = TRUE AND c.period_key = ANY($1)`,
    [[...keys]]
  );
  return { expected, done: row.n, pct: expected ? round(pct(row.n, expected), 0) : null };
}

const names = (list, max = 3) => {
  const n = list.map((a) => a.brand);
  return n.length <= max ? n.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${n.slice(0, max).join(', ')} and ${n.length - max} more`;
};

/** Short, plain-language observations a manager can act on. */
export function buildInsights(summary, checklist) {
  const out = [];
  const acc = summary.accounts.filter((a) => a.end_followers !== null);
  const ranked = [...acc].filter((a) => a.growth_pct !== null).sort((a, b) => b.growth_pct - a.growth_pct);
  if (ranked.length && ranked[0].growth_pct > 0) {
    const t = ranked[0];
    out.push({ tone: 'good', text: `${t.brand} grew fastest: +${t.net_change} followers (${t.growth_pct}%). Repeat its best format elsewhere.` });
  }
  const flat = acc.filter((a) => (a.net_change ?? 0) <= 0 && a.days_logged > 0);
  if (flat.length) {
    out.push({ tone: 'warn', text: `No growth on ${names(flat)}. Aim for 3 posts a week.` });
  }
  const noPosts = acc.filter((a) => a.posts_added === 0);
  if (noPosts.length) {
    out.push({ tone: 'warn', text: `No posts on ${names(noPosts)} this period.` });
  }
  const notLogged = summary.accounts.filter((a) => a.days_logged === 0);
  if (notLogged.length) {
    out.push({ tone: 'info', text: `${notLogged.length} account${notLogged.length === 1 ? '' : 's'} not updated this period (${names(notLogged, 2)}).` });
  }
  if (summary.totals.engagement_rate !== null) {
    const er = summary.totals.engagement_rate;
    out.push({
      tone: er >= 3 ? 'good' : 'info',
      text: er >= 3
        ? `Engagement is healthy at ${er}% of reach.`
        : `Engagement is ${er}% of reach. Ask questions in captions and reply fast.`,
    });
  }
  if (summary.totals.response_rate !== null && summary.totals.response_rate < 90) {
    out.push({ tone: 'warn', text: `${summary.totals.response_rate}% of DMs answered. Unanswered messages are lost leads.` });
  }
  const no2fa = summary.accounts.filter((a) => !a.two_factor_enabled);
  if (no2fa.length) {
    out.push({ tone: 'risk', text: `2FA is off on ${no2fa.length} account${no2fa.length === 1 ? '' : 's'}. Turn it on to protect them.` });
  }
  if (checklist?.pct !== null && checklist?.pct !== undefined && checklist.pct < 70) {
    out.push({ tone: 'info', text: `Checklist ${checklist.pct}% done. Block 30 minutes a day for it.` });
  }
  return out;
}
