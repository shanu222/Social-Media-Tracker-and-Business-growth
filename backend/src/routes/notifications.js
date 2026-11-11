import { Router } from 'express';
import { many, one, query } from '../db.js';
import { ah } from '../util.js';

const router = Router();

router.get('/', ah(async (req, res) => {
  const [items, unread] = await Promise.all([
    many(
      `SELECT n.*, p.name AS product_name FROM notifications n LEFT JOIN products p ON p.id = n.product_id
       WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 40`,
      [req.user.id]
    ),
    one('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]),
  ]);
  res.json({ unread: unread.n, items });
}));

router.post('/read', ah(async (req, res) => {
  const id = Number(req.body?.id) || null;
  await query(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL ${id ? 'AND id = $2' : ''}`,
    id ? [req.user.id, id] : [req.user.id]
  );
  res.json({ ok: true });
}));

export default router;
