import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { decryptBuffer } from '../crypto.js';
import { ah, parse, zDate } from '../util.js';
import { NDA_VERSION } from '../services/nda.js';
import { notify } from '../notify.js';
import { emailUserResult, noticeEmail } from '../mailer.js';
import {
  INTERN_COLS, cleanSignature, getCompanySignature, setCompanySignature, removeCompanySignature, pngDataUrl,
  nextRef, verifyCode, letterTerms, intro, longDate, todayPk, durationText, roleTitle, certEligibility, CERT_MIN_SCORE,
} from '../services/letters.js';
import { credentialsBase, credentialUrl } from '../services/credentialLinks.js';
import { renderJoiningLetter, renderCertificate } from '../services/letterPdf.js';

/*
 * Joining letters and internship certificates.
 * Everything here sits behind requireNda, so a team member can only reach it after signing the NDA.
 * The member's NDA signature is placed on the joining letter once they accept it; the CEO's
 * signature (uploaded once by the admin) goes on every letter and certificate.
 */
const router = Router();

const activeNda = (userId) => one(
  'SELECT id, full_name, signed_at, signature_enc FROM nda_signatures WHERE user_id = $1 AND version = $2 AND superseded_at IS NULL',
  [userId, NDA_VERSION]
);
const latestNda = (userId) => one(
  'SELECT id, full_name, signed_at, signature_enc FROM nda_signatures WHERE user_id = $1 ORDER BY (superseded_at IS NULL) DESC, signed_at DESC LIMIT 1',
  [userId]
);
const internFor = (userId) => one(`SELECT ${INTERN_COLS} FROM internships i WHERE i.user_id = $1`, [userId]);
const safeName = (s) => s.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

function fail(status, msg, code) { const e = new Error(msg); e.status = status; if (code) e.code = code; throw e; }

/** Name to print: the legal name from the NDA (as on CNIC), else the account name. */
async function printName(userId) {
  const n = await latestNda(userId);
  if (n) return n.full_name;
  return (await one('SELECT name FROM users WHERE id = $1', [userId]))?.name || 'Team Member';
}

async function letterPdf(i, req) {
  const ceo = await getCompanySignature();
  if (!ceo) fail(409, 'The CEO signature has not been added yet, so letters cannot be issued. The admin can add it under Letters & certificates.', 'NO_CEO_SIGNATURE');
  // The signature that was on file when they accepted; if that copy was replaced since, use their current one
  const accepted = i.accepted_at
    ? (i.accepted_nda_id && await one('SELECT full_name, signed_at, signature_enc FROM nda_signatures WHERE id = $1', [i.accepted_nda_id])) || await latestNda(i.user_id)
    : null;
  const nda = accepted || await latestNda(i.user_id);
  return renderJoiningLetter({
    intern: i, name: nda?.full_name || await printName(i.user_id), ndaSignedAt: nda?.signed_at || null,
    ceoSig: ceo.png, memberSig: accepted ? await cleanSignature(decryptBuffer(accepted.signature_enc)) : null,
    acceptedAt: i.accepted_at, verifyUrl: credentialUrl(req, i.letter_code),
  });
}

async function certificatePdf(i, req) {
  if (!i.cert_ref) fail(404, 'The certificate has not been issued yet.');
  if (i.cert_revoked_at) fail(410, 'This certificate has been withdrawn.');
  const ceo = await getCompanySignature();
  if (!ceo) fail(409, 'The CEO signature has not been added yet, so certificates cannot be issued.', 'NO_CEO_SIGNATURE');
  return renderCertificate({ intern: i, name: await printName(i.user_id), ceoSig: ceo.png, verifyUrl: credentialUrl(req, i.cert_code) });
}

function sendPdf(res, buf, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
}

