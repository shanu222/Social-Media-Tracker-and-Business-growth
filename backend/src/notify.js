import { many, query } from './db.js';

/**
 * In-app notifications. `to` is a list of user ids; the acting user is skipped.
 */
export async function notify(to, { kind, title, body = null, link = null, productId = null }, actorId = null) {
  const ids = [...new Set(to.filter((id) => id && id !== actorId))];
  for (const id of ids) {
    await query(
      'INSERT INTO notifications (user_id, kind, title, body, link, product_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, kind, title, body ? String(body).slice(0, 300) : null, link, productId]
    ).catch((e) => console.error('[notify]', e.message));
  }
}

/** Everyone who works on a product: admins + assigned members. */
export async function productAudience(productId) {
  const rows = await many(
    `SELECT id FROM users WHERE active = TRUE AND role = 'admin'
     UNION SELECT u.id FROM product_members m JOIN users u ON u.id = m.user_id
     WHERE m.product_id = $1 AND u.active = TRUE`,
    [productId]
  );
  return rows.map((r) => r.id);
}

export async function adminIds() {
  return (await many("SELECT id FROM users WHERE active = TRUE AND role = 'admin'")).map((r) => r.id);
}
