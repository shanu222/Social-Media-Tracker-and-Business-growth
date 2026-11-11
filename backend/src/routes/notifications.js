import { Router } from 'express';
import { many, one, query } from '../db.js';
import { requireRole } from '../auth.js';
import { ah } from '../util.js';

/*
 * The bell. Everyone sees only notifications addressed to them.
 * Admins also get "Team activity": who was given which task, who started, updated or completed it,
 * questions, confirmations and other important changes across the company.
 */
const router = Router();

const ACTIVITY = [
  'task.created', 'task.sent', 'task.in_progress', 'task.progress', 'task.done', 'task.todo', 'task.cancelled',
  'task.clarification', 'task.comment', 'task.updated', 'task.deleted', 'time.logged', 'post.recorded',
  'announcement.created', 'announcement.acknowledged', 'product.created', 'account.created', 'report.generated',
  'file.uploaded', 'link.added', 'user.created', 'user.removed', 'snapshots.saved', 'metrics.saved', 'metrics.targets_saved',
];

async function activityUnread(user) {
  const r = await one(
    `SELECT count(*)::int AS n FROM audit_log a
     WHERE a.action = ANY($1) AND a.user_id IS DISTINCT FROM $2
       AND a.created_at > coalesce((SELECT activity_seen_at FROM users WHERE id = $2), now() - interval '3 days')`,
    [ACTIVITY, user.id]
  );
  return r.n;
}

