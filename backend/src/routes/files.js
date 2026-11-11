import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { many, one } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { storageEnabled, putObject, deleteObject, signedDownloadUrl, signedViewUrl, signedUploadUrl, headObject } from '../storage.js';
import { contentTypeFor } from './library.js';
import { canAccessProduct, productIdsFor } from '../access.js';
import { notify, productAudience } from '../notify.js';
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

const CATEGORIES = ['insights', 'content', 'report', 'backup', 'invoice', 'published', 'other'];

router.get('/', ah(async (req, res) => {
  const category = req.query.category && CATEGORIES.includes(req.query.category) ? req.query.category : null;
  const productId = req.query.product_id ? Number(req.query.product_id) : null;
  if (productId && !(await canAccessProduct(req.user, productId))) return res.status(404).json({ error: 'Product not found.' });
  const allowed = await productIdsFor(req.user);
  const where = ['(f.product_id IS NULL OR f.product_id = ANY($1))'];
  const params = [allowed];
  if (category) { params.push(category); where.push(`f.category = $${params.length}`); }
  if (productId) { params.push(productId); where.push(`f.product_id = $${params.length}`); }
  const rows = await many(
    `SELECT f.id, f.name, f.mime, f.size, f.category, f.note, f.created_at, f.account_id, f.product_id, f.task_id,
       f.uploaded_by, a.brand, pr.name AS product_name, t.title AS task_title, u.name AS uploaded_by_name
     FROM files f LEFT JOIN accounts a ON a.id = f.account_id LEFT JOIN users u ON u.id = f.uploaded_by
     LEFT JOIN products pr ON pr.id = f.product_id LEFT JOIN tasks t ON t.id = f.task_id
     WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC LIMIT 500`,
    params
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
      product_id: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
      task_id: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
      note: z.string().max(500).optional(),
    }),
    req.body
  );
  if (meta.product_id && !(await canAccessProduct(req.user, meta.product_id))) return res.status(404).json({ error: 'Product not found.' });
  if (meta.task_id) {
    const t = await one('SELECT product_id FROM tasks WHERE id = $1', [meta.task_id]);
    if (!t || t.product_id !== meta.product_id) return res.status(400).json({ error: 'That task belongs to another product.' });
  }
  const safeName = path.basename(req.file.originalname).replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file';
  // Random, unguessable object key — names are never used as keys
  const key = `files/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${path.extname(safeName).toLowerCase()}`;
  await putObject(key, req.file.buffer, req.file.mimetype);
  const f = await one(
    `INSERT INTO files (storage_key, name, mime, size, category, account_id, product_id, task_id, note, uploaded_by, content_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, name, mime, size, category, note, created_at, product_id, task_id`,
    [key, safeName, req.file.mimetype, req.file.size, meta.category, meta.account_id ?? null, meta.product_id ?? null,
      meta.task_id ?? null, meta.note || null, req.user.id, contentTypeFor('', req.file.mimetype)]
  );
  await audit(req, 'file.uploaded', 'file', f.id, { name: f.name, size: f.size }, meta.product_id ?? null);
  if (meta.product_id && !meta.task_id) {
    const pr = await one('SELECT name FROM products WHERE id = $1', [meta.product_id]);
    await notify(await productAudience(meta.product_id), {
      kind: 'file', title: `New file for ${pr.name}`, body: safeName, link: `/products/${meta.product_id}?tab=files`, productId: meta.product_id,
    }, req.user.id);
  }
  res.status(201).json(f);
}));

/** Returns a 5-minute signed link. The bucket itself is never public. */
const MAX_DIRECT_GB = Number(process.env.MAX_DIRECT_UPLOAD_GB || 5);
const directSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mime: z.string().min(3).max(150),
  size: z.number().int().positive(),
  category: z.enum(CATEGORIES).default('content'),
  product_id: z.number().int().positive().nullish(),
  task_id: z.number().int().positive().nullish(),
  note: z.string().max(500).nullish(),
});

