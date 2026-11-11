import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { requireProductAccess, productIdsFor } from '../access.js';
import { notify } from '../notify.js';
import { storageEnabled, putObject, deleteObject, signedViewUrl } from '../storage.js';
import { ah, parse, today, addDays } from '../util.js';
import { PRODUCT_TYPES, guessType, setupProductKpis } from '../services/kpiTemplates.js';
import { setupProductChecklist } from '../services/checklistTemplates.js';

const router = Router();

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  tagline: z.string().max(200).nullish(),
  description: z.string().max(8000).nullish(),
  website_url: z.string().trim().url().max(500).or(z.literal('')).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  category: z.enum(Object.keys(PRODUCT_TYPES)).nullish(),
  member_ids: z.array(z.number().int().positive()).max(50).optional(),
});

async function withImage(p) {
  return { ...p, image_url: p.image_key && storageEnabled ? await signedViewUrl(p.image_key) : null };
}

/** List of product workspaces with headline numbers for each card. */
router.get('/', ah(async (req, res) => {
  const ids = await productIdsFor(req.user);
  if (!ids.length) return res.json([]);
  const rows = await many(
    `SELECT p.*,
       (SELECT count(*) FROM accounts a WHERE a.product_id = p.id AND a.archived = FALSE) AS account_count,
       (SELECT coalesce(sum(l.followers),0) FROM accounts a
          LEFT JOIN LATERAL (SELECT followers FROM snapshots s WHERE s.account_id = a.id AND s.followers IS NOT NULL ORDER BY date DESC LIMIT 1) l ON TRUE
          WHERE a.product_id = p.id AND a.archived = FALSE) AS followers,
       (SELECT count(*) FROM tasks t WHERE t.product_id = p.id AND t.status IN ('todo','in_progress')) AS open_tasks,
       (SELECT count(*) FROM tasks t WHERE t.product_id = p.id AND t.status IN ('todo','in_progress') AND t.due_date < $2) AS overdue_tasks,
       (SELECT count(*) FROM posts x WHERE x.product_id = p.id AND x.posted_on >= $3) AS posts_30d,
       (SELECT count(*) FROM messages m WHERE m.product_id = p.id AND m.user_id IS DISTINCT FROM $4
          AND m.id > coalesce((SELECT last_read_id FROM chat_reads r WHERE r.user_id = $4 AND r.product_id = p.id), 0)) AS unread,
       (SELECT coalesce(json_agg(json_build_object('id', u.id, 'name', u.name)), '[]') FROM product_members pm JOIN users u ON u.id = pm.user_id WHERE pm.product_id = p.id) AS members
     FROM products p WHERE p.id = ANY($1) AND (p.archived = FALSE OR $5)
     ORDER BY p.archived, p.name`,
    [ids, today(), addDays(today(), -29), req.user.id, req.query.archived === 'true']
  );
  res.json(await Promise.all(rows.map(withImage)));
}));

router.post('/', requireRole('admin'), ah(async (req, res) => {
  const b = parse(productSchema, req.body);
  const p = await tx(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO products (name, tagline, description, website_url, color, created_by, category) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [b.name, b.tagline || null, b.description || null, b.website_url || null, b.color || null, req.user.id, b.category || guessType(b)]
    );
    // Every new product starts with the KPI set that fits its type
    await setupProductKpis(c, rows[0].id, rows[0].category);
    await setupProductChecklist(c, rows[0].id, { type: rows[0].category });
    for (const uid of b.member_ids || []) {
      await c.query('INSERT INTO product_members (product_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, uid]);
    }
    return rows[0];
  });
  await audit(req, 'product.created', 'product', p.id, { name: p.name }, p.id);
  if (b.member_ids?.length) {
    await notify(b.member_ids, { kind: 'assigned', title: `You were added to ${p.name}`, link: `/products/${p.id}`, productId: p.id }, req.user.id);
  }
  res.status(201).json(p);
}));

