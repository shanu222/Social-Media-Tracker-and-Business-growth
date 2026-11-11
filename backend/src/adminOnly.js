/*
 * Account security status (2FA) is for admins only. For everyone else these fields and
 * alerts are removed from every API response and from PDFs, so they never reach the browser.
 */
const SECRET_KEYS = new Set(['two_factor_enabled', 'two_factor_coverage']);
const SECURITY_TEXT = /\b2FA\b|two-factor/i;

export function stripSecurity(value) {
  if (Array.isArray(value)) {
    return value
      .filter((v) => !(v && typeof v === 'object' && typeof v.text === 'string' && SECURITY_TEXT.test(v.text)))
      .map(stripSecurity);
  }
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_KEYS.has(k)) out[k] = stripSecurity(v);
    return out;
  }
  return value;
}

/** Express middleware: wraps res.json for non-admin users. */
export function hideSecurityFromNonAdmins(req, res, next) {
  if (req.user && req.user.role !== 'admin') {
    const json = res.json.bind(res);
    res.json = (body) => json(stripSecurity(body));
  }
  next();
}
