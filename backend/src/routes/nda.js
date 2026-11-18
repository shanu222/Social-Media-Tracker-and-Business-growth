import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { encrypt, decrypt, encryptBuffer, decryptBuffer } from '../crypto.js';
import { ah, parse } from '../util.js';
import { NDA_TITLE, NDA_VERSION, ndaSections, ndaHash, normalizeCnic, maskCnic } from '../services/nda.js';
import { renderNdaPdf } from '../services/ndaPdf.js';
import { notify } from '../notify.js';

/*
 * NDA signing. Everyone except admins must sign the current version before using the workspace
 * (enforced by requireNda). The signer and admins can view the full signed letter and PDF;
 * CNIC and signature are stored encrypted.
 */
const router = Router();
const MAX_SIG_BYTES = 600 * 1024;

export const ndaRequiredFor = (user) => user.role !== 'admin' && !user.nda_signed;

/** Express middleware for every API route except /api/auth and /api/nda. */
export function requireNda(req, res, next) {
  if (req.user && ndaRequiredFor(req.user)) {
    return res.status(403).json({ error: 'Please sign the confidentiality agreement to continue.', code: 'NDA_REQUIRED' });
  }
  next();
}

async function signedFor(userId) {
  return one('SELECT * FROM nda_signatures WHERE user_id = $1 AND version = $2', [userId, NDA_VERSION]);
}

/** Full view of a signature: decrypted CNIC and signature image as a data URL. */
function present(sig) {
  const buf = decryptBuffer(sig.signature_enc);
  const cnic = decrypt(sig.cnic_enc);
  return {
    id: sig.id, user_id: sig.user_id, version: sig.version, full_name: sig.full_name, guardian: sig.guardian, role_title: sig.role_title,
    cnic, signed_at: sig.signed_at, ip: sig.ip, doc_hash: sig.doc_hash,
    signature: `data:${sig.signature_type};base64,${buf.toString('base64')}`,
    sections: ndaSections({ name: sig.full_name + (sig.guardian ? ` (${sig.guardian})` : ''), cnic, role: sig.role_title || 'Team Member' }),
  };
}

/** The agreement to read (filled with the person's name and role), and their signature if signed. */
router.get('/', ah(async (req, res) => {
  const u = await one('SELECT name, title, role FROM users WHERE id = $1', [req.user.id]);
  const sig = await signedFor(req.user.id);
  res.json({
    version: NDA_VERSION, title: NDA_TITLE, required: req.user.role !== 'admin',
    signed: Boolean(sig),
    prefill: { full_name: u.name, role_title: u.title || (u.role === 'manager' ? 'Social Media Manager' : 'Team Member') },
    sections: ndaSections({ name: u.name, cnic: '_____-_______-_', role: u.title || 'Team Member' }),
    signature: sig ? present(sig) : null,
  });
}));

router.post('/sign', ah(async (req, res) => {
  const b = parse(z.object({
    full_name: z.string().trim().min(3, 'Enter your full name as on your CNIC').max(120),
    guardian: z.string().trim().max(120).optional(),
    cnic: z.string().trim().min(13, 'Enter your 13-digit CNIC').max(20),
    signature: z.string().max(1_000_000),
    agree: z.literal(true, { errorMap: () => ({ message: 'Tick the box to confirm you agree' }) }),
  }), req.body);
  if (await signedFor(req.user.id)) return res.status(409).json({ error: 'You have already signed this agreement.' });
  const cnic = normalizeCnic(b.cnic);
  if (!cnic) return res.status(400).json({ error: 'CNIC must have 13 digits, e.g. 12345-1234567-1.' });
  const m = /^data:(image\/(png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(b.signature);
  if (!m) return res.status(400).json({ error: 'Add your signature as a PNG or JPG image.' });
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length < 300) return res.status(400).json({ error: 'The signature looks empty. Please sign again.' });
  if (buf.length > MAX_SIG_BYTES) return res.status(400).json({ error: 'The signature image is too large (max 600 KB).' });
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!(isPng || isJpg)) return res.status(400).json({ error: 'The signature must be a PNG or JPG image.' });

  const u = await one('SELECT title, role FROM users WHERE id = $1', [req.user.id]);
  const role = u.title || (u.role === 'manager' ? 'Social Media Manager' : 'Team Member');
  const name = b.full_name + (b.guardian ? ` (${b.guardian})` : '');
  const sig = await one(
    `INSERT INTO nda_signatures (user_id, version, full_name, guardian, role_title, cnic_enc, cnic_masked, signature_enc, signature_type, doc_hash, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.user.id, NDA_VERSION, b.full_name, b.guardian || null, role, encrypt(cnic), maskCnic(cnic), encryptBuffer(buf),
      isPng ? 'image/png' : 'image/jpeg', ndaHash({ name, cnic, role }), req.ip, String(req.headers['user-agent'] || '').slice(0, 300)]
  );
  await audit(req, 'nda.signed', 'user', req.user.id, { version: NDA_VERSION });
  const admins = (await many("SELECT id FROM users WHERE role = 'admin' AND active = TRUE AND deleted_at IS NULL")).map((r) => r.id);
  await notify(admins, { kind: 'nda', title: `${b.full_name} signed the confidentiality agreement`, link: '/settings?tab=team' }, req.user.id);
  res.status(201).json(present(sig));
}));

async function sendPdf(res, sig) {
  const full = present(sig);
  const pdf = await renderNdaPdf({ ...sig, cnic: full.cnic }, decryptBuffer(sig.signature_enc));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="NDA-${sig.full_name.replace(/[^\w]+/g, '-')}-${sig.signed_at.toISOString().slice(0, 10)}.pdf"`);
  res.send(pdf);
}

router.get('/pdf', ah(async (req, res) => {
  const sig = await signedFor(req.user.id);
  if (!sig) return res.status(404).json({ error: 'You have not signed the agreement yet.' });
  await sendPdf(res, sig);
}));

/* ---------- Admin ---------- */

router.get('/signatures', requireRole('admin'), ah(async (_req, res) => {
  res.json(await many(
    `SELECT u.id AS user_id, u.name, u.role, s.id, s.full_name, s.cnic_masked, s.signed_at, s.version
     FROM users u LEFT JOIN nda_signatures s ON s.user_id = u.id AND s.version = $1
     WHERE u.deleted_at IS NULL ORDER BY u.name`, [NDA_VERSION]
  ));
}));

router.get('/user/:userId(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const sig = await signedFor(Number(req.params.userId));
  if (!sig) return res.status(404).json({ error: 'Not signed yet.' });
  await audit(req, 'nda.viewed', 'user', req.params.userId);
  res.json(present(sig));
}));

router.get('/user/:userId(\\d+)/pdf', requireRole('admin'), ah(async (req, res) => {
  const sig = await signedFor(Number(req.params.userId));
  if (!sig) return res.status(404).json({ error: 'Not signed yet.' });
  await audit(req, 'nda.downloaded', 'user', req.params.userId);
  await sendPdf(res, sig);
}));

/** Admin: ask someone to sign again (e.g. details were wrong). Their old signature is removed. */
router.post('/user/:userId(\\d+)/reset', requireRole('admin'), ah(async (req, res) => {
  await query('DELETE FROM nda_signatures WHERE user_id = $1 AND version = $2', [Number(req.params.userId), NDA_VERSION]);
  await audit(req, 'nda.reset', 'user', req.params.userId);
  res.json({ ok: true });
}));

export default router;
