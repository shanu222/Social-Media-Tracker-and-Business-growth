import { query, one } from './db.js';
import { config } from './config.js';

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
  const from = process.env.EMAIL_FROM || 'Growth Desk <onboarding@resend.dev>';
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

/** Sends one email and records the outcome. Never throws. */
export async function sendEmail({ to, subject, html, text, kind = null }) {
  if (!to) return false;
  if (!emailProvider()) {
    await query('INSERT INTO email_log (to_email, subject, kind, status, error) VALUES ($1,$2,$3,$4,$5)', [to, subject, kind, 'skipped', 'Email not configured']).catch(() => {});
    return false;
  }
  try {
    await deliver({ to, subject, html, text });
    await query('INSERT INTO email_log (to_email, subject, kind, status) VALUES ($1,$2,$3,$4)', [to, subject, kind, 'sent']).catch(() => {});
    return true;
  } catch (e) {
    console.error('[email] failed', e.message);
    await query('INSERT INTO email_log (to_email, subject, kind, status, error) VALUES ($1,$2,$3,$4,$5)', [to, subject, kind, 'failed', e.message.slice(0, 300)]).catch(() => {});
    return false;
  }
}

/** Email a user by id if they are active and haven't turned emails off. Fire-and-forget safe. */
export async function emailUser(userId, msg) {
  const u = await one('SELECT email, name, active, email_notifications FROM users WHERE id = $1', [userId]).catch(() => null);
  if (!u || !u.active || !u.email_notifications) return false;
  return sendEmail({ ...msg, to: u.email });
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
    <tr><td style="background:#172133;padding:20px 24px;color:#fff;font-size:18px;font-weight:700">${esc(heading)}</td></tr>
    <tr><td style="padding:22px 24px">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${esc(intro)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#5e6a7c;width:90px;vertical-align:top">${k}</td><td style="padding:6px 0">${v}</td></tr>`).join('')}
      </table>
      ${desc ? `<div style="margin-top:14px;padding:12px 14px;background:#f6f8fa;border-radius:9px;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(desc).slice(0, 1500)}</div>` : ''}
      ${extra ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(extra)}</p>` : ''}
      <p style="margin:22px 0 4px"><a href="${esc(url)}" style="display:inline-block;background:#0b7a62;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Open task</a></p>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f6f8fa;color:#8a95a5;font-size:12px">Growth Desk · You get this because you're on this product. You can turn emails off in Settings.</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${heading}\n\n${intro}\n\nTask: ${task.title}\nProduct: ${productName}\nPriority: ${task.priority}\nDue: ${due}\n${desc ? `\n${desc}\n` : ''}${extra ? `\n${extra}\n` : ''}\nOpen: ${url}`;
  return { html, text };
}