/** Public links and share details for a document the person can show to others. */
function shareInfo(req, i, kind, name) {
  const cert = kind === 'certificate';
  const url = credentialUrl(req, cert ? i.cert_code : i.letter_code);
  const issued = cert ? i.cert_issued_on : i.letter_date;
  return {
    url, image: `${url}/image.png`, code: cert ? i.cert_code : i.letter_code, ref: cert ? i.cert_ref : i.letter_ref,
    title: cert ? 'Internship Completion Certificate' : `${roleTitle(i.role)} — Joining Letter`,
    text: cert
      ? `I'm happy to share that I've completed my ${roleTitle(i.role)}ship at Resilience Technologies Labs (RTL). Verified certificate:`
      : `I'm excited to share that I've joined Resilience Technologies Labs (RTL) as a ${roleTitle(i.role)}. Verified joining letter:`,
    issue_year: Number(issued.slice(0, 4)), issue_month: Number(issued.slice(5, 7)), name,
  };
}

/** What the member (or admin preview) sees on screen. */
function view(i, { ndaSignedAt, name, req, eligibility }) {
  if (!i) return null;
  return {
    eligibility,
    share: {
      letter: i.accepted_at ? shareInfo(req, i, 'letter', name) : null,
      certificate: i.cert_ref && !i.cert_revoked_at ? shareInfo(req, i, 'certificate', name) : null,
    },
    letter: {
      ref: i.letter_ref, date: i.letter_date, role: roleTitle(i.role), start_date: i.start_date, end_date: i.end_date,
      duration: durationText(i.start_date, i.end_date), supervisor: [i.supervisor_name, i.supervisor_title].filter(Boolean).join(', '),
      accepted_at: i.accepted_at, intro: intro(i), terms: letterTerms(i, ndaSignedAt), name,
    },
    certificate: i.cert_ref ? { ref: i.cert_ref, issued_on: i.cert_issued_on, completed_on: i.cert_completed_on, revoked: !!i.cert_revoked_at } : null,
  };
}

/* ---------------- Team member ---------------- */

router.get('/mine', ah(async (req, res) => {
  const [i, nda, ceo] = await Promise.all([internFor(req.user.id), activeNda(req.user.id), getCompanySignature()]);
  res.json({
    nda: nda ? { signed_at: nda.signed_at } : null,
    ceo_signature_ready: !!ceo,
    internship: view(i, {
      ndaSignedAt: nda?.signed_at, name: nda?.full_name || req.user.name, req,
      eligibility: i && !i.cert_ref ? await certEligibility(i) : null,
    }),
    min_score: CERT_MIN_SCORE,
  });
}));

/** The intern claims their certificate once eligible (85%+ every month, internship ended). */
router.post('/mine/certificate/claim', ah(async (req, res) => {
  const i = await internFor(req.user.id);
  if (!i) return res.status(404).json({ error: 'No internship record found.' });
  if (!await activeNda(req.user.id)) return res.status(403).json({ error: 'Please sign the NDA first.', code: 'NDA_REQUIRED' });
  if (!i.accepted_at) return res.status(409).json({ error: 'Accept your joining letter first.' });
  if (!i.cert_ref) {
    const el = await certEligibility(i);
    if (!el.eligible) return res.status(409).json({ error: `Your certificate is not available yet. ${el.reason}` });
    await issueCertificate(req, i, null);
  }
  res.json(await internFor(req.user.id));
}));

router.post('/mine/accept', ah(async (req, res) => {
  const i = await internFor(req.user.id);
  if (!i) return res.status(404).json({ error: 'Your joining letter has not been prepared yet.' });
  const nda = await activeNda(req.user.id);
  if (!nda) return res.status(403).json({ error: 'Please sign the NDA first.', code: 'NDA_REQUIRED' });
  if (!i.accepted_at) {
    await query('UPDATE internships SET accepted_at = now(), accepted_ip = $2, accepted_nda_id = $3, updated_at = now() WHERE id = $1', [i.id, req.ip, nda.id]);
    await audit(req, 'letter.accepted', 'user', req.user.id, { ref: i.letter_ref });
    const admins = await many("SELECT id FROM users WHERE role = 'admin' AND active AND deleted_at IS NULL");
    await notify(admins.map((a) => a.id), { kind: 'letter', title: `${req.user.name} accepted their joining letter`, body: i.letter_ref, link: '/letters' }, req.user.id);
  }
  res.json({ ok: true, accepted_at: (await internFor(req.user.id)).accepted_at });
}));