/** Full workspace: product, members, accounts (latest stats), task counts. */
router.get('/:productId(\\d+)', requireProductAccess(), ah(async (req, res) => {
  const id = req.productId;
  const p = await one('SELECT * FROM products WHERE id = $1', [id]);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const [members, accounts, counts, posts30] = await Promise.all([
    many('SELECT u.id, u.name, u.role FROM product_members m JOIN users u ON u.id = m.user_id WHERE m.product_id = $1 ORDER BY u.name', [id]),
    many(
      `SELECT a.id, a.brand, a.username, a.platform, a.profile_url, a.color, a.two_factor_enabled, a.sync_enabled,
         a.last_synced_at, a.sync_error, a.baseline_followers,
         l.date AS last_date, l.followers, l.following, l.posts, l.extra,
         w.followers AS week_ago_followers
       FROM accounts a
       LEFT JOIN LATERAL (SELECT date, followers, following, posts, extra FROM snapshots s WHERE s.account_id = a.id AND s.followers IS NOT NULL ORDER BY date DESC LIMIT 1) l ON TRUE
       LEFT JOIN LATERAL (SELECT followers FROM snapshots s WHERE s.account_id = a.id AND s.followers IS NOT NULL AND s.date <= $2::date - 7 ORDER BY date DESC LIMIT 1) w ON TRUE
       WHERE a.product_id = $1 AND a.archived = FALSE ORDER BY a.id`,
      [id, today()]
    ),
    one(
      `SELECT count(*) FILTER (WHERE status = 'todo') AS todo,
              count(*) FILTER (WHERE status = 'in_progress') AS in_progress,
              count(*) FILTER (WHERE status = 'done') AS done,
              count(*) FILTER (WHERE status IN ('todo','in_progress') AND due_date < $2) AS overdue
       FROM tasks WHERE product_id = $1`,
      [id, today()]
    ),
    one('SELECT count(*) AS n FROM posts WHERE product_id = $1 AND posted_on >= $2', [id, addDays(today(), -29)]),
  ]);
  res.json({ product: await withImage(p), members, accounts, tasks: counts, posts30: posts30.n });
}));

router.put('/:productId(\\d+)', requireRole('admin'), requireProductAccess(), ah(async (req, res) => {
  const b = parse(productSchema.extend({ archived: z.boolean().optional() }), req.body);
  const id = req.productId;
  const before = await many('SELECT user_id FROM product_members WHERE product_id = $1', [id]);
  const p = await tx(async (c) => {
    const { rows } = await c.query(
      'UPDATE products SET name=$2, tagline=$3, description=$4, website_url=$5, color=$6, archived=coalesce($7, archived), category=coalesce($8, category) WHERE id=$1 RETURNING *',
      [id, b.name, b.tagline || null, b.description || null, b.website_url || null, b.color || null, b.archived ?? null, b.category ?? null]
    );
    if (b.member_ids) {
      await c.query('DELETE FROM product_members WHERE product_id = $1', [id]);
      for (const uid of b.member_ids) await c.query('INSERT INTO product_members (product_id, user_id) VALUES ($1,$2)', [id, uid]);
    }
    return rows[0];
  });
  if (b.member_ids) {
    const added = b.member_ids.filter((u) => !before.some((x) => x.user_id === u));
    await notify(added, { kind: 'assigned', title: `You were added to ${p.name}`, link: `/products/${id}`, productId: id }, req.user.id);
  }
  await audit(req, 'product.updated', 'product', id, { name: p.name }, id);
  res.json(p);
}));

router.delete('/:productId(\\d+)', requireRole('admin'), requireProductAccess(), ah(async (req, res) => {
  const p = await one('DELETE FROM products WHERE id = $1 RETURNING name, image_key', [req.productId]);
  if (p?.image_key && storageEnabled) deleteObject(p.image_key).catch(() => {});
  await audit(req, 'product.deleted', 'product', req.productId, { name: p?.name });
  res.json({ ok: true });
}));

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      const e = new Error('Use a PNG, JPG or WebP image.');
      e.status = 400;
      return cb(e);
    }
    cb(null, true);
  },
});

router.post('/:productId(\\d+)/image', requireRole('admin'), requireProductAccess(), imageUpload.single('file'), ah(async (req, res) => {
  if (!storageEnabled) return res.status(503).json({ error: 'Cloud storage is not configured.' });
  if (!req.file) return res.status(400).json({ error: 'Choose an image.' });
  const key = `products/${req.productId}/${crypto.randomUUID()}${path.extname(req.file.originalname).toLowerCase() || '.jpg'}`;
  await putObject(key, req.file.buffer, req.file.mimetype);
  const old = await one('SELECT image_key FROM products WHERE id = $1', [req.productId]);
  await query('UPDATE products SET image_key = $2 WHERE id = $1', [req.productId, key]);
  if (old?.image_key) deleteObject(old.image_key).catch(() => {});
  await audit(req, 'product.image_updated', 'product', req.productId, null, req.productId);
  res.json({ image_url: await signedViewUrl(key) });
}));

/** Activity history: what happened on this product, newest first. */
router.get('/:productId(\\d+)/activity', requireProductAccess(), ah(async (req, res) => {
  const rows = await many(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.product_id = $1 ORDER BY a.created_at DESC LIMIT 200`,
    [req.productId]
  );
  res.json(rows);
}));

export default router;
