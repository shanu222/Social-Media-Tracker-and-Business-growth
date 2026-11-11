import { many, one } from '../db.js';
import { today, addDays } from '../util.js';
import { PLATFORMS } from '../routes/accounts.js';
import { complete, cacheGet, cacheSet, aiEnabled as anyProvider, PROVIDERS } from './aiProviders.js';

/*
 * AI task assistant. Runs only when the admin opens "New task" for a product.
 * Suggestions are returned to the admin's screen — nothing is saved or sent until the admin
 * picks one, edits it and presses Assign & send.
 * If every AI provider fails, the admin gets a plain-text product brief to plan from instead.
 */

export const aiEnabled = anyProvider;
export const aiProviderLabels = () => Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.label]));

export async function productContext(productId) {
  const t0 = today();
  const [product, accounts, open, done, posts, links, members, tasks30] = await Promise.all([
    one('SELECT id, name, tagline, description, website_url FROM products WHERE id = $1', [productId]),
    many(
      `SELECT a.platform, a.username, a.brand, a.sync_enabled, l.date AS last_logged, l.followers, l.posts,
              w.followers AS followers_7d_ago, m.followers AS followers_30d_ago,
              (SELECT max(posted_on) FROM posts x WHERE x.account_id = a.id) AS last_post
       FROM accounts a
       LEFT JOIN LATERAL (SELECT date, followers, posts FROM snapshots s WHERE s.account_id = a.id AND s.followers IS NOT NULL ORDER BY date DESC LIMIT 1) l ON TRUE
       LEFT JOIN LATERAL (SELECT followers FROM snapshots s WHERE s.account_id = a.id AND s.followers IS NOT NULL AND s.date <= $2::date - 7 ORDER BY date DESC LIMIT 1) w ON TRUE
       LEFT JOIN LATERAL (SELECT followers FROM snapshots s WHERE s.account_id = a.id AND s.followers IS NOT NULL AND s.date <= $2::date - 30 ORDER BY date DESC LIMIT 1) m ON TRUE
       WHERE a.product_id = $1 AND a.archived = FALSE ORDER BY a.id`,
      [productId, t0]
    ),
    many(
      `SELECT t.title, t.kind, t.status, t.priority, t.due_date, t.progress, t.platforms, u.name AS assigned
       FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.product_id = $1 AND t.status IN ('draft','todo','in_progress') ORDER BY t.due_date NULLS LAST LIMIT 40`,
      [productId]
    ),
    many(`SELECT title, kind, platforms, completed_at::date AS completed_on, completion_note FROM tasks WHERE product_id = $1 AND status = 'done' ORDER BY completed_at DESC LIMIT 20`, [productId]),
    many(`SELECT platform, posted_on, note, url FROM posts WHERE product_id = $1 AND posted_on >= $2 ORDER BY posted_on DESC LIMIT 40`, [productId, addDays(t0, -45)]),
    many(`SELECT title, content_type, url FROM links WHERE product_id = $1 ORDER BY created_at DESC LIMIT 20`, [productId]),
    many(`SELECT u.name FROM product_members m JOIN users u ON u.id = m.user_id WHERE m.product_id = $1 AND u.active`, [productId]),
    one(`SELECT count(*) FILTER (WHERE status = 'done' AND completed_at >= now() - interval '30 days') AS done_30d,
                count(*) FILTER (WHERE status IN ('todo','in_progress') AND due_date < $2) AS overdue
         FROM tasks WHERE product_id = $1`, [productId, t0]),
  ]);
  return { today: t0, product, accounts, open_tasks: open, recently_completed: done, posts_last_45_days: posts, library: links, team: members.map((m) => m.name), stats: tasks30 };
}

