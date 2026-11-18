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
import { emailUserResult, noticeEmail } from '../mailer.js';

/*
 * NDA signing. Everyone except admins must sign the current version before using the workspace
 * (enforced by requireNda). The signer and admins can view the full signed letter and PDF;
 * CNIC and signature are stored encrypted.
 */
const router = Router();
const MAX_IMG_BYTES = 3 * 1024 * 1024;

/** Validates a data-URL image (PNG/JPG) and returns { buf, type } or throws a 400 with `label` in the message. */
function image(dataUrl, label, minBytes = 2000) {
  const fail = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
  const m = /^data:(image\/(png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) fail(`Upload ${label} as a PNG or JPG image.`);
  const buf = Buffer.from(m[3], 'base64');
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!(isPng || isJpg)) fail(`${label[0].toUpperCase()}${label.slice(1)} must be a PNG or JPG image.`);
  if (buf.length < minBytes) fail(`${label[0].toUpperCase()}${label.slice(1)} looks empty or too small. Please upload a clear image.`);
  if (buf.length > MAX_IMG_BYTES) fail(`${label[0].toUpperCase()}${label.slice(1)} is too large (max 3 MB).`);
  return { buf, type: isPng ? 'image/png' : 'image/jpeg' };
}
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Pakistani mobile: 03XXXXXXXXX or +923XXXXXXXXX -> +92 3XX XXXXXXX */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+92')) d = '0' + d.slice(3);
  else if (d.startsWith('92') && d.length === 12) d = '0' + d.slice(2);
  if (!/^03\d{9}$/.test(d)) return null;
  return `+92 ${d.slice(1, 4)} ${d.slice(4)}`;
}

export const ndaRequiredFor = (user) => user.role !== 'admin' && !user.nda_signed;

/** Express middleware for every API route except /api/auth and /api/nda. */
export function requireNda(req, res, next) {
  if (req.user && ndaRequiredFor(req.user)) {
    return res.status(403).json({ error: 'Please sign the confidentiality agreement to continue.', code: 'NDA_REQUIRED' });
  }
  next();
}

async function signedFor(userId) {
  return one('SELECT * FROM nda_signatures WHERE user_id = $1 AND version = $2 AND superseded_at IS NULL', [userId, NDA_VERSION]);
}

/** Full view of a signature: decrypted CNIC, contact details and images as data URLs. */
function present(sig) {
  const cnic = decrypt(sig.cnic_enc);
  const url = (enc, type) => (enc ? `data:${type};base64,${decryptBuffer(enc).toString('base64')}` : null);
  return {
    id: sig.id, user_id: sig.user_id, version: sig.version, full_name: sig.full_name, guardian: sig.guardian, role_title: sig.role_title,
    cnic, typed_name: sig.typed_name, phone: sig.phone, address: decrypt(sig.address_enc),
    signed_at: sig.signed_at, ip: sig.ip, doc_hash: sig.doc_hash,
    signature: url(sig.signature_enc, sig.signature_type),
    cnic_front: url(sig.cnic_front_enc, sig.cnic_front_type),
    cnic_back: url(sig.cnic_back_enc, sig.cnic_back_type),
    sections: ndaSections({ name: sig.full_name + (sig.guardian ? ` (${sig.guardian})` : ''), cnic, role: sig.role_title || 'Team Member' }),
  };
}

/** The agreement to read (filled with the person's name and role), and their signature if signed. */
router.get('/', ah(async (req, res) => {
  const u = await one('SELECT name, title, role FROM users WHERE id = $1', [req.user.id]);
  const sig = await signedFor(req.user.id);
  // If the admin asked them to sign again, show why and pre-fill the earlier text details
  const prev = sig ? null : await one('SELECT * FROM nda_signatures WHERE user_id = $1 AND superseded_at IS NOT NULL ORDER BY superseded_at DESC LIMIT 1', [req.user.id]);
  res.json({
    version: NDA_VERSION, title: NDA_TITLE, required: req.user.role !== 'admin',
    signed: Boolean(sig),
    resign: prev ? { at: prev.superseded_at, reason: prev.reset_reason } : null,
    prefill: {
      full_name: prev?.full_name || u.name,
      guardian: prev?.guardian || '',
      cnic: prev ? decrypt(prev.cnic_enc) : '',
      phone: prev?.phone ? `0${prev.phone.replace(/\D/g, '').slice(2)}` : '',
      address: prev ? decrypt(prev.address_enc) || '' : '',
      role_title: u.title || (u.role === 'manager' ? 'Social Media Manager' : 'Team Member'),
    },
    sections: ndaSections({ name: u.name, cnic: '_____-_______-_', role: u.title || 'Team Member' }),
    signature: sig ? present(sig) : null,
  });
}));

