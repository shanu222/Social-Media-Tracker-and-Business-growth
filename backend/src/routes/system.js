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
import { providerStatus, testProviders } from '../services/aiProviders.js';

const router = Router();

router.get('/status', ah(async (_req, res) => {
  const last = await one('SELECT created_at, size, trigger FROM backups ORDER BY created_at DESC LIMIT 1');
  res.json({
    storageEnabled, timezone: config.timezone, backupSchedule: config.backupCron, lastBackup: last,
    email: emailProvider(), appUrl: appUrl(), ai: aiEnabled(),
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
  const me = await one('SELECT email, notify_email FROM users WHERE id = $1', [req.user.id]);
  const target = to || me.notify_email || me.email;
  const ok = await sendEmail({
    to: target, kind: 'test', subject: 'Growth Desk test email',
    html: `<p>Email delivery from Growth Desk works.</p><p><a href="${appUrl()}">Open Growth Desk</a></p>`,
    text: `Email delivery from Growth Desk works. ${appUrl()}`,
  });
  if (!ok) {
    const last = await one('SELECT error FROM email_log ORDER BY id DESC LIMIT 1');
    return res.status(502).json({ error: `Sending failed: ${last?.error || 'unknown error'}` });
  }
  res.json({ ok: true, to: target });
}));

/** AI key health for the admin. */
router.get('/ai', requireRole('admin'), ah(async (_req, res) => {
  res.json({ order: (process.env.AI_PROVIDER_ORDER || 'openai,gemini,openrouter,anthropic'), fallback: process.env.AI_FALLBACK_ENABLED !== 'false', providers: await providerStatus() });
}));

router.post('/ai/test', requireRole('admin'), ah(async (req, res) => {
  const providers = await testProviders();
  await audit(req, 'ai.tested', 'system', null, { working: providers.filter((p) => p.state === 'ok').map((p) => p.provider) });
  res.json({ providers });
}));

export default router;