/** Rule-based gaps — work even when no AI is available. */
export function findGaps(ctx) {
  const gaps = [];
  const t0 = ctx.today;
  if (!ctx.product.description) gaps.push('No product description yet — add who it is for and the tone of voice so content stays consistent.');
  if (!ctx.accounts.length) gaps.push('No social media accounts are linked to this product yet.');
  const have = new Set(ctx.accounts.map((a) => a.platform));
  for (const p of ['instagram', 'youtube', 'facebook']) if (ctx.accounts.length && !have.has(p)) gaps.push(`No ${PLATFORMS.includes(p) ? p[0].toUpperCase() + p.slice(1) : p} account for this product.`);
  for (const a of ctx.accounts) {
    const g30 = a.followers !== null && a.followers_30d_ago !== null ? a.followers - a.followers_30d_ago : null;
    if (g30 !== null && g30 <= 0) gaps.push(`${a.brand} (@${a.username}) has not grown in 30 days.`);
    if (!a.last_post || a.last_post < addDays(t0, -14)) gaps.push(`Nothing recorded as posted on ${a.brand} in the last 14 days.`);
    if (!a.sync_enabled && (!a.last_logged || a.last_logged < addDays(t0, -7))) gaps.push(`${a.brand} numbers haven't been logged for over a week.`);
  }
  if (Number(ctx.stats.overdue) > 0) gaps.push(`${ctx.stats.overdue} task(s) are overdue.`);
  if (!ctx.open_tasks.length) gaps.push('No open tasks — the team has nothing planned for this product.');
  if (!ctx.library.length) gaps.push('The content library is empty — share brand assets, logos and reference links.');
  return gaps.slice(0, 12);
}

