/*
 * Public links for letters and certificates.
 * Set CREDENTIALS_URL to a professional address that points at this API service, for example
 * https://credentials.sustainablesolution360.com (Railway → service → Settings → Networking → Custom domain).
 * Without it, links use this service's own address. Links never expire: the code is stored permanently,
 * and old links keep working on any address that reaches this service.
 */
export function credentialsBase(req) {
  const env = String(process.env.CREDENTIALS_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^/\s]+/i.test(env)) return env;
  return `${req.protocol}://${req.get('host')}`;
}
export const credentialUrl = (req, code) => `${credentialsBase(req)}/verify/${code}`;
