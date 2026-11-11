import crypto from 'node:crypto';
import { config } from './config.js';

const KEY = Buffer.from(config.encryptionKey, 'hex');
if (KEY.length !== 32) {
  console.error('[crypto] ENCRYPTION_KEY must be 64 hex characters (32 bytes). Run: npm run gen:secrets');
  process.exit(1);
}

/** Encrypt a string with AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(payload) {
  if (!payload) return null;
  try {
    const [v, iv, tag, ct] = payload.split('.');
    if (v !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Encrypt a Buffer (used for cloud backups). */
export function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([Buffer.from('SMTB1'), iv, cipher.getAuthTag(), ct]);
}

export function decryptBuffer(buf) {
  if (buf.subarray(0, 5).toString() !== 'SMTB1') throw new Error('Not an encrypted backup');
  const iv = buf.subarray(5, 17);
  const tag = buf.subarray(17, 33);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(33)), decipher.final()]);
}
