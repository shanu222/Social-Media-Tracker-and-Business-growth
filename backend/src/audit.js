import { query } from './db.js';

export async function audit(req, action, entity = null, entityId = null, detail = null, productId = null) {
  try {
    await query(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, detail, ip, product_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        req?.user?.id ?? null,
        action,
        entity,
        entityId == null ? null : String(entityId),
        detail,
        req?.ip ?? null,
        productId,
      ]
    );
  } catch (e) {
    console.error('[audit] failed', e.message);
  }
}