router.get('/', ah(async (req, res) => {
  const [items, unread] = await Promise.all([
    many(
      `SELECT n.*, p.name AS product_name FROM notifications n LEFT JOIN products p ON p.id = n.product_id
       WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 40`,
      [req.user.id]
    ),
    one('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]),
  ]);
  const extra = req.user.role === 'admin' ? { activityUnread: await activityUnread(req.user) } : {};
  res.json({ unread: unread.n, items, ...extra });
}));

router.post('/read', ah(async (req, res) => {
  const id = Number(req.body?.id) || null;
  await query(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL ${id ? 'AND id = $2' : ''}`,
    id ? [req.user.id, id] : [req.user.id]
  );
  res.json({ ok: true });
}));

const q = (s) => `“${s}”`;
const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

function describe(r) {
  const who = r.actor || 'Someone';
  const d = r.detail || {};
  const title = r.task_title || d.title || 'a task';
  const to = r.assignee ? r.assignee : 'everyone on the product';
  const taskLink = r.task_id ? `/products/${r.task_product}?tab=tasks&task=${r.task_id}` : r.product_id ? `/products/${r.product_id}?tab=tasks` : null;
  switch (r.action) {
    case 'task.created': case 'task.sent': return { kind: 'assigned', text: `${who} assigned ${q(title)} to ${to}`, link: taskLink };
    case 'task.in_progress': return { kind: 'progress', text: `${who} started ${q(title)}`, link: taskLink };
    case 'task.progress': return { kind: 'progress', text: `${who} updated ${q(title)} to ${d.progress ?? '?'}%`, link: taskLink };
    case 'task.done': return { kind: 'done', text: `${who} completed ${q(title)}`, link: taskLink };
    case 'task.todo': return { kind: 'progress', text: `${who} reopened ${q(title)}`, link: taskLink };
    case 'task.cancelled': return { kind: 'warn', text: `${who} cancelled ${q(title)}`, link: taskLink };
    case 'task.clarification': return { kind: 'question', text: `${who} asked for clarification on ${q(title)}`, link: taskLink };
    case 'task.comment': return { kind: 'comment', text: `${who} commented on ${q(title)}`, link: taskLink };
    case 'task.updated': return { kind: 'edit', text: `${who} edited ${q(title)}`, link: taskLink };
    case 'task.deleted': return { kind: 'warn', text: `${who} deleted ${q(d.title || 'a task')}`, link: null };
    case 'time.logged': return { kind: 'time', text: `${who} logged ${mins(d.minutes || 0)} on ${q(title)}`, link: taskLink };
    case 'post.recorded': return { kind: 'done', text: `${who} recorded a published ${d.platform || ''} post`.replace('  ', ' '), link: r.product_id ? `/products/${r.product_id}?tab=published` : null };
    case 'announcement.created': return { kind: 'announce', text: `${who} sent ${d.kind === 'announcement' ? 'an announcement' : `a ${d.kind || 'message'}`}: ${q(r.ann_title || '')}`, link: `/messages?tab=announcements&open=${r.entity_id}` };
    case 'announcement.acknowledged': return { kind: 'done', text: `${who} confirmed ${q(r.ann_title || 'an announcement')}`, link: `/messages?tab=announcements&open=${r.entity_id}` };
    case 'product.created': return { kind: 'edit', text: `${who} created the product ${d.name || ''}`, link: `/products/${r.entity_id}` };
    case 'account.created': return { kind: 'edit', text: `${who} added the account @${d.username || d.brand || ''}`, link: `/accounts/${r.entity_id}` };
    case 'report.generated': return { kind: 'edit', text: `${who} generated ${q(d.title || 'a report')}`, link: `/reports/${r.entity_id}` };
    case 'file.uploaded': return { kind: 'edit', text: `${who} uploaded ${d.name || 'a file'}`, link: r.product_id ? `/products/${r.product_id}?tab=library` : '/files' };
    case 'link.added': return { kind: 'edit', text: `${who} added a link${d.title ? `: ${d.title}` : ''}`, link: r.product_id ? `/products/${r.product_id}?tab=library` : null };
    case 'user.created': return { kind: 'edit', text: `${who} added ${d.email || 'a team member'} to the team`, link: '/settings' };
    case 'user.removed': return { kind: 'warn', text: `${who} removed ${d.name || 'a team member'} from the team`, link: '/settings' };
    case 'snapshots.saved': return { kind: 'time', text: `${who} logged daily social numbers`, link: '/update' };
    case 'metrics.saved': return { kind: 'time', text: `${who} logged business numbers`, link: '/update?tab=business' };
    case 'metrics.targets_saved': return { kind: 'edit', text: `${who} set targets for ${/^\d{4}-\d{2}$/.test(r.entity_id || '') ? new Date(`${r.entity_id}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'the month'}`, link: '/kpis' };
    default: return { kind: 'edit', text: `${who}: ${r.action}`, link: null };
  }
}

router.get('/activity', requireRole('admin'), ah(async (req, res) => {
  const before = req.query.before ? Number(req.query.before) : null;
  const rows = await many(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.product_id, a.created_at, a.user_id,
       CASE WHEN a.user_id = $2 THEN 'You' ELSE u.name END AS actor,
       coalesce(p.name, tp.name) AS product_name, t.id AS task_id, t.title AS task_title, t.product_id AS task_product,
       CASE WHEN ua.id = $2 THEN 'you' ELSE ua.name END AS assignee, an.title AS ann_title
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN products p ON p.id = a.product_id
     LEFT JOIN tasks t ON a.entity = 'task' AND t.id = (CASE WHEN a.entity_id ~ '^[0-9]{1,9}$' THEN a.entity_id::int END)
     LEFT JOIN users ua ON ua.id = t.assigned_to
     LEFT JOIN products tp ON tp.id = t.product_id
     LEFT JOIN announcements an ON a.entity = 'announcement' AND an.id = (CASE WHEN a.entity_id ~ '^[0-9]{1,9}$' THEN a.entity_id::int END)
     WHERE a.action = ANY($1) ${before ? 'AND a.id < $3' : ''}
     ORDER BY a.id DESC LIMIT 50`,
    before ? [ACTIVITY, req.user.id, before] : [ACTIVITY, req.user.id]
  );
  const seen = await one('SELECT activity_seen_at FROM users WHERE id = $1', [req.user.id]);
  res.json(rows.map((r) => ({
    id: r.id, at: r.created_at, product_name: r.product_name || null, mine: r.user_id === req.user.id,
    unseen: r.user_id !== req.user.id && (!seen?.activity_seen_at || new Date(r.created_at) > new Date(seen.activity_seen_at)),
    ...describe(r),
  })));
}));

router.post('/activity/seen', requireRole('admin'), ah(async (req, res) => {
  await query('UPDATE users SET activity_seen_at = now() WHERE id = $1', [req.user.id]);
  res.json({ ok: true });
}));

export default router;
