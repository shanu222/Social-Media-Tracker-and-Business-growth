import { many, one } from '../db.js';
import { today, addDays } from '../util.js';
import { PLATFORMS } from '../routes/accounts.js';

/*
 * AI task assistant (Claude via the Anthropic Messages API).
 * Set ANTHROPIC_API_KEY on Railway. Optional: AI_MODEL (default below).
 * The AI only creates DRAFTS — nothing is sent to anyone until the admin approves it.
 */

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
const MODEL = () => process.env.AI_MODEL || 'claude-sonnet-5-5';

async function productContext(productId) {
  const t0 = today();
  const [product, accounts, open, done, posts, links, members] = await Promise.all([
    one('SELECT name, tagline, description, website_url FROM products WHERE id = $1', [productId]),
    many(
      `SELECT a.platform, a.username, l.followers, l.posts, w.followers AS followers_30d_ago
       FROM accounts a
       LEFT JOIN LATERAL (SELECT followers, posts FROM snapshots s WHERE s.account_id = a.id AND s.followers IS NOT NULL ORDER BY date DESC LIMIT 1) l ON TRUE
       LEFT JOIN LATERAL (SELECT followers FROM snapshots s WHERE s.account_id = a.id AND s.followers IS NOT NULL AND s.date <= $2::date - 30 ORDER BY date DESC LIMIT 1) w ON TRUE
       WHERE a.product_id = $1 AND a.archived = FALSE`,
      [productId, t0]
    ),
    many(`SELECT title, kind, status, priority, due_date, progress, platforms FROM tasks WHERE product_id = $1 AND status IN ('draft','todo','in_progress') ORDER BY due_date NULLS LAST LIMIT 40`, [productId]),
    many(`SELECT title, kind, platforms, completed_at::date AS completed_on, completion_note FROM tasks WHERE product_id = $1 AND status = 'done' ORDER BY completed_at DESC LIMIT 25`, [productId]),
    many(`SELECT platform, posted_on, note FROM posts WHERE product_id = $1 AND posted_on >= $2 ORDER BY posted_on DESC LIMIT 40`, [productId, addDays(t0, -45)]),
    many(`SELECT title, content_type FROM links WHERE product_id = $1 ORDER BY created_at DESC LIMIT 20`, [productId]),
    many(`SELECT u.id, u.name FROM product_members m JOIN users u ON u.id = m.user_id WHERE m.product_id = $1 AND u.active`, [productId]),
  ]);
  return { today: t0, product, accounts, open_tasks: open, recently_completed: done, posts_last_45_days: posts, library: links, team: members };
}

const SYSTEM = `You are an experienced social media and product marketing manager helping a small company owner plan work.
You receive JSON describing ONE product: its details, social accounts with follower counts, open tasks, recently completed tasks, recent posts and library items.
Suggest practical, specific tasks the owner can assign to their social media manager or team.
Rules:
- Do NOT duplicate open tasks. Build on recently completed work with sensible follow-ups.
- Look for gaps: platforms with no recent posts, accounts not growing, missing content types, missing basics (bio links, pinned posts, 2FA, analytics review).
- Each task must be concrete and doable within its deadline. Write captions only for "post" tasks.
- Dates are offsets in days from today. Urgent only for genuinely time-critical work.
- Allowed platforms: ${PLATFORMS.join(', ')}.
Reply with ONLY a JSON object, no prose, in exactly this shape:
{"summary": "one or two sentences on the product's current social situation",
 "gaps": ["short gap description", "..."],
 "tasks": [{"kind": "post" | "general", "title": "...", "description": "what and why, 1-3 sentences",
   "instructions": "step-by-step action plan, newline separated", "caption": "ready-to-post caption or empty",
   "hashtags": "#tags or empty", "platforms": ["instagram"], "priority": "low" | "normal" | "high" | "urgent",
   "start_in_days": 0, "due_in_days": 3, "reason": "why this task now (one sentence)"}]}`;

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI reply was not in the expected format. Try again.');
  return JSON.parse(text.slice(start, end + 1));
}

const clampInt = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

/** Returns { summary, gaps, tasks[] } with tasks normalised and safe to insert. */
export async function suggestTasks(productId, { goal = '', count = 5, mode = 'plan' } = {}) {
  if (!aiEnabled()) {
    const e = new Error('AI is not set up. Add ANTHROPIC_API_KEY to the backend variables on Railway.');
    e.status = 503;
    throw e;
  }
  const ctx = await productContext(productId);
  const ask = [
    `Product data:\n${JSON.stringify(ctx)}`,
    mode === 'followup'
      ? `Focus on follow-up tasks that build on the recently completed work.`
      : `Suggest the most valuable next tasks for the coming two weeks.`,
    goal ? `The owner's goal for this request: ${goal}` : '',
    `Return ${Math.min(Math.max(count, 1), 10)} tasks.`,
  ].filter(Boolean).join('\n\n');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let res;
  try {
    res = await fetch(`${(process.env.AI_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL(), max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content: ask }] }),
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'The AI took too long to answer. Try again.' : 'Could not reach the AI service.');
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`AI request failed: ${data?.error?.message || res.status}`);
    err.status = 502;
    throw err;
  }
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const out = extractJson(text);
  const t0 = ctx.today;
  const tasks = (Array.isArray(out.tasks) ? out.tasks : []).slice(0, 10).map((t) => {
    const start = clampInt(t.start_in_days, 0, 60, 0);
    const due = Math.max(start, clampInt(t.due_in_days, 0, 90, 7));
    return {
      kind: t.kind === 'general' ? 'general' : 'post',
      title: String(t.title || 'Untitled task').slice(0, 200),
      description: t.description ? String(t.description).slice(0, 4000) : null,
      instructions: t.instructions ? String(t.instructions).slice(0, 4000) : null,
      caption: t.caption ? String(t.caption).slice(0, 4000) : null,
      hashtags: t.hashtags ? String(t.hashtags).slice(0, 800) : null,
      platforms: (Array.isArray(t.platforms) ? t.platforms : []).filter((p) => PLATFORMS.includes(p)).slice(0, 10),
      priority: ['low', 'normal', 'high', 'urgent'].includes(t.priority) ? t.priority : 'normal',
      start_date: addDays(t0, start),
      due_date: addDays(t0, due),
      reason: t.reason ? String(t.reason).slice(0, 500) : null,
    };
  });
  return {
    summary: out.summary ? String(out.summary).slice(0, 1000) : null,
    gaps: (Array.isArray(out.gaps) ? out.gaps : []).map((g) => String(g).slice(0, 300)).slice(0, 10),
    tasks,
  };
}
