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
import { PRESETS, listKeys, addKey, updateKey, reorderKeys, testKey, testAllKeys, presentKey } from '../services/aiProviders.js';

const router = Router();

router.get('/status', ah(async (_req, res) => {
  const last = await one('SELECT created_at, size, trigger FROM backups ORDER BY created_at DESC LIMIT 1');
  res.json({
    storageEnabled, timezone: config.timezone, backupSchedule: config.backupCron, lastBackup: last,
    email: emailProvider(), appUrl: appUrl(), ai: await aiEnabled(),
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
    to: target, kind: 'test', subject: 'Growth Desk for RTL test email',
    html: `<p>Email delivery from Growth Desk for RTL works.</p><p><a href="${appUrl()}">Open Growth Desk for RTL</a></p>`,
    text: `Email delivery from Growth Desk for RTL works. ${appUrl()}`,
  });
  if (!ok) {
    const last = await one('SELECT error FROM email_log ORDER BY id DESC LIMIT 1');
    return res.status(502).json({ error: `Sending failed: ${last?.error || 'unknown error'}` });
  }
  res.json({ ok: true, to: target });
}));

/* ---------------- AI keys (admin) ---------------- */
const presets = () => Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, pricing: v.pricing, keyUrl: v.keyUrl, models: v.models, needsBaseUrl: k === 'custom' }]));
const keySchema = z.object({
  provider: z.enum(Object.keys(PRESETS)),
  label: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().min(8).max(500),
  models: z.array(z.string().trim().min(1).max(150)).max(10).optional(),
  base_url: z.string().trim().url().max(300).or(z.literal('')).optional(),
  test: z.boolean().default(true),
});

router.get('/ai', requireRole('admin'), ah(async (_req, res) => {
  res.json({ fallback: process.env.AI_FALLBACK_ENABLED !== 'false', presets: presets(), keys: await listKeys() });
}));

router.post('/ai/keys', requireRole('admin'), ah(async (req, res) => {
  const b = parse(keySchema, req.body);
  if (b.provider === 'custom' && !b.base_url) return res.status(400).json({ error: 'Enter the base URL of the OpenAI-compatible service.' });
  if (b.provider === 'custom' && !b.models?.length) return res.status(400).json({ error: 'Enter at least one model name.' });
  const k = await addKey(b);
  await audit(req, 'ai.key_added', 'ai_key', k.id, { provider: k.provider, label: k.label });
  res.status(201).json(b.test ? await testKey(k.id) : presentKey(k));
}));

router.put('/ai/keys/:id(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const b = parse(keySchema.partial().extend({ enabled: z.boolean().optional(), apiKey: z.string().trim().min(8).max(500).or(z.literal('')).optional() }), req.body);
  const k = await updateKey(Number(req.params.id), { ...b, apiKey: b.apiKey || undefined });
  if (!k) return res.status(404).json({ error: 'Key not found.' });
  await audit(req, b.apiKey ? 'ai.key_replaced' : 'ai.key_updated', 'ai_key', k.id, { label: k.label });
  res.json(b.apiKey || b.models || b.base_url !== undefined ? await testKey(k.id) : presentKey(k));
}));

router.delete('/ai/keys/:id(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const k = await one('DELETE FROM ai_keys WHERE id = $1 RETURNING label, provider', [Number(req.params.id)]);
  if (!k) return res.status(404).json({ error: 'Key not found.' });
  await audit(req, 'ai.key_deleted', 'ai_key', req.params.id, k);
  res.json({ ok: true });
}));

router.post('/ai/keys/reorder', requireRole('admin'), ah(async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.number().int().positive()).max(100) }), req.body);
  await reorderKeys(ids);
  res.json({ keys: await listKeys() });
}));

router.post('/ai/keys/:id(\\d+)/test', requireRole('admin'), ah(async (req, res) => {
  res.json(await testKey(Number(req.params.id)));
}));

router.post('/ai/test', requireRole('admin'), ah(async (req, res) => {
  const keys = await testAllKeys();
  await audit(req, 'ai.tested', 'system', null, { working: keys.filter((k) => k.state === 'ok').map((k) => k.label) });
  res.json({ keys });
}));

export default router;