router.post('/sign', ah(async (req, res) => {
  const b = parse(z.object({
    full_name: z.string().trim().min(3, 'Enter your full name as on your CNIC').max(120),
    guardian: z.string().trim().max(120).optional(),
    cnic: z.string().trim().min(13, 'Enter your 13-digit CNIC').max(20),
    phone: z.string().trim().min(10, 'Enter your mobile number').max(20),
    address: z.string().trim().min(10, 'Enter your full home address').max(400),
    typed_name: z.string().trim().min(3, 'Type your full name to sign').max(120),
    signature: z.string().max(6_000_000),
    cnic_front: z.string().max(6_000_000),
    cnic_back: z.string().max(6_000_000),
    agree: z.literal(true, { errorMap: () => ({ message: 'Tick the box to confirm you agree' }) }),
  }), req.body);
  if (await signedFor(req.user.id)) return res.status(409).json({ error: 'You have already signed this agreement.' });
  const cnic = normalizeCnic(b.cnic);
  if (!cnic) return res.status(400).json({ error: 'CNIC must have 13 digits, e.g. 12345-1234567-1.' });
  const phone = normalizePhone(b.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a Pakistani mobile number, e.g. 0300 1234567.' });
  if (norm(b.typed_name) !== norm(b.full_name)) return res.status(400).json({ error: 'The typed name must match your full name exactly.' });
  const sigImg = image(b.signature, 'your signature', 800);
  const front = image(b.cnic_front, 'the front of your CNIC', 8000);
  const back = image(b.cnic_back, 'the back of your CNIC', 8000);
  if (front.buf.equals(back.buf)) return res.status(400).json({ error: 'Upload two different images: the front and the back of your CNIC.' });

  const u = await one('SELECT title, role FROM users WHERE id = $1', [req.user.id]);
  const role = u.title || (u.role === 'manager' ? 'Social Media Manager' : 'Team Member');
  const name = b.full_name + (b.guardian ? ` (${b.guardian})` : '');
  const sig = await one(
    `INSERT INTO nda_signatures (user_id, version, full_name, guardian, role_title, cnic_enc, cnic_masked, signature_enc, signature_type, doc_hash, ip, user_agent,
       typed_name, phone, address_enc, cnic_front_enc, cnic_front_type, cnic_back_enc, cnic_back_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [req.user.id, NDA_VERSION, b.full_name, b.guardian || null, role, encrypt(cnic), maskCnic(cnic), encryptBuffer(sigImg.buf), sigImg.type,
      ndaHash({ name, cnic, role }), req.ip, String(req.headers['user-agent'] || '').slice(0, 300),
      b.typed_name, phone, encrypt(b.address), encryptBuffer(front.buf), front.type, encryptBuffer(back.buf), back.type]
  );
  await audit(req, 'nda.signed', 'user', req.user.id, { version: NDA_VERSION });
  const admins = (await many("SELECT id FROM users WHERE role = 'admin' AND active = TRUE AND deleted_at IS NULL")).map((r) => r.id);
  await notify(admins, { kind: 'nda', title: `${b.full_name} signed the confidentiality agreement`, link: '/settings' }, req.user.id);

  // Email the signed PDF to the signer and to the admins (each keeps a copy)
  emailCopies(sig, admins).catch((e) => console.error('[nda] email copies failed', e.message));
  res.status(201).json(present(sig));
}));

async function emailCopies(sig, adminIds) {
  const full = present(sig);
  const pdf = await renderNdaPdf(pdfData(sig, full), decryptBuffer(sig.signature_enc));
  const filename = `NDA-${sig.full_name.replace(/[^\w]+/g, '-')}-${new Date(sig.signed_at).toISOString().slice(0, 10)}.pdf`;
  const attachments = [{ filename, content: pdf }];
  const signedOn = new Date(sig.signed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  await emailUserResult(sig.user_id, {
    kind: 'nda', subject: 'Your signed confidentiality agreement', attachments,
    ...noticeEmail({ heading: 'Agreement signed', intro: `Thank you, ${sig.full_name.split(' ')[0]}. Your signed ${NDA_TITLE} is attached for your records.`, rows: [['Signed', signedOn], ['Version', NDA_VERSION]], link: '/settings', button: 'Open Growth Desk' }),
  }, { important: true, ref: `nda:${sig.id}` });
  for (const a of adminIds) {
    await emailUserResult(a, {
      kind: 'nda', subject: `${sig.full_name} signed the confidentiality agreement`, attachments,
      ...noticeEmail({ heading: 'NDA signed', intro: `${sig.full_name} (${sig.role_title}) signed the ${NDA_TITLE}. The signed copy is attached.`, rows: [['CNIC', sig.cnic_masked], ['Mobile', sig.phone], ['Signed', signedOn]], link: '/settings', button: 'View in Team' }),
    }, { important: true, ref: `nda:${sig.id}` });
  }
}

const pdfData = (sig, full) => ({ ...sig, cnic: full.cnic, address: full.address, cnicFront: sig.cnic_front_enc ? decryptBuffer(sig.cnic_front_enc) : null, cnicBack: sig.cnic_back_enc ? decryptBuffer(sig.cnic_back_enc) : null });

async function sendPdf(res, sig) {
  const pdf = await renderNdaPdf(pdfData(sig, present(sig)), decryptBuffer(sig.signature_enc));
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
    `SELECT u.id AS user_id, u.name, u.role, s.id, s.full_name, s.cnic_masked, s.signed_at, s.version,
       (SELECT json_build_object('at', p.superseded_at, 'reason', p.reset_reason) FROM nda_signatures p
         WHERE p.user_id = u.id AND p.superseded_at IS NOT NULL ORDER BY p.superseded_at DESC LIMIT 1) AS resign
     FROM users u LEFT JOIN nda_signatures s ON s.user_id = u.id AND s.version = $1 AND s.superseded_at IS NULL
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

/**
 * Admin: ask someone to sign again (e.g. details were wrong). Their current signature is kept as history,
 * they are stopped at the NDA on their next request (within seconds if they are using the app),
 * and they get a notification and an email with the reason.
 */
router.post('/user/:userId(\\d+)/reset', requireRole('admin'), ah(async (req, res) => {
  const userId = Number(req.params.userId);
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body || {});
  const r = await query(
    'UPDATE nda_signatures SET superseded_at = now(), reset_reason = $3 WHERE user_id = $1 AND version = $2 AND superseded_at IS NULL',
    [userId, NDA_VERSION, reason || null]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'This person has no signed agreement to redo.' });
  await audit(req, 'nda.reset', 'user', userId, { reason: reason || null });
  await notify([userId], { kind: 'nda', title: 'Please sign the confidentiality agreement again', body: reason || null, link: '/' }, req.user.id);
  emailUserResult(userId, {
    kind: 'nda', subject: 'Please sign the confidentiality agreement again',
    ...noticeEmail({
      heading: 'Sign the agreement again',
      intro: `${req.user.name} asked you to sign the ${NDA_TITLE} again. You will see it the next time you open Growth Desk; your earlier details are filled in so you only need to correct what was wrong.`,
      rows: reason ? [['Reason', reason]] : [], link: '/', button: 'Open Growth Desk',
    }),
  }, { important: true, ref: `nda-reset:${userId}` }).catch(() => {});
  res.json({ ok: true });
}));

export default router;
