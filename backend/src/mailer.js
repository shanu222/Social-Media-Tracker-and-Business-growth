import { query, one } from './db.js';
import { config } from './config.js';
import { BRAND } from './brand.js';

/**
 * Email delivery. Two options, set on Railway:
 *  1. RESEND_API_KEY (+ EMAIL_FROM)  — HTTPS API, works on every Railway plan (recommended)
 *  2. SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS (+ EMAIL_FROM) — e.g. Gmail app password, Zoho, Brevo.
 *     Note: Railway only allows outbound SMTP on paid plans.
 * Without either, emails are skipped (and logged) — in-app notifications still work.
 */

export function emailProvider() {
  if (process.env.EMAIL_OUTBOX_DIR) return 'outbox'; // local development: write emails to files
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST) return 'smtp';
  return null;
}

export const appUrl = () =>
  (process.env.APP_URL || config.corsOrigins.find((o) => o.startsWith('https://')) || config.corsOrigins[0] || '').replace(/\/$/, '');

let smtp = null;
async function smtpTransport() {
  if (smtp) return smtp;
  const nodemailer = (await import('nodemailer')).default;
  const port = Number(process.env.SMTP_PORT || 587);
  smtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return smtp;
}

async function deliver({ to, subject, html, text }) {
  const from = process.env.EMAIL_FROM || 'Growth Desk for RTL <onboarding@resend.dev>';
  const provider = emailProvider();
  if (provider === 'outbox') {
    const fs = await import('node:fs/promises');
    await fs.mkdir(process.env.EMAIL_OUTBOX_DIR, { recursive: true });
    const name = `${Date.now()}-${to.replace(/[^\w@.-]/g, '_')}.html`;
    await fs.writeFile(`${process.env.EMAIL_OUTBOX_DIR}/${name}`, `<!-- To: ${to} | From: ${from} | Subject: ${subject} -->\n${html}`);
    return;
  }
  if (provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.message || `Resend HTTP ${res.status}`);
    }
    return;
  }
  if (provider === 'smtp') {
    const t = await smtpTransport();
    await t.sendMail({ from, to, subject, html, text });
    return;
  }
  throw new Error('No email provider configured');
}

/**
 * Sends one email and records the outcome. Never throws.
 * Returns { ok, status: 'sent' | 'failed' | 'skipped', error }.
 */
export async function sendEmailResult({ to, subject, html, text, kind = null, userId = null, ref = null }) {
  const log = (status, error = null) =>
    query('INSERT INTO email_log (to_email, subject, kind, status, error, user_id, ref) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [to || '(none)', subject, kind, status, error, userId, ref]).catch(() => {});
  if (!to) { await log('skipped', 'No email address'); return { ok: false, status: 'skipped', error: 'No email address' }; }
  if (!emailProvider()) { await log('skipped', 'Email not configured'); return { ok: false, status: 'skipped', error: 'Email is not set up on the server' }; }
  let lastErr;
  // One retry for temporary failures (network, rate limits)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await deliver({ to, subject, html, text });
      await log('sent');
      return { ok: true, status: 'sent', error: null };
    } catch (e) {
      lastErr = e;
      if (attempt === 0 && /timeout|ECONN|ETIMEDOUT|429|rate|5\d\d|network|fetch failed/i.test(e.message)) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      break;
    }
  }
  console.error('[email] failed', lastErr.message);
  await log('failed', lastErr.message.slice(0, 300));
  return { ok: false, status: 'failed', error: lastErr.message.slice(0, 300) };
}

export async function sendEmail(msg) {
  return (await sendEmailResult(msg)).ok;
}

/**
 * Email a person by id. Routine emails respect their "Email me" setting; `important: true`
 * (admin messages marked important, announcements, meetings, reminders, deadlines) is always sent.
 * Returns { ok, status, error }. Fire-and-forget safe.
 */
