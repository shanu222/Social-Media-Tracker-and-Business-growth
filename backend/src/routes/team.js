import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { notify } from '../notify.js';
import { emailUser, noticeEmail } from '../mailer.js';
import { ah, parse } from '../util.js';
import { config } from '../config.js';

/*
 * Team communication: direct messages, announcements, meetings, reminders and deadlines.
 * Admins can message anyone. Other members can message admins, and each other only when
 * the admin allows it. Emails are throttled so a busy conversation sends at most one email
 * every 30 minutes, except messages marked important, which are always emailed.
 */
const router = Router();
const EMAIL_GAP_MIN = Number(process.env.MESSAGE_EMAIL_GAP_MINUTES || 30);
const TZ = config.timezone || 'Asia/Karachi';

export const whenText = (d) => new Date(d).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TZ });
const KIND_LABEL = { announcement: 'Announcement', meeting: 'Meeting', reminder: 'Reminder', deadline: 'Deadline' };

async function canMessage(me, otherId) {
  if (otherId === me.id) return false;
  const other = await one('SELECT id, role, active FROM users WHERE id = $1', [otherId]);
  if (!other || !other.active) return false;
  if (me.role === 'admin' || other.role === 'admin') return true;
  const mine = await one('SELECT can_message_team FROM users WHERE id = $1', [me.id]);
  return Boolean(mine?.can_message_team);
}

/** People I can message, with unread counts and the last message. */
router.get('/people', ah(async (req, res) => {
  const me = await one('SELECT can_message_team FROM users WHERE id = $1', [req.user.id]);
  const all = req.user.role === 'admin' || me?.can_message_team;
  const rows = await many(
    `SELECT u.id, u.name, u.title, u.role, u.deleted_at IS NOT NULL AS removed,
       (SELECT count(*)::int FROM direct_messages d WHERE d.sender_id = u.id AND d.recipient_id = $1 AND d.read_at IS NULL) AS unread,
       last.body AS last_body, last.created_at AS last_at, last.sender_id AS last_sender
     FROM users u
     LEFT JOIN LATERAL (
       SELECT body, created_at, sender_id FROM direct_messages d
       WHERE (d.sender_id = u.id AND d.recipient_id = $1) OR (d.sender_id = $1 AND d.recipient_id = u.id)
       ORDER BY d.id DESC LIMIT 1) last ON TRUE
     WHERE u.id <> $1 AND (
       (u.active = TRUE AND ($2 OR u.role = 'admin'))
       -- admins keep access to conversations with removed members
       OR ($3 AND u.deleted_at IS NOT NULL AND last.created_at IS NOT NULL))
     ORDER BY last.created_at DESC NULLS LAST, u.name`,
    [req.user.id, all, req.user.role === 'admin']
  );
  res.json(rows);
}));

router.get('/unread', ah(async (req, res) => {
  const r = await one(
    `SELECT (SELECT count(*)::int FROM direct_messages WHERE recipient_id = $1 AND read_at IS NULL) AS dm,
            (SELECT count(*)::int FROM announcement_recipients r JOIN announcements a ON a.id = r.announcement_id
              WHERE r.user_id = $1 AND r.read_at IS NULL AND a.cancelled = FALSE) AS announcements`,
    [req.user.id]
  );
  res.json(r);
}));

router.get('/dm/:userId(\\d+)', ah(async (req, res) => {
  const other = Number(req.params.userId);
  const removedPeer = req.user.role === 'admin' && (await one('SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NOT NULL', [other]));
  if (!removedPeer && !(await canMessage(req.user, other))) return res.status(404).json({ error: 'Conversation not found.' });
  const after = Number(req.query.after) || 0;
  const rows = await many(
    `SELECT * FROM (SELECT d.id, d.sender_id, d.recipient_id, d.body, d.important, d.read_at, d.created_at
       FROM direct_messages d
       WHERE ((d.sender_id = $1 AND d.recipient_id = $2) OR (d.sender_id = $2 AND d.recipient_id = $1)) AND d.id > $3
       ORDER BY d.id DESC LIMIT 300) x ORDER BY id`,
    [req.user.id, other, after]
  );
  const marked = await query('UPDATE direct_messages SET read_at = now() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL', [other, req.user.id]);
  if (marked.rowCount) {
    await query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND kind = 'message' AND link = $2 AND read_at IS NULL", [req.user.id, `/messages?with=${other}`]);
  }
  const peer = await one('SELECT id, name, title, role, deleted_at IS NOT NULL AS removed FROM users WHERE id = $1', [other]);
  res.json({ peer, messages: rows });
}));

