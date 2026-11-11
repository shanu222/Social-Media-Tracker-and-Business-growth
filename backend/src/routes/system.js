import { Router } from 'express';
import { many, one } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { storageEnabled } from '../storage.js';
import { runBackup } from '../services/backup.js';
import { config } from '../config.js';
import { ah, parse } from '../util.js';
import { z } from 'zod';
import { emailProvider, sendEmail, appUrl } from '../mailer.js';
import { aiEnabled } from '../services/ai.js';

const router = Router();

router.get('/status', ah(async (_req, res) => {
  const last = await one('SELECT created_at, size, trigger FROM backups ORDER BY created_at DESC LIMIT 1');
  res.json({
    storageEnabled, timezone: config.timezone, backupSchedule: config.backupCron, lastBackup: last,
    email: emailProvider(), appUrl: appUrl(), ai: aiEnabled(), aiModel: process.env.AI_MODEL || 'claude-sonnet-5-5',
  });
}));

router.get('/backups', requireRole('admin'), ah(async (_req, res) => {
  res.json(await many('SELECT id, storage_key, size, trigger, created_at FROM backups ORDER BY created_at DESC LIMIT 60'));
}));

router.post('/backups', requireRole('admin'), ah(async (req, res) => {
  const result = await runBackup('manual');
  if (result.skipped) return res.status(503).json({ error: 'Cloud storage is not configured yet. Add the R2_* variables on Railway.' });
  await audit(req, 'backup.created', 'backup', result.id);
  res.status(201).json(result);
}));

router.get('/emails', requireRole('admin'), ah(async (_req, res) => {
  res.json(await many('SELECT id, to_email, subject, kind, status, error, created_at FROM email_log ORDER BY id DESC LIMIT 100'));
}));

router.post('/test-email', requireRole('admin'), ah(async (req, res) => {
  const { to } = parse(z.object({ to: z.string().email().optional() }), req.body || {});
  if (!emailProvider()) return res.status(503).json({ error: 'Email is not set up. Add RESEND_API_KEY (or SMTP_*) and EMAIL_FROM on Railway.' });
  const ok = await sendEmail({
    to: to || req.user.email, kind: 'test', subject: 'Growth Desk test email',
    html: `<p>Email delivery from Growth Desk works.</p><p><a href="${appUrl()}">Open Growth Desk</a></p>`,
    text: `Email delivery from Growth Desk works. ${appUrl()}`,
  });
  if (!ok) {
    const last = await one('SELECT error FROM email_log ORDER BY id DESC LIMIT 1');
    return res.status(502).json({ error: `Sending failed: ${last?.error || 'unknown error'}` });
  }
  res.json({ ok: true });
}));

export default router;