router.get('/mine/letter.pdf', ah(async (req, res) => {
  const i = await internFor(req.user.id);
  if (!i) return res.status(404).json({ error: 'Your joining letter has not been prepared yet.' });
  if (!await activeNda(req.user.id)) return res.status(403).json({ error: 'Please sign the NDA first.', code: 'NDA_REQUIRED' });
  if (!i.accepted_at) return res.status(409).json({ error: 'Accept the letter first, then download it.' });
  const pdf = await letterPdf(i, req);
  await audit(req, 'letter.downloaded', 'user', req.user.id, { ref: i.letter_ref });
  sendPdf(res, pdf, `Joining-Letter-${safeName(i.letter_ref)}.pdf`);
}));

router.get('/mine/certificate.pdf', ah(async (req, res) => {
  const i = await internFor(req.user.id);
  if (!i) return res.status(404).json({ error: 'No internship record found.' });
  if (!await activeNda(req.user.id)) return res.status(403).json({ error: 'Please sign the NDA first.', code: 'NDA_REQUIRED' });
  const pdf = await certificatePdf(i, req);
  await audit(req, 'certificate.downloaded', 'user', req.user.id, { ref: i.cert_ref });
  sendPdf(res, pdf, `Internship-Certificate-${safeName(i.cert_ref)}.pdf`);
}));

/* ---------------- Admin ---------------- */

router.get('/admin', requireRole('admin'), ah(async (req, res) => {
  const ceo = await getCompanySignature();
  const people = await many(
    `SELECT ${INTERN_COLS.replace(/\bi\.id\b/, 'i.id AS internship_id')},
       u.id AS user_id, u.name, u.email, u.title, u.active,
       n.signed_at AS nda_signed_at, n.full_name AS nda_name
     FROM users u
     LEFT JOIN nda_signatures n ON n.user_id = u.id AND n.version = $1 AND n.superseded_at IS NULL
     LEFT JOIN internships i ON i.user_id = u.id
     WHERE u.role <> 'admin' AND u.deleted_at IS NULL
     ORDER BY (i.id IS NULL), u.name`, [NDA_VERSION]
  );
  const elig = new Map();
  for (const p of people) if (p.internship_id && !p.cert_ref) elig.set(p.user_id, await certEligibility(p));
  res.json({
    ceo_signature: ceo ? { preview: pngDataUrl(ceo.png), updated_at: ceo.updated_at } : null,
    credentials_base: credentialsBase(req), custom_domain: !!process.env.CREDENTIALS_URL, min_score: CERT_MIN_SCORE,
    people: people.map((p) => ({
      user_id: p.user_id, name: p.name, email: p.email, title: p.title, active: p.active,
      nda_signed_at: p.nda_signed_at, nda_name: p.nda_name,
      internship: p.internship_id ? {
        role: p.role, start_date: p.start_date, end_date: p.end_date, supervisor_name: p.supervisor_name, supervisor_title: p.supervisor_title,
        notice_days: p.notice_days, stipend: p.stipend, letter_ref: p.letter_ref, letter_date: p.letter_date, accepted_at: p.accepted_at,
        cert_ref: p.cert_ref, cert_issued_on: p.cert_issued_on, cert_completed_on: p.cert_completed_on, cert_remark: p.cert_remark, cert_revoked_at: p.cert_revoked_at,
        eligibility: elig.get(p.user_id) || null,
        letter_url: credentialUrl(req, p.letter_code), cert_url: p.cert_code ? credentialUrl(req, p.cert_code) : null,
      } : null,
    })),
  });
}));