router.post('/dm/:userId(\\d+)', ah(async (req, res) => {
  const other = Number(req.params.userId);
  if (!(await canMessage(req.user, other))) return res.status(403).json({ error: 'Not allowed.' });
  const b = parse(z.object({ body: z.string().trim().min(1, 'Write a message first').max(6000), important: z.boolean().default(false) }), req.body);
  const important = req.user.role === 'admin' && b.important;
  const m = await one(
    'INSERT INTO direct_messages (sender_id, recipient_id, body, important) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.id, other, b.body, important]
  );
  // Replying counts as reading the conversation
  await query('UPDATE direct_messages SET read_at = now() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL', [other, req.user.id]);

  const link = `/messages?with=${req.user.id}`;
  const open = await one("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'message' AND link = $2 AND read_at IS NULL", [other, link]);
  if (!open) await notify([other], { kind: 'message', title: `${important ? 'Important: ' : ''}New message from ${req.user.name}`, body: b.body, link }, req.user.id);

  // Email: always when important; otherwise at most once per conversation per gap window
  // Claim the email slot atomically so quick bursts of messages send one email
  const claimed = await one(
    `INSERT INTO dm_email_state (user_id, peer_id, emailed_at) VALUES ($1,$2,now())
     ON CONFLICT (user_id, peer_id) DO UPDATE SET emailed_at = now()
       WHERE $3 OR dm_email_state.emailed_at < now() - make_interval(mins => $4)
     RETURNING emailed_at`,
    [other, req.user.id, important, EMAIL_GAP_MIN]
  );
  if (claimed) {
    const sender = await one('SELECT title FROM users WHERE id = $1', [req.user.id]);
    emailUser(other, {
      kind: 'message',
      subject: `${important ? 'Important message' : 'New message'} from ${req.user.name}`,
      ...noticeEmail({
        heading: important ? 'Important message' : 'New message',
        intro: `${req.user.name}${sender?.title ? ` (${sender.title})` : ''} sent you a message.`,
        body: b.body, link, button: 'Open conversation',
        footer: important ? null : `Further messages in this conversation are grouped for ${EMAIL_GAP_MIN} minutes.`,
      }),
    });
  }
  res.status(201).json(m);
}));

/* ---------------- Announcements, meetings, reminders, deadlines ---------------- */

const annSchema = z.object({
  kind: z.enum(['announcement', 'meeting', 'reminder', 'deadline']).default('announcement'),
  title: z.string().trim().min(1, 'Add a title').max(200),
  body: z.string().trim().max(6000).nullish(),
  event_at: z.string().datetime({ offset: true }).nullish().or(z.literal('')),
  location: z.string().trim().max(500).nullish(),
  important: z.boolean().default(false),
  recipients: z.union([z.literal('all'), z.array(z.number().int().positive()).min(1, 'Choose who receives it')]).default('all'),
});

async function annRecipients(id) {
  return (await many('SELECT user_id FROM announcement_recipients WHERE announcement_id = $1', [id])).map((r) => r.user_id);
}

export async function emailAnnouncement(a, userIds, { heading, intro }) {
  const rows = [['Type', KIND_LABEL[a.kind]]];
  if (a.event_at) rows.push([a.kind === 'meeting' ? 'When' : a.kind === 'deadline' ? 'Due' : 'Time', whenText(a.event_at)]);
  if (a.location) rows.push([a.kind === 'meeting' ? 'Where' : 'Details', a.location]);
  for (const u of userIds) {
    emailUser(u, { kind: `announcement:${a.kind}`, subject: `${heading}: ${a.title}`, ...noticeEmail({ heading, intro, rows: [['Title', a.title], ...rows], body: a.body, link: `/messages?tab=announcements&open=${a.id}`, button: 'View details' }) });
  }
}

