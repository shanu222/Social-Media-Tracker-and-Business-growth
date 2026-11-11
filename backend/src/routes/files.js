import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { many, one } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { storageEnabled, putObject, deleteObject, signedDownloadUrl } from '../storage.js';
import { ah, parse } from '../util.js';

const router = Router();

const ALLOWED = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf', 'text/csv', 'text/plain', 'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      const err = new Error('This file type is not allowed. Upload images, videos, PDFs, CSV or Office files.');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

const CATEGORIES = ['insights', 'content', 'report', 'backup', 'invoice', 'other'];

router.get('/', ah(async (req, res) => {
  const category = req.query.category && CATEGORIES.includes(req.query.category) ? req.query.category : null;
  const rows = await many(
    `SELECT f.id, f.name, f.mime, f.size, f.category, f.note, f.created_at, f.account_id, a.brand, u.name AS uploaded_by_name
     FROM files f LEFT JOIN accounts a ON a.id = f.account_id LEFT JOIN users u ON u.id = f.uploaded_by
     ${category ? 'WHERE f.category = $1' : ''} ORDER BY f.created_at DESC LIMIT 500`,
    category ? [category] : []
  );
  res.json({ storageEnabled, maxUploadMb: config.maxUploadMb, files: rows });
}));

router.post('/', requireRole('manager'), upload.single('file'), ah(async (req, res) => {
  if (!storageEnabled) return res.status(503).json({ error: 'Cloud storage is not configured yet. Add the R2_* variables on Railway.' });
  if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });
  const meta = parse(
    z.object({
      category: z.enum(CATEGORIES).default('other'),
      account_id: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
      note: z.string().max(500).optional(),
    }),
    req.body
  );
  const safeName = path.basename(req.file.originalname).replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file';
  // Random, unguessable object key — names are never used as keys
  const key = `files/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${path.extname(safeName).toLowerCase()}`;
  await putObject(key, req.file.buffer, req.file.mimetype);
  const f = await one(
    `INSERT INTO files (storage_key, name, mime, size, category, account_id, note, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, mime, size, category, note, created_at`,
    [key, safeName, req.file.mimetype, req.file.size, meta.category, meta.account_id ?? null, meta.note || null, req.user.id]
  );
  await audit(req, 'file.uploaded', 'file', f.id, { name: f.name, size: f.size });
  res.status(201).json(f);
}));

/** Returns a 5-minute signed link. The bucket itself is never public. */
router.get('/:id/download', ah(async (req, res) => {
  const f = await one('SELECT * FROM files WHERE id = $1', [Number(req.params.id)]);
  if (!f) return res.status(404).json({ error: 'File not found.' });
  const url = await signedDownloadUrl(f.storage_key, f.name);
  await audit(req, 'file.downloaded', 'file', f.id);
  res.json({ url });
}));

router.delete('/:id', requireRole('manager'), ah(async (req, res) => {
  const f = await one('DELETE FROM files WHERE id = $1 RETURNING *', [Number(req.params.id)]);
  if (!f) return res.status(404).json({ error: 'File not found.' });
  if (storageEnabled) await deleteObject(f.storage_key).catch(() => {});
  await audit(req, 'file.deleted', 'file', f.id, { name: f.name });
  res.json({ ok: true });
}));

export default router;
