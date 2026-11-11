import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { requireRole } from '../auth.js';
import { requireProductAccess } from '../access.js';
import { notify, productAudience } from '../notify.js';
import { ah, parse } from '../util.js';

/* Product-specific chat between the Admin and the Social Media Manager. */
const router = Router({ mergeParams: true });
router.use(requireProductAccess());

/** ?after=<id> returns only newer messages (used for polling). Marks the chat as read. */
router.get('/', ah(async (req, res) => {
  const after = Number(req.query.after) || 0;
  const rows = await many(
    `SELECT m.id, m.body, m.created_at, m.task_id, m.user_id, u.name AS user_name, u.role AS user_role, t.title AS task_title
     FROM messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN tasks t ON t.id = m.task_id
     WHERE m.product_id = $1 AND m.id > $2 ORDER BY m.id ${after ? 'ASC LIMIT 200' : 'DESC LIMIT 200'}`,
    [req.productId, after]
  );
  const list = after ? rows : rows.reverse();
  const last = list.at(-1)?.id;
  if (last) {
    await query(
      `INSERT INTO chat_reads (user_id, product_id, last_read_id) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, product_id) DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id)`,
      [req.user.id, req.productId, last]
    );
    // chat notifications for this product are now seen
    await query(
      "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND product_id = $2 AND kind = 'chat' AND read_at IS NULL",
      [req.user.id, req.productId]
    );
  }
  res.json(list);
}));

router.post('/', requireRole('manager'), ah(async (req, res) => {
  const b = parse(z.object({
    body: z.string().trim().min(1, 'Write a message first').max(4000),
    task_id: z.number().int().positive().nullish(),
  }), req.body);
  if (b.task_id) {
    const t = await one('SELECT 1 FROM tasks WHERE id = $1 AND product_id = $2', [b.task_id, req.productId]);
    if (!t) return res.status(400).json({ error: 'That task belongs to another product.' });
  }
  const m = await one(
    'INSERT INTO messages (product_id, task_id, user_id, body) VALUES ($1,$2,$3,$4) RETURNING id, body, created_at, task_id, user_id',
    [req.productId, b.task_id ?? null, req.user.id, b.body]
  );
  await query(
    `INSERT INTO chat_reads (user_id, product_id, last_read_id) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, product_id) DO UPDATE SET last_read_id = EXCLUDED.last_read_id`,
    [req.user.id, req.productId, m.id]
  );
  const product = await one('SELECT name FROM products WHERE id = $1', [req.productId]);
  // one unread chat notification per product per person is enough
  const audience = (await productAudience(req.productId)).filter((u) => u !== req.user.id);
  const already = await many(
    "SELECT user_id FROM notifications WHERE product_id = $1 AND kind = 'chat' AND read_at IS NULL AND user_id = ANY($2)",
    [req.productId, audience]
  );
  await notify(audience.filter((u) => !already.some((a) => a.user_id === u)), {
    kind: 'chat', title: `${req.user.name} on ${product.name}`, body: b.body,
    link: `/products/${req.productId}?tab=chat`, productId: req.productId,
  }, req.user.id);
  res.status(201).json({ ...m, user_name: req.user.name, user_role: req.user.role });
}));

export default router;