router.get('/announcements', ah(async (req, res) => {
  if (req.user.role === 'admin') {
    const rows = await many(
      `SELECT a.*, u.name AS created_by_name,
         count(r.user_id)::int AS recipients, count(r.read_at)::int AS read, count(r.acknowledged_at)::int AS acknowledged,
         coalesce(json_agg(json_build_object('id', ru.id, 'name', ru.name, 'read_at', r.read_at, 'acknowledged_at', r.acknowledged_at) ORDER BY ru.name) FILTER (WHERE ru.id IS NOT NULL), '[]') AS people,
         bool_or(r.user_id = $1) AS to_me, max(CASE WHEN r.user_id = $1 THEN r.acknowledged_at END) AS my_ack
       FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN announcement_recipients r ON r.announcement_id = a.id
       LEFT JOIN users ru ON ru.id = r.user_id
       GROUP BY a.id, u.name ORDER BY a.created_at DESC LIMIT 200`, [req.user.id]
    );
    await query('UPDATE announcement_recipients SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    return res.json(rows);
  }
  const rows = await many(
    `SELECT a.id, a.kind, a.title, a.body, a.event_at, a.location, a.important, a.created_at, a.cancelled,
       u.name AS created_by_name, r.read_at, r.acknowledged_at AS my_ack
     FROM announcement_recipients r JOIN announcements a ON a.id = r.announcement_id
     LEFT JOIN users u ON u.id = a.created_by
     WHERE r.user_id = $1 ORDER BY a.created_at DESC LIMIT 200`, [req.user.id]
  );
  await query('UPDATE announcement_recipients SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  await query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND kind = 'announcement' AND read_at IS NULL", [req.user.id]);
  res.json(rows);
}));

/** Upcoming meetings, reminders and deadlines for me (next 14 days). */
router.get('/upcoming', ah(async (req, res) => {
  const rows = await many(
    `SELECT DISTINCT a.id, a.kind, a.title, a.event_at, a.location, a.important
     FROM announcements a LEFT JOIN announcement_recipients r ON r.announcement_id = a.id
     WHERE a.cancelled = FALSE AND a.event_at IS NOT NULL AND a.event_at > now() - interval '1 hour' AND a.event_at < now() + interval '14 days'
       AND (r.user_id = $1 OR ($2 AND a.created_by = $1))
     ORDER BY a.event_at LIMIT 10`, [req.user.id, req.user.role === 'admin']
  );
  res.json(rows);
}));

router.post('/announcements', requireRole('admin'), ah(async (req, res) => {
  const b = parse(annSchema, req.body);
  if (['meeting', 'deadline', 'reminder'].includes(b.kind) && !b.event_at) return res.status(400).json({ error: 'Choose the date and time.' });
  const ids = b.recipients === 'all'
    ? (await many('SELECT id FROM users WHERE active = TRUE AND id <> $1', [req.user.id])).map((r) => r.id)
    : (await many('SELECT id FROM users WHERE active = TRUE AND id = ANY($1)', [b.recipients])).map((r) => r.id);
  if (!ids.length) return res.status(400).json({ error: 'There is nobody to send this to yet.' });
  const a = await one(
    'INSERT INTO announcements (kind, title, body, event_at, location, important, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [b.kind, b.title, b.body || null, b.event_at || null, b.location || null, b.important, req.user.id]
  );
  for (const u of ids) await query('INSERT INTO announcement_recipients (announcement_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a.id, u]);
  await notify(ids, { kind: 'announcement', title: `${KIND_LABEL[a.kind]}: ${a.title}`, body: a.event_at ? whenText(a.event_at) : a.body, link: `/messages?tab=announcements&open=${a.id}` }, req.user.id);
  await emailAnnouncement(a, ids, { heading: `New ${KIND_LABEL[a.kind].toLowerCase()}`, intro: `${req.user.name} sent ${a.kind === 'announcement' ? 'an announcement' : `a ${a.kind}`} to the team.` });
  await audit(req, 'announcement.created', 'announcement', a.id, { kind: a.kind, recipients: ids.length });
  res.status(201).json({ ...a, recipients: ids.length });
}));

router.put('/announcements/:id(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(annSchema.omit({ recipients: true }).extend({ cancelled: z.boolean().optional() }), req.body);
  const before = await one('SELECT * FROM announcements WHERE id = $1', [id]);
  if (!before) return res.status(404).json({ error: 'Not found.' });
  const a = await one(
    `UPDATE announcements SET kind=$2, title=$3, body=$4, event_at=$5, location=$6, important=$7, cancelled=coalesce($8, cancelled) WHERE id=$1 RETURNING *`,
    [id, b.kind, b.title, b.body || null, b.event_at || null, b.location || null, b.important, b.cancelled ?? null]
  );
  const ids = await annRecipients(id);
  const timeChanged = String(before.event_at) !== String(a.event_at);
  if (timeChanged) await query('DELETE FROM announcement_reminders WHERE announcement_id = $1', [id]);
  const cancelledNow = a.cancelled && !before.cancelled;
  if (cancelledNow || timeChanged) {
    const heading = cancelledNow ? `${KIND_LABEL[a.kind]} cancelled` : `${KIND_LABEL[a.kind]} rescheduled`;
    await notify(ids, { kind: 'announcement', title: `${heading}: ${a.title}`, body: a.event_at ? whenText(a.event_at) : null, link: `/messages?tab=announcements&open=${a.id}` }, req.user.id);
    await emailAnnouncement(a, ids, { heading, intro: cancelledNow ? `${req.user.name} cancelled this ${a.kind}.` : `${req.user.name} changed the time.` });
  }
  await audit(req, 'announcement.updated', 'announcement', id);
  res.json(a);
}));

router.delete('/announcements/:id(\\d+)', requireRole('admin'), ah(async (req, res) => {
  await query('DELETE FROM announcements WHERE id = $1', [Number(req.params.id)]);
  await audit(req, 'announcement.deleted', 'announcement', req.params.id);
  res.json({ ok: true });
}));

router.post('/announcements/:id(\\d+)/ack', ah(async (req, res) => {
  const id = Number(req.params.id);
  const r = await one(
    'UPDATE announcement_recipients SET acknowledged_at = coalesce(acknowledged_at, now()), read_at = coalesce(read_at, now()) WHERE announcement_id = $1 AND user_id = $2 RETURNING acknowledged_at',
    [id, req.user.id]
  );
  if (!r) return res.status(404).json({ error: 'Not found.' });
  const a = await one('SELECT * FROM announcements WHERE id = $1', [id]);
  await notify([a.created_by], { kind: 'ack', title: `${req.user.name} confirmed: ${a.title}`, link: `/messages?tab=announcements&open=${id}` }, req.user.id);
  if (a.important || a.kind === 'meeting') {
    emailUser(a.created_by, { kind: 'ack', subject: `${req.user.name} confirmed: ${a.title}`, ...noticeEmail({ heading: 'Confirmed', intro: `${req.user.name} confirmed "${a.title}".`, link: `/messages?tab=announcements&open=${id}`, button: 'See who confirmed' }) });
  }
  await audit(req, 'announcement.acknowledged', 'announcement', id);
  res.json(r);
}));

/** Runs every few minutes: reminders 24 hours and 1 hour before meetings and deadlines, and at the time of reminders. */
export async function sendEventReminders() {
  let sent = 0;
  const pick = (sql, kind) => many(
    `SELECT a.* FROM announcements a WHERE a.cancelled = FALSE AND a.event_at IS NOT NULL AND ${sql}
       AND NOT EXISTS (SELECT 1 FROM announcement_reminders x WHERE x.announcement_id = a.id AND x.kind = '${kind}')`
  );
  const jobs = [
    ['24h', await pick("a.kind IN ('meeting','deadline') AND a.event_at <= now() + interval '24 hours' AND a.event_at > now() + interval '2 hours' AND a.created_at < now() - interval '1 hour'", '24h'), 'Tomorrow'],
    ['1h', await pick("a.kind IN ('meeting','deadline') AND a.event_at <= now() + interval '60 minutes' AND a.event_at > now() AND a.created_at < now() - interval '15 minutes'", '1h'), 'Starting soon'],
    ['due', await pick("a.kind = 'reminder' AND a.event_at <= now() AND a.event_at > now() - interval '1 day'", 'due'), 'Reminder'],
  ];
  for (const [kind, rows, heading] of jobs) {
    for (const a of rows) {
      const claimed = await query('INSERT INTO announcement_reminders (announcement_id, kind) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a.id, kind]);
      if (!claimed.rowCount) continue;
      const ids = [...new Set([...(await annRecipients(a.id)), a.created_by].filter(Boolean))];
      const h = kind === 'due' ? 'Reminder' : a.kind === 'meeting' ? (kind === '1h' ? 'Meeting in 1 hour' : 'Meeting tomorrow') : (kind === '1h' ? 'Deadline in 1 hour' : 'Deadline tomorrow');
      await notify(ids, { kind: 'announcement', title: `${h}: ${a.title}`, body: whenText(a.event_at), link: `/messages?tab=announcements&open=${a.id}` });
      await emailAnnouncement(a, ids, { heading: h, intro: kind === 'due' ? 'This is the reminder you were sent.' : `${heading}: ${a.title}, ${whenText(a.event_at)}.` });
      sent++;
    }
  }
  return sent;
}

export default router;
