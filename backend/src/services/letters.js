import crypto from 'node:crypto';
import sharp from 'sharp';
import { one, query } from '../db.js';
import { encryptBuffer, decryptBuffer } from '../crypto.js';
import { BRAND } from '../brand.js';

/*
 * Joining letters and internship certificates.
 * - Reference numbers run per year and are never reused: RTL/HR/INT/2026/0001, RTL/HR/CERT/2026/0001.
 * - Each document gets a verification code; anyone can check it at /verify/<code>.
 * - The CEO's signature is stored once (encrypted) and placed on the NDA, letters and certificates.
 */

export const REF_PREFIX = { letter: 'RTL/HR/INT', certificate: 'RTL/HR/CERT' };

/** Next reference number for `kind` in `year`, inside the caller's transaction. */
export async function nextRef(c, kind, year) {
  const { rows } = await c.query(
    `INSERT INTO doc_counters (kind, year, n) VALUES ($1, $2, 1)
     ON CONFLICT (kind, year) DO UPDATE SET n = doc_counters.n + 1 RETURNING n`,
    [kind, year]
  );
  return `${REF_PREFIX[kind]}/${year}/${String(rows[0].n).padStart(4, '0')}`;
}

// No 0/O/1/I so codes are easy to read out and type
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function verifyCode() {
  const b = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** Turns a photo/scan of a signature into a trimmed PNG with a transparent background. */
export async function cleanSignature(buf) {
  // Even out lighting from phone photos, then cut away the empty paper around the signature
  let src = await sharp(buf).rotate().flatten({ background: '#ffffff' }).normalise().png().toBuffer();
  try { src = await sharp(src).trim({ threshold: 40 }).png().toBuffer(); } catch { /* nothing to trim */ }
  const { data, info } = await sharp(src).resize({ width: 900, height: 360, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Paper (light) becomes transparent; ink stays solid, with a soft edge in between
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const a = lum >= 215 ? 0 : lum <= 150 ? 255 : Math.round(((215 - lum) / 65) * 255);
    data[i + 3] = a;
    // Deepen the ink a little so faint pen strokes print clearly
    if (a > 0) { data[i] = Math.round(data[i] * 0.75); data[i + 1] = Math.round(data[i + 1] * 0.75); data[i + 2] = Math.round(data[i + 2] * 0.8); }
  }
  return sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer();
}

let sigCache = null; // { at, value }
/** The CEO's signature as a clean PNG, or null when it has not been uploaded yet. */
export async function getCompanySignature() {
  if (sigCache && Date.now() - sigCache.at < 60_000) return sigCache.value;
  const row = await one("SELECT data_enc, updated_at FROM company_assets WHERE key = 'ceo_signature'").catch(() => null);
  const value = row ? { png: await cleanSignature(decryptBuffer(row.data_enc)), updated_at: row.updated_at } : null;
  sigCache = { at: Date.now(), value };
  return value;
}
export async function setCompanySignature(buf, mime, userId) {
  await query(
    `INSERT INTO company_assets (key, data_enc, mime, updated_by) VALUES ('ceo_signature', $1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET data_enc = EXCLUDED.data_enc, mime = EXCLUDED.mime, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [encryptBuffer(buf), mime, userId]
  );
  sigCache = null;
}
export async function removeCompanySignature() {
  await query("DELETE FROM company_assets WHERE key = 'ceo_signature'");
  sigCache = null;
}
export const pngDataUrl = (png) => (png ? `data:image/png;base64,${png.toString('base64')}` : null);

/* ---------- Dates ---------- */
// DATE columns are read as 'YYYY-MM-DD' text, so no time zone can shift them
export const longDate = (d) => {
  if (!d) return '';
  const iso = d instanceof Date ? d.toISOString() : String(d);
  const date = iso.length === 10 ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : 'Asia/Karachi' });
};
export const todayPk = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

/** Whole months between two dates (e.g. 1 Dec → 28 Feb = 3 months). */
export function monthsBetween(start, end) {
  const a = new Date(`${start}T00:00:00Z`), b = new Date(`${end}T00:00:00Z`);
  b.setUTCDate(b.getUTCDate() + 1); // the end date is the last working day
  const m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() - a.getUTCDate()) / 30;
  return Math.max(1, Math.round(m));
}
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const durationText = (start, end) => {
  const m = monthsBetween(start, end);
  return `${NUM[m] ? `${NUM[m][0].toUpperCase()}${NUM[m].slice(1)} (${m})` : m} month${m === 1 ? '' : 's'}`;
};
export const roleTitle = (role) => (/\bintern$/i.test(role.trim()) ? role.trim() : `${role.trim()} Intern`);

/**
 * The joining letter's numbered terms, as [label, text] pairs.
 * Shared by the PDF and the on-screen preview so both always say the same thing.
 */
export function letterTerms(i, ndaSignedAt) {
  const sup = [i.supervisor_name, i.supervisor_title].filter(Boolean).join(', ');
  return [
    ['Duration', `${durationText(i.start_date, i.end_date)}, from ${longDate(i.start_date)} to ${longDate(i.end_date)}.`],
    ['Supervisor', `You will report to ${sup}.`],
    ['Remote work', 'You will work remotely using your own device and internet connection, and must be available online during working days and hours.'],
    ['Stipend', i.stipend
      ? `You will receive a stipend of ${i.stipend}, subject to satisfactory performance and attendance.`
      : 'This is an unpaid learning internship. Committed, high-performing interns may later be offered a paid internship at RTL’s discretion.'],
    ['Communication', 'You must attend scheduled meetings and stay responsive on RTL’s official channels: WhatsApp, email, Meeto360 and Growth Desk.'],
    ['Confidentiality and IP', `All company information, code, data and designs are confidential and must not be shared. All work you produce during the internship belongs to RTL. You remain bound by the Non-Disclosure and Confidentiality Agreement${ndaSignedAt ? ` you signed on ${longDate(ndaSignedAt)}` : ''}.`],
    ['Termination', `Either party may end the internship with ${i.notice_days} days’ notice; RTL may end it immediately for misconduct or a confidentiality breach.`],
    ['Certificate', 'On successful completion, you will receive an Internship Completion Certificate.'],
  ];
}

export const intro = (i) => ({
  before: 'We are pleased to confirm that you have joined ',
  company: `${BRAND.legal}`,
  middle: ' (“RTL”) as a remote ',
  role: roleTitle(i.role),
  after: ' with effect from ',
  date: longDate(i.start_date),
  end: ', on the following terms:',
});

/** Columns of an internship with DATE fields as plain text. */
export const INTERN_COLS = `i.id, i.user_id, i.role, i.start_date::text AS start_date, i.end_date::text AS end_date,
  i.supervisor_name, i.supervisor_title, i.notice_days, i.stipend, i.letter_ref, i.letter_date::text AS letter_date, i.letter_code,
  i.accepted_at, i.accepted_ip, i.accepted_nda_id, i.cert_ref, i.cert_code, i.cert_issued_on::text AS cert_issued_on,
  i.cert_completed_on::text AS cert_completed_on, i.cert_remark, i.cert_revoked_at, i.created_at, i.updated_at`;
