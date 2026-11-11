import { one, many } from './db.js';

/** Admins see every product; other users only the products they are assigned to. */
export async function canAccessProduct(user, productId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const row = await one('SELECT 1 FROM product_members WHERE product_id = $1 AND user_id = $2', [productId, user.id]);
  return Boolean(row);
}

export async function productIdsFor(user) {
  if (user.role === 'admin') {
    return (await many('SELECT id FROM products')).map((r) => r.id);
  }
  return (await many('SELECT product_id FROM product_members WHERE user_id = $1', [user.id])).map((r) => r.product_id);
}

/** Express middleware: checks access to req.params.productId (or :id). */
export function requireProductAccess(param = 'productId') {
  return async (req, res, next) => {
    try {
      const id = Number(req.params[param]);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid product.' });
      if (!(await canAccessProduct(req.user, id))) {
        return res.status(404).json({ error: 'Product not found or not assigned to you.' });
      }
      req.productId = id;
      next();
    } catch (e) {
      next(e);
    }
  };
}
