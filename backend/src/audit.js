import { query } from './db.js';

export async function audit(req, action, entity = null, entityId = null, detail = null) {
  try {
    await query(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [req?.user?.id ?? null, action, entity, entityId == null ? null : String(entityId), detail, req?.ip ?? null]
    );
  } catch (e) {
    console.error('[audit] failed', e.message);
  }
}