export async function emailUserResult(userId, msg, { important = false, ref = null } = {}) {
  const u = await one('SELECT email, notify_email, name, active, email_notifications, deleted_at FROM users WHERE id = $1', [userId]).catch(() => null);
  if (!u || !u.active || u.deleted_at) return { ok: false, status: 'skipped', error: 'Account not active' };
  const to = u.notify_email || u.email;
  if (!u.email_notifications && !important) {
    await query('INSERT INTO email_log (to_email, subject, kind, status, error, user_id, ref) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [to, msg.subject, msg.kind || null, 'skipped', 'Emails turned off for this person', userId, ref ?? msg.ref ?? null]).catch(() => {});
    return { ok: false, status: 'skipped', error: 'Emails turned off for this person' };
  }
  return sendEmailResult({ ...msg, to, userId, ref: ref ?? msg.ref ?? null });
}

export async function emailUser(userId, msg, opts) {
  return (await emailUserResult(userId, msg, opts)).ok;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PRIO = { urgent: '#b8322a', high: '#a86a12', normal: '#3346b0', low: '#5e6a7c' };

/** Branded HTML email with task details and a button that opens the task. */
export function taskEmail({ heading, intro, task, productName, link, extra }) {
  const url = `${appUrl()}${link}`;
  const due = task.due_date ? new Date(task.due_date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'No deadline';
  const rows = [
    ['Task', `<b>${esc(task.title)}</b>`],
    ['Product', esc(productName)],
    ['Priority', `<span style="color:${PRIO[task.priority] || '#333'};font-weight:600">${esc((task.priority || 'normal').replace(/^./, (c) => c.toUpperCase()))}</span>`],
    ['Due', esc(due)],
    task.progress !== undefined && task.progress !== null ? ['Progress', `${task.progress}%`] : null,
  ].filter(Boolean);
  const desc = task.description || task.instructions;
  const html = `<!doctype html><html><body style="margin:0;background:#eef1f4;font-family:Segoe UI,Arial,sans-serif;color:#1b2433">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
    <tr><td style="background:#0a1a3d;padding:20px 24px;color:#fff;font-size:18px;font-weight:700"><img src="${esc(appUrl())}/rtl-logo-192.png" width="36" height="36" alt="RTL" style="vertical-align:middle;margin-right:10px">${esc(heading)}</td></tr>
    <tr><td style="height:4px;background:linear-gradient(90deg,#1a5fe0,#12b5e8,#16b97a);background-color:#12b5e8"></td></tr>
    <tr><td style="padding:22px 24px">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${esc(intro)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#5e6a7c;width:90px;vertical-align:top">${k}</td><td style="padding:6px 0">${v}</td></tr>`).join('')}
      </table>
      ${desc ? `<div style="margin-top:14px;padding:12px 14px;background:#f6f8fa;border-radius:9px;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(desc).slice(0, 1500)}</div>` : ''}
      ${extra ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(extra)}</p>` : ''}
      <p style="margin:22px 0 4px"><a href="${esc(url)}" style="display:inline-block;background:#1a5fe0;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Open task</a></p>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f6f8fa;color:#8a95a5;font-size:12px">${esc(BRAND.app)} · ${esc(BRAND.legal)}<br>You get this because you're on this product. You can turn emails off in Settings.</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${heading}\n\n${intro}\n\nTask: ${task.title}\nProduct: ${productName}\nPriority: ${task.priority}\nDue: ${due}\n${desc ? `\n${desc}\n` : ''}${extra ? `\n${extra}\n` : ''}\nOpen: ${url}`;
  return { html, text };
}

/** Branded email for messages, announcements and meeting reminders. `rows` = [label, plain text][]. */
export function noticeEmail({ heading, intro, rows = [], body, link, button = 'Open in Growth Desk', footer }) {
  const url = `${appUrl()}${link}`;
  const html = `<!doctype html><html><body style="margin:0;background:#eef1f4;font-family:Segoe UI,Arial,sans-serif;color:#1b2433">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
    <tr><td style="background:#0a1a3d;padding:20px 24px;color:#fff;font-size:18px;font-weight:700"><img src="${esc(appUrl())}/rtl-logo-192.png" width="36" height="36" alt="RTL" style="vertical-align:middle;margin-right:10px">${esc(heading)}</td></tr>
    <tr><td style="height:4px;background:linear-gradient(90deg,#1a5fe0,#12b5e8,#16b97a);background-color:#12b5e8"></td></tr>
    <tr><td style="padding:22px 24px">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.5">${esc(intro)}</p>
      ${rows.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:5px 0;color:#5e6a7c;width:90px;vertical-align:top">${esc(k)}</td><td style="padding:5px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>` : ''}
      ${body ? `<div style="margin-top:12px;padding:12px 14px;background:#f6f8fa;border-radius:9px;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(body).slice(0, 2000)}</div>` : ''}
      <p style="margin:22px 0 4px"><a href="${esc(url)}" style="display:inline-block;background:#1a5fe0;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">${esc(button)}</a></p>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f6f8fa;color:#8a95a5;font-size:12px">${esc(BRAND.app)} · ${esc(BRAND.legal)}${footer ? `<br>${esc(footer)}` : ''}</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${heading}\n\n${intro}\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n${body ? `\n${body}\n` : ''}\nOpen: ${url}`;
  return { html, text };
}
