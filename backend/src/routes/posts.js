import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { requireProductAccess } from '../access.js';
import { notify, productAudience } from '../notify.js';
import { ah, parse, zDate, today, addDays } from '../util.js';
import { PLATFORMS } from './accounts.js';

/* Published-post log: every piece of content that went live, with its link. */
const router = Router({ mergeParams: true });
router.use(requireProductAccess());

router.get('/', ah(async (req, res) => {
  res.json(
    await many(
      `SELECT x.*, u.name AS created_by_name, a.brand AS account_brand, a.username AS account_username, t.title AS task_title
       FROM posts x LEFT JOIN users u ON u.id = x.created_by LEFT JOIN accounts a ON a.id = x.account_id
       LEFT JOIN tasks t ON t.id = x.task_id
       WHERE x.product_id = $1 ORDER BY x.posted_on DESC, x.id DESC LIMIT 500`,
      [req.productId]
    )
  );
}));

const schema = z.object({
  platform: z.enum(PLATFORMS),
  account_id: z.number().int().positive().nullish(),
  task_id: z.number().int().positive().nullish(),
  url: z.string().trim().url().max(1000).or(z.literal('')).nullish(),
  note: z.string().max(2000).nullish(),
  posted_on: zDate.optional(),
});

router.post('/', requireRole('manager'), ah(async (req, res) => {
  const b = parse(schema, req.body);
  if (b.url && !/^https?:\/\//i.test(b.url)) return res.status(400).json({ error: 'Links must start with http:// or https://' });
  const postedOn = b.posted_on || today();
  if (postedOn > addDays(today(), 1)) return res.status(400).json({ error: 'The post date cannot be in the future.' });
  if (b.task_id) {
    const t = await one('SELECT 1 FROM tasks WHERE id = $1 AND product_id = $2', [b.task_id, req.productId]);
    if (!t) return res.status(400).json({ error: 'That task belongs to another product.' });
  }
  if (b.account_id) {
    const a = await one('SELECT 1 FROM accounts WHERE id = $1 AND product_id = $2', [b.account_id, req.productId]);
    if (!a) return res.status(400).json({ error: 'That account belongs to another product.' });
  }
  const p = await one(
    `INSERT INTO posts (product_id, task_id, account_id, platform, url, note, posted_on, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.productId, b.task_id ?? null, b.account_id ?? null, b.platform, b.url || null, b.note || null, postedOn, req.user.id]
  );
  const product = await one('SELECT name FROM products WHERE id = $1', [req.productId]);
  await notify(await productAudience(req.productId), {
    kind: 'post', title: `New ${b.platform} post for ${product.name}`, body: b.note || b.url,
    link: `/products/${req.productId}?tab=published`, productId: req.productId,
  }, req.user.id);
  await audit(req, 'post.recorded', 'post', p.id, { platform: p.platform, url: p.url }, req.productId);
  res.status(201).json(p);
}));

router.delete('/:postId(\\d+)', requireRole('manager'), ah(async (req, res) => {
  const p = await one('SELECT * FROM posts WHERE id = $1 AND product_id = $2', [Number(req.params.postId), req.productId]);
  if (!p) return res.status(404).json({ error: 'Post not found.' });
  if (req.user.role !== 'admin' && p.created_by !== req.user.id) return res.status(403).json({ error: 'You can only remove posts you recorded.' });
  await one('DELETE FROM posts WHERE id = $1 RETURNING id', [p.id]);
  await audit(req, 'post.deleted', 'post', p.id, { platform: p.platform }, req.productId);
  res.json({ ok: true });
}));

export default router;
