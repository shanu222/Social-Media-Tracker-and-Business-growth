import { Router } from 'express';
import { many, one } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { storageEnabled } from '../storage.js';
import { runBackup } from '../services/backup.js';
import { config } from '../config.js';
import { ah } from '../util.js';

const router = Router();

router.get('/status', ah(async (_req, res) => {
  const last = await one('SELECT created_at, size, trigger FROM backups ORDER BY created_at DESC LIMIT 1');
  res.json({ storageEnabled, timezone: config.timezone, backupSchedule: config.backupCron, lastBackup: last });
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

export default router;