/** Step 1 of a large upload: get a one-hour signed URL to PUT the file straight into R2. */
router.post('/presign', requireRole('manager'), ah(async (req, res) => {
  if (!storageEnabled) return res.status(503).json({ error: 'Cloud storage is not configured yet.' });
  const b = parse(directSchema, req.body);
  if (!ALLOWED.has(b.mime)) return res.status(400).json({ error: 'This file type is not allowed. Upload images, videos, PDFs, CSV or Office files.' });
  if (b.size > MAX_DIRECT_GB * 1024 ** 3) return res.status(413).json({ error: `Files can be up to ${MAX_DIRECT_GB} GB. Share bigger files as a Google Drive link.` });
  if (b.product_id && !(await canAccessProduct(req.user, b.product_id))) return res.status(404).json({ error: 'Product not found.' });
  const safeName = path.basename(b.name).replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file';
  const key = `uploads/${req.user.id}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${path.extname(safeName).toLowerCase()}`;
  res.json({ key, uploadUrl: await signedUploadUrl(key, b.mime), headers: { 'Content-Type': b.mime } });
}));

/** Step 2: confirm the object landed in R2 and register it (in the product library too). */
router.post('/complete', requireRole('manager'), ah(async (req, res) => {
  const b = parse(directSchema.extend({ key: z.string().regex(/^uploads\/\d+\/\d{4}-\d{2}\/[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/) }), req.body);
  if (!b.key.startsWith(`uploads/${req.user.id}/`)) return res.status(403).json({ error: 'Upload key does not belong to you.' });
  if (b.product_id && !(await canAccessProduct(req.user, b.product_id))) return res.status(404).json({ error: 'Product not found.' });
  if (b.task_id) {
    const t = await one('SELECT product_id FROM tasks WHERE id = $1', [b.task_id]);
    if (!t || t.product_id !== b.product_id) return res.status(400).json({ error: 'That task belongs to another product.' });
  }
  const head = await headObject(b.key);
  if (!head) return res.status(400).json({ error: 'The upload did not reach cloud storage. Check the bucket CORS rule and try again.' });
  const exists = await one('SELECT id FROM files WHERE storage_key = $1', [b.key]);
  if (exists) return res.json(exists);
  const safeName = path.basename(b.name).replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file';
  const f = await one(
    `INSERT INTO files (storage_key, name, mime, size, category, product_id, task_id, note, uploaded_by, content_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, name, mime, size, category, note, created_at, product_id, task_id`,
    [b.key, safeName, b.mime, Number(head.ContentLength) || b.size, b.category, b.product_id ?? null, b.task_id ?? null,
      b.note || null, req.user.id, contentTypeFor('', b.mime)]
  );
  await audit(req, 'file.uploaded', 'file', f.id, { name: f.name, size: f.size, direct: true }, b.product_id ?? null);
  res.status(201).json(f);
}));

async function loadFile(req) {
  const f = await one('SELECT * FROM files WHERE id = $1', [Number(req.params.id)]);
  if (!f || (f.product_id && !(await canAccessProduct(req.user, f.product_id)))) return null;
  return f;
}

/** Inline preview link (images/videos) — 1 hour. */
router.get('/:id/view', ah(async (req, res) => {
  const f = await loadFile(req);
  if (!f) return res.status(404).json({ error: 'File not found.' });
  res.json({ url: await signedViewUrl(f.storage_key, 3600) });
}));

router.get('/:id/download', ah(async (req, res) => {
  const f = await loadFile(req);
  if (!f) return res.status(404).json({ error: 'File not found.' });
  const url = await signedDownloadUrl(f.storage_key, f.name);
  await audit(req, 'file.downloaded', 'file', f.id, null, f.product_id);
  res.json({ url });
}));

router.delete('/:id', requireRole('manager'), ah(async (req, res) => {
  const existing = await loadFile(req);
  if (!existing) return res.status(404).json({ error: 'File not found.' });
  if (req.user.role !== 'admin' && existing.uploaded_by !== req.user.id) return res.status(403).json({ error: 'You can only delete files you uploaded.' });
  const f = await one('DELETE FROM files WHERE id = $1 RETURNING *', [existing.id]);
  if (storageEnabled) await deleteObject(f.storage_key).catch(() => {});
  await audit(req, 'file.deleted', 'file', f.id, { name: f.name }, f.product_id);
  res.json({ ok: true });
}));

export default router;