const imageSchema = z.object({ image: z.string().max(8_000_000) });
router.put('/ceo-signature', requireRole('admin'), ah(async (req, res) => {
  const { image } = parse(imageSchema, req.body);
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) return res.status(400).json({ error: 'Upload the signature as a PNG or JPG image.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 1500) return res.status(400).json({ error: 'That image looks empty. Upload a clear photo or scan of the signature.' });
  let png;
  try { png = await cleanSignature(buf); } catch { return res.status(400).json({ error: 'That image could not be read. Try another one.' }); }
  await setCompanySignature(buf, m[1], req.user.id);
  await audit(req, 'ceo_signature.updated', 'company', 'ceo_signature', {});
  res.json({ preview: pngDataUrl(png) });
}));

router.delete('/ceo-signature', requireRole('admin'), ah(async (req, res) => {
  await removeCompanySignature();
  await audit(req, 'ceo_signature.removed', 'company', 'ceo_signature', {});
  res.json({ ok: true });
}));

const internSchema = z.object({
  role: z.string().trim().min(2, 'Enter the internship role, e.g. Social Media').max(80),
  start_date: zDate, end_date: zDate,
  supervisor_name: z.string().trim().min(2, 'Enter the supervisor’s name').max(80),
  supervisor_title: z.string().trim().max(80).optional().nullable(),
  notice_days: z.coerce.number().int().min(1).max(60).default(7),
  stipend: z.string().trim().max(80).optional().nullable(),
  letter_date: zDate.optional().nullable(),
});

const userIdParam = (req) => Number(req.params.userId);
async function memberOr404(req, res) {
  const u = await one("SELECT id, name, role, deleted_at FROM users WHERE id = $1", [userIdParam(req)]);
  if (!u || u.deleted_at || u.role === 'admin') { res.status(404).json({ error: 'Team member not found.' }); return null; }
  return u;
}

/** Create or update someone's joining letter details. Changing the terms after acceptance asks them to accept again. */
router.put('/intern/:userId(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const u = await memberOr404(req, res);
  if (!u) return;
  const b = parse(internSchema, req.body);
  if (b.end_date <= b.start_date) return res.status(400).json({ error: 'The end date must be after the start date.' });
  const existing = await internFor(u.id);
  const letterDate = b.letter_date || existing?.letter_date || todayPk();
  const vals = [b.role, b.start_date, b.end_date, b.supervisor_name, b.supervisor_title || null, b.notice_days, b.stipend || null, letterDate];
  let changedTerms = false;
  if (existing) {
    const before = [existing.role, existing.start_date, existing.end_date, existing.supervisor_name, existing.supervisor_title || null, existing.notice_days, existing.stipend || null];
    changedTerms = before.some((v, k) => String(v ?? '') !== String(vals[k] ?? ''));
    await query(
      `UPDATE internships SET role=$2, start_date=$3, end_date=$4, supervisor_name=$5, supervisor_title=$6, notice_days=$7, stipend=$8, letter_date=$9,
         accepted_at = CASE WHEN $10 THEN NULL ELSE accepted_at END, accepted_ip = CASE WHEN $10 THEN NULL ELSE accepted_ip END,
         accepted_nda_id = CASE WHEN $10 THEN NULL ELSE accepted_nda_id END, updated_at = now()
       WHERE user_id = $1`,
      [u.id, ...vals, changedTerms && !!existing.accepted_at]
    );
  } else {
    await tx(async (c) => {
      const ref = await nextRef(c, 'letter', Number(letterDate.slice(0, 4)));
      await c.query(
        `INSERT INTO internships (user_id, role, start_date, end_date, supervisor_name, supervisor_title, notice_days, stipend, letter_date, letter_ref, letter_code, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [u.id, ...vals, ref, verifyCode(), req.user.id]
      );
    });
  }
  const i = await internFor(u.id);
  await audit(req, existing ? 'letter.updated' : 'letter.created', 'user', u.id, { ref: i.letter_ref });
  if (!existing || (changedTerms && existing.accepted_at)) {
    const title = existing ? 'Your joining letter was updated — please review and accept it again' : 'Your joining letter is ready';
    await notify([u.id], { kind: 'letter', title, body: i.letter_ref, link: '/documents' }, req.user.id);
    await emailUserResult(u.id, {
      kind: 'letter', subject: existing ? 'Your RTL joining letter was updated' : 'Your RTL internship joining letter is ready',
      ...noticeEmail({
        heading: existing ? 'Joining letter updated' : 'Your joining letter is ready',
        intro: existing
          ? 'The terms of your internship joining letter were updated. Please review and accept the new version in Growth Desk.'
          : 'Welcome to RTL. Your internship joining letter is ready. Review it, accept it, and download your signed copy in Growth Desk.',
        rows: [['Reference', i.letter_ref], ['Role', roleTitle(i.role)], ['Duration', `${longDate(i.start_date)} – ${longDate(i.end_date)}`]],
        link: '/documents', button: 'Open my documents',
      }),
    }, { important: true, ref: `letter:${u.id}` }).catch(() => {});
  }
  res.json({ ...i, needs_reaccept: changedTerms && !!existing?.accepted_at });
}));

router.delete('/intern/:userId(\\d+)', requireRole('admin'), ah(async (req, res) => {
  const i = await internFor(userIdParam(req));
  if (!i) return res.status(404).json({ error: 'No joining letter for this person.' });
  if (i.cert_ref) return res.status(409).json({ error: 'A certificate has been issued for this internship, so it cannot be deleted. Withdraw the certificate instead.' });
  // Once accepted, the letter may have been shared; its verification link must keep working
  if (i.accepted_at) return res.status(409).json({ error: 'This letter has been accepted and may have been shared, so it is kept on record. Edit it instead.' });
  await query('DELETE FROM internships WHERE id = $1', [i.id]);
  await audit(req, 'letter.deleted', 'user', i.user_id, { ref: i.letter_ref });
  res.json({ ok: true });
}));

const certSchema = z.object({ remark: z.string().trim().max(220).optional().nullable() });

/** Assigns the certificate number and verification code, then tells the intern. */
async function issueCertificate(req, i, remark) {
  await tx(async (c) => {
    const today = todayPk();
    const ref = await nextRef(c, 'certificate', Number(today.slice(0, 4)));
    await c.query(
      `UPDATE internships SET cert_ref=$2, cert_code=$3, cert_issued_on=$4, cert_completed_on=end_date, cert_remark=$5, cert_revoked_at=NULL, updated_at=now()
       WHERE id=$1 AND cert_ref IS NULL`,
      [i.id, ref, verifyCode(), today, remark || null]
    );
  });
  const n = await internFor(i.user_id);
  await audit(req, 'certificate.issued', 'user', i.user_id, { ref: n.cert_ref, by: req.user.id === i.user_id ? 'claimed' : 'admin' });
  const admins = await many("SELECT id FROM users WHERE role = 'admin' AND active AND deleted_at IS NULL");
  await notify([i.user_id, ...admins.map((a) => a.id)], { kind: 'letter', title: req.user.id === i.user_id ? `${req.user.name} received their internship certificate` : 'Your internship certificate is ready', body: n.cert_ref, link: '/documents' }, req.user.id);
  await emailUserResult(i.user_id, {
    kind: 'letter', subject: 'Your RTL internship certificate',
    ...noticeEmail({
      heading: 'Your internship certificate is ready',
      intro: `Congratulations on completing your internship at RTL with a performance score of ${CERT_MIN_SCORE}% or higher every month. Download your certificate and share its verified link on LinkedIn and other platforms.`,
      rows: [['Certificate No.', n.cert_ref], ['Role', roleTitle(n.role)], ['Verify', credentialUrl(req, n.cert_code)]],
      link: '/documents', button: 'Download certificate',
    }),
  }, { important: true, ref: `certificate:${i.user_id}` }).catch(() => {});
  return n;
}

/** Issue the completion certificate (only when eligible), or edit the appreciation line afterwards. */
router.post('/intern/:userId(\\d+)/certificate', requireRole('admin'), ah(async (req, res) => {
  const i = await internFor(userIdParam(req));
  if (!i) return res.status(404).json({ error: 'Set up the joining letter first.' });
  const b = parse(certSchema, req.body || {});
  if (i.cert_ref) {
    await query('UPDATE internships SET cert_remark=$2, updated_at=now() WHERE id=$1', [i.id, b.remark || null]);
    await audit(req, 'certificate.updated', 'user', i.user_id, { ref: i.cert_ref });
    return res.json(await internFor(i.user_id));
  }
  if (!i.accepted_at) return res.status(409).json({ error: 'The intern has not accepted the joining letter yet.' });
  const el = await certEligibility(i);
  if (!el.eligible) return res.status(409).json({ error: `Not eligible yet. ${el.reason}` });
  res.json(await issueCertificate(req, i, b.remark));
}));

router.post('/intern/:userId(\\d+)/certificate/revoke', requireRole('admin'), ah(async (req, res) => {
  const { restore } = parse(z.object({ restore: z.boolean().default(false) }), req.body || {});
  const i = await internFor(userIdParam(req));
  if (!i?.cert_ref) return res.status(404).json({ error: 'No certificate has been issued.' });
  await query(`UPDATE internships SET cert_revoked_at = ${restore ? 'NULL' : 'now()'}, updated_at = now() WHERE id = $1`, [i.id]);
  await audit(req, restore ? 'certificate.restored' : 'certificate.withdrawn', 'user', i.user_id, { ref: i.cert_ref });
  res.json(await internFor(i.user_id));
}));

router.get('/intern/:userId(\\d+)/letter.pdf', requireRole('admin'), ah(async (req, res) => {
  const i = await internFor(userIdParam(req));
  if (!i) return res.status(404).json({ error: 'No joining letter for this person.' });
  const pdf = await letterPdf(i, req);
  await audit(req, 'letter.downloaded', 'user', i.user_id, { ref: i.letter_ref, by: 'admin' });
  sendPdf(res, pdf, `Joining-Letter-${safeName(i.letter_ref)}.pdf`);
}));

router.get('/intern/:userId(\\d+)/certificate.pdf', requireRole('admin'), ah(async (req, res) => {
  const i = await internFor(userIdParam(req));
  if (!i) return res.status(404).json({ error: 'No internship record found.' });
  if (i.cert_revoked_at) fail(410, 'This certificate has been withdrawn. Restore it to download.');
  const pdf = await certificatePdf(i, req);
  await audit(req, 'certificate.downloaded', 'user', i.user_id, { ref: i.cert_ref, by: 'admin' });
  sendPdf(res, pdf, `Internship-Certificate-${safeName(i.cert_ref)}.pdf`);
}));

export default router;

/* ---------------- Public verification (no sign-in) ---------------- */

export const verifyRouter = Router();
verifyRouter.get('/:code', ah(async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 12) return res.status(404).json({ valid: false, error: 'No document matches this code.' });
  const pretty = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
  const i = await one(`SELECT ${INTERN_COLS} FROM internships i WHERE i.letter_code = $1 OR i.cert_code = $1`, [pretty]);
  if (!i) return res.status(404).json({ valid: false, error: 'No document matches this code.' });
  const isCert = i.cert_code === pretty;
  const name = await printName(i.user_id);
  res.json({
    valid: isCert ? !i.cert_revoked_at : true,
    status: isCert && i.cert_revoked_at ? 'withdrawn' : 'valid',
    type: isCert ? 'Internship Completion Certificate' : 'Internship Joining Letter',
    ref: isCert ? i.cert_ref : i.letter_ref,
    name, role: roleTitle(i.role),
    period: `${longDate(i.start_date)} – ${longDate(isCert ? i.cert_completed_on || i.end_date : i.end_date)}`,
    issued_on: longDate(isCert ? i.cert_issued_on : i.letter_date),
    issuer: 'Resilience Technologies Labs (SMC-Private) Limited',
  });
}));
