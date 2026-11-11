import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { requireProductAccess } from '../access.js';
import { notify, productAudience } from '../notify.js';
import { ah, parse } from '../util.js';

/*
 * Permanent product library: every uploaded file AND every shared link (Google Drive, YouTube,
 * Instagram reels, Dropbox…), kept forever under the product — even after tasks are completed.
 */

export const CONTENT_TYPES = ['video', 'reel', 'image', 'document', 'drive', 'social', 'link', 'other'];

export function contentTypeFor(url = '', mime = '') {
  const u = url.toLowerCase();
  if (/drive\.google\.com|docs\.google\.com|dropbox\.com|onedrive\.live\.com|1drv\.ms|sharepoint\.com/.test(u)) return 'drive';
  if (/instagram\.com\/reel|tiktok\.com|youtube\.com\/shorts|facebook\.com\/reel/.test(u)) return 'reel';
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(u) || mime.startsWith('video/')) return 'video';
  if (/instagram\.com|facebook\.com|linkedin\.com|x\.com|twitter\.com|t\.me|discord\.(gg|com)/.test(u)) return 'social';
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)(\?|$)/.test(u)) return 'image';
  if (mime.includes('pdf') || mime.includes('document') || mime.includes('sheet') || mime.includes('presentation') || mime.startsWith('text/') || /\.(pdf|docx?|xlsx?|pptx?)(\?|$)/.test(u)) return 'document';
  return url ? 'link' : 'other';
}

const router = Router({ mergeParams: true });
router.use(requireProductAccess());

router.get('/', ah(async (req, res) => {
  const type = CONTENT_TYPES.includes(req.query.type) ? req.query.type : null;
  const q = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim().toLowerCase()}%` : null;
  const rows = await many(
    `SELECT * FROM (
       SELECT 'file' AS source, f.id, f.name AS title, NULL AS url, f.mime, f.size,
              coalesce(f.content_type, CASE WHEN f.mime LIKE 'video/%' THEN 'video' WHEN f.mime LIKE 'image/%' THEN 'image'
                WHEN f.mime IN ('application/pdf','text/plain','text/csv') OR f.mime LIKE 'application/vnd.openxmlformats%' THEN 'document' ELSE 'other' END) AS content_type,
              f.note, f.task_id, t.title AS task_title, f.uploaded_by AS created_by, u.name AS created_by_name, f.created_at
         FROM files f LEFT JOIN tasks t ON t.id = f.task_id LEFT JOIN users u ON u.id = f.uploaded_by
        WHERE f.product_id = $1
       UNION ALL
       SELECT 'link', l.id, l.title, l.url, NULL, NULL, l.content_type, l.note, l.task_id, t.title, l.created_by, u.name, l.created_at
         FROM links l LEFT JOIN tasks t ON t.id = l.task_id LEFT JOIN users u ON u.id = l.created_by
        WHERE l.product_id = $1
     ) x
     WHERE ($2::text IS NULL OR x.content_type = $2) AND ($3::text IS NULL OR lower(x.title) LIKE $3 OR lower(coalesce(x.note,'')) LIKE $3 OR lower(coalesce(x.url,'')) LIKE $3)
     ORDER BY x.created_at DESC LIMIT 1000`,
    [req.productId, type, q]
  );
  res.json(rows);
}));

const linkSchema = z.object({
  title: z.string().trim().max(200).optional(),
  url: z.string().trim().url().max(2000),
  content_type: z.enum(CONTENT_TYPES).optional(),
  note: z.string().max(1000).nullish(),
  task_id: z.number().int().positive().nullish(),
});

router.post('/links', requireRole('manager'), ah(async (req, res) => {
  const b = parse(linkSchema, req.body);
  if (!/^https?:\/\//i.test(b.url)) return res.status(400).json({ error: 'Links must start with http:// or https://' });
  if (b.task_id) {
    const t = await one('SELECT 1 FROM tasks WHERE id = $1 AND product_id = $2', [b.task_id, req.productId]);
    if (!t) return res.status(400).json({ error: 'That task belongs to another product.' });
  }
  const l = await one(
    'INSERT INTO links (product_id, task_id, title, url, content_type, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [req.productId, b.task_id ?? null, b.title || b.url.replace(/^https?:\/\//, '').slice(0, 80), b.url, b.content_type || contentTypeFor(b.url), b.note || null, req.user.id]
  );
  const product = await one('SELECT name FROM products WHERE id = $1', [req.productId]);
  await notify(await productAudience(req.productId), {
    kind: 'file', title: `New link in ${product.name} library`, body: l.title, link: `/products/${req.productId}?tab=library`, productId: req.productId,
  }, req.user.id);
  await audit(req, 'link.added', 'link', l.id, { title: l.title, url: l.url }, req.productId);
  res.status(201).json(l);
}));

router.delete('/links/:linkId(\\d+)', requireRole('manager'), ah(async (req, res) => {
  const l = await one('SELECT * FROM links WHERE id = $1 AND product_id = $2', [Number(req.params.linkId), req.productId]);
  if (!l) return res.status(404).json({ error: 'Link not found.' });
  if (req.user.role !== 'admin' && l.created_by !== req.user.id) return res.status(403).json({ error: 'You can only remove links you added.' });
  await one('DELETE FROM links WHERE id = $1 RETURNING id', [l.id]);
  await audit(req, 'link.deleted', 'link', l.id, { title: l.title }, req.productId);
  res.json({ ok: true });
}));

export default router;