const fmtN = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
const signed = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n}`);

/** Plain-text brief of everything known about a product. */
export function briefText(ctx, gaps) {
  const p = ctx.product;
  const L = [];
  L.push(`PRODUCT BRIEF — ${p.name}`);
  L.push(`Prepared ${ctx.today}`);
  L.push('');
  if (p.tagline) L.push(`Summary: ${p.tagline}`);
  if (p.website_url) L.push(`Website: ${p.website_url}`);
  if (ctx.team.length) L.push(`Managed by: ${ctx.team.join(', ')}`);
  if (p.description) { L.push(''); L.push('About:'); L.push(p.description); }
  L.push('');
  L.push('SOCIAL ACCOUNTS');
  if (!ctx.accounts.length) L.push('- None linked yet');
  for (const a of ctx.accounts) {
    const g7 = a.followers !== null && a.followers_7d_ago !== null ? a.followers - a.followers_7d_ago : null;
    const g30 = a.followers !== null && a.followers_30d_ago !== null ? a.followers - a.followers_30d_ago : null;
    L.push(`- ${a.brand} — ${a.platform} @${a.username}: ${fmtN(a.followers)} followers, ${fmtN(a.posts)} posts; 7 days ${signed(g7)}, 30 days ${signed(g30)}; last post ${a.last_post || 'not recorded'}`);
  }
  L.push('');
  L.push(`OPEN TASKS (${ctx.open_tasks.length})`);
  if (!ctx.open_tasks.length) L.push('- None');
  for (const t of ctx.open_tasks) L.push(`- [${t.status === 'draft' ? 'draft' : t.status === 'in_progress' ? `${t.progress}%` : 'not started'}] ${t.title} — ${t.priority} priority${t.due_date ? `, due ${t.due_date}` : ''}${t.assigned ? `, ${t.assigned}` : ''}${t.platforms?.length ? `, ${t.platforms.join('/')}` : ''}`);
  L.push('');
  L.push(`COMPLETED RECENTLY (${ctx.recently_completed.length})`);
  if (!ctx.recently_completed.length) L.push('- None');
  for (const t of ctx.recently_completed.slice(0, 10)) L.push(`- ${t.completed_on}: ${t.title}${t.completion_note ? ` — ${t.completion_note}` : ''}`);
  L.push('');
  L.push(`POSTS IN THE LAST 45 DAYS (${ctx.posts_last_45_days.length})`);
  const byPlatform = {};
  for (const x of ctx.posts_last_45_days) byPlatform[x.platform] = (byPlatform[x.platform] || 0) + 1;
  L.push(Object.keys(byPlatform).length ? `- ${Object.entries(byPlatform).map(([k, v]) => `${k}: ${v}`).join(', ')}` : '- None recorded');
  if (ctx.library.length) {
    L.push('');
    L.push('CONTENT LIBRARY (latest)');
    for (const l of ctx.library.slice(0, 8)) L.push(`- ${l.title} (${l.content_type})${l.url ? ` ${l.url}` : ''}`);
  }
  L.push('');
  L.push('GAPS TO ADDRESS');
  if (!gaps.length) L.push('- Nothing obvious — keep posting consistently.');
  for (const g of gaps) L.push(`- ${g}`);
  return L.join('\n');
}

export async function productBrief(productId) {
  const ctx = await productContext(productId);
  const gaps = findGaps(ctx);
  return { text: briefText(ctx, gaps), gaps };
}

const SYSTEM = `You are an experienced social media and product marketing manager helping a small company owner plan work.
You receive JSON describing ONE product: its details, social accounts with follower numbers and trends, open tasks,
recently completed tasks, recent posts, library items and gaps already detected.
Suggest practical, specific tasks the owner can assign to their social media manager.
Rules:
- Do NOT duplicate open tasks. Build on recently completed work with sensible follow-ups.
- Address the detected gaps where it makes sense.
- Each task must be concrete and doable within its deadline. Write a ready-to-post caption only for "post" tasks.
- Dates are offsets in days from today. Use "urgent" only for genuinely time-critical work.
- Allowed platforms: ${PLATFORMS.join(', ')}.
Reply with ONLY a JSON object, no prose, in exactly this shape:
{"summary": "one or two sentences on the product's current social situation",
 "tasks": [{"kind": "post" | "general", "title": "...", "description": "what and why, 1-3 sentences",
   "instructions": "step-by-step action plan, newline separated", "caption": "ready-to-post caption or empty",
   "hashtags": "#tags or empty", "platforms": ["instagram"], "priority": "low" | "normal" | "high" | "urgent",
   "start_in_days": 0, "due_in_days": 3, "reason": "why this task now (one sentence)"}]}`;

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON in reply');
  const out = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(out.tasks) || !out.tasks.length) throw new Error('No tasks in reply');
  return out;
}
const clampInt = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

/** Returns { summary, gaps, tasks[], provider, model, cached } — nothing is saved. */
export async function suggestTasks(productId, { goal = '', count = 5, mode = 'plan', refresh = false } = {}) {
  const ctx = await productContext(productId);
  const gaps = findGaps(ctx);
  const key = `p${productId}:${mode}:${count}:${goal.trim().toLowerCase()}`;
  if (!refresh) {
    const hit = cacheGet(key);
    if (hit) return { ...hit, cached: true };
  }
  const user = [
    `Product data:\n${JSON.stringify({ ...ctx, detected_gaps: gaps })}`,
    mode === 'followup' ? 'Focus on follow-up tasks that build on the recently completed work.' : 'Suggest the most valuable next tasks for the coming two weeks.',
    goal ? `The owner's goal: ${goal}` : '',
    `Return ${Math.min(Math.max(count, 1), 8)} tasks.`,
  ].filter(Boolean).join('\n\n');

  const { result: out, provider, model } = await complete(SYSTEM, user, parseJson);
  const t0 = ctx.today;
  const tasks = out.tasks.slice(0, 8).map((t) => {
    const start = clampInt(t.start_in_days, 0, 60, 0);
    const due = Math.max(start, clampInt(t.due_in_days, 0, 90, 7));
    return {
      kind: t.kind === 'general' ? 'general' : 'post',
      title: String(t.title || 'Untitled task').slice(0, 200),
      description: t.description ? String(t.description).slice(0, 4000) : '',
      instructions: t.instructions ? String(t.instructions).slice(0, 4000) : '',
      caption: t.caption ? String(t.caption).slice(0, 4000) : '',
      hashtags: t.hashtags ? String(t.hashtags).slice(0, 800) : '',
      platforms: (Array.isArray(t.platforms) ? t.platforms : []).filter((p) => PLATFORMS.includes(p)).slice(0, 10),
      priority: ['low', 'normal', 'high', 'urgent'].includes(t.priority) ? t.priority : 'normal',
      start_date: addDays(t0, start),
      due_date: addDays(t0, due),
      reason: t.reason ? String(t.reason).slice(0, 500) : '',
    };
  });
  const value = { summary: out.summary ? String(out.summary).slice(0, 1000) : null, gaps, tasks, provider, model };
  cacheSet(key, value);
  return { ...value, cached: false };
}
