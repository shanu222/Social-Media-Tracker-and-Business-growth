import crypto from 'node:crypto';
import sharp from 'sharp';
import { many, one, query, tx } from '../db.js';
import { notify } from '../notify.js';
import { emailUserResult, noticeEmail } from '../mailer.js';
import { encryptBuffer, decryptBuffer } from '../crypto.js';
import { BRAND } from '../brand.js';
import { personPerformance } from './performance.js';

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

/**
 * Turns a photo or scan of a signature into a tightly cropped PNG with a transparent background.
 * Like a scanner app: the paper colour is estimated locally (so shadows and grey paper vanish),
 * only the ink is kept, and the image is cropped to the ink so the signature fills its space.
 */
export async function cleanSignature(buf) {
  const src = sharp(buf).rotate().flatten({ background: '#ffffff' }).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
  const { data: rgb, info } = await src.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const lum = Buffer.alloc(N);
  for (let p = 0, q = 0; p < N; p++, q += 3) lum[p] = Math.round(0.299 * rgb[q] + 0.587 * rgb[q + 1] + 0.114 * rgb[q + 2]);
  // Local paper brightness: a heavy blur (thin pen strokes barely affect it)
  const bg = await sharp(lum, { raw: { width: W, height: H, channels: 1 } }).blur(Math.max(8, Math.round(Math.min(W, H) / 40))).raw().toBuffer();
  const alpha = new Float32Array(N);
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let p = 0; p < N; p++) {
    const d = bg[p] - lum[p]; // how much darker than the paper around it
    const a = d <= 22 ? 0 : d >= 70 ? 1 : (d - 22) / 48;
    alpha[p] = a;
    if (a > 0.35) {
      const x = p % W, y = (p / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw Object.assign(new Error('No signature found in the image. Upload a clear photo of the signature on white paper.'), { status: 400 });
  // Crop to the ink with a small margin
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04) + 4;
  const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad), x1 = Math.min(W - 1, maxX + pad), y1 = Math.min(H - 1, maxY + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const p = (y + y0) * W + (x + x0), q = p * 3, o = (y * cw + x) * 4;
      const a = alpha[p];
      // Ink keeps its hue but is deepened so faint pen prints clearly
      out[o] = Math.round(rgb[q] * 0.55); out[o + 1] = Math.round(rgb[q + 1] * 0.55); out[o + 2] = Math.round(rgb[q + 2] * 0.65);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return sharp(out, { raw: { width: cw, height: ch, channels: 4 } })
    .resize({ width: 1000, height: 400, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
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

/* ---------- Supervising team ---------- */

/** Letters name a team lead rather than a person, e.g. "the Team Lead, Software Development". */
export const TEAM_LEAD = 'Team Lead';
const TEAMS = {
  'Software Developer': 'Software Development', 'Mobile App Developer': 'Software Development', 'DevOps Engineer': 'Software Development',
  'QA Engineer': 'Software Development', 'Cybersecurity Analyst': 'Software Development',
  'AI/ML Engineer': 'AI & Data', 'Data Analyst': 'AI & Data',
  'UI/UX Designer': 'Design & Creative', 'Graphic Designer': 'Design & Creative', 'Video Editor': 'Design & Creative',
  'Social Media Manager': 'Social Media & Marketing', 'Digital Marketing Specialist': 'Social Media & Marketing', 'Content Writer': 'Content & Communications',
  'Business Developer': 'Business Development', 'Project Coordinator': 'Operations', 'HR Associate': 'Human Resources',
  'Civil Engineer': 'Engineering & Research', 'GIS Analyst': 'Engineering & Research', 'Research Assistant': 'Engineering & Research',
  'Accountant': 'Finance', 'Customer Support Specialist': 'Client Support',
};
/** The team a position belongs to (by exact position, else by keywords). */
export function teamFor(role) {
  const r = String(role || '').replace(/\s*intern$/i, '').trim();
  if (TEAMS[r]) return TEAMS[r];
  const l = r.toLowerCase();
  if (/social|marketing|seo|brand/.test(l)) return 'Social Media & Marketing';
  if (/content|writ|copy/.test(l)) return 'Content & Communications';
  if (/develop|software|web|app|engineer.*(software|devops)|programm/.test(l)) return 'Software Development';
  if (/design|video|creative|ui|ux|graphic/.test(l)) return 'Design & Creative';
  if (/data|ai|machine|ml/.test(l)) return 'AI & Data';
  if (/civil|structur|gis|research/.test(l)) return 'Engineering & Research';
  if (/business|sales/.test(l)) return 'Business Development';
  if (/hr|human/.test(l)) return 'Human Resources';
  return 'Operations';
}
/** "the Team Lead, Social Media & Marketing" for team leads; names as written otherwise. */
export function supervisorText(i) {
  if (i.supervisor_name === TEAM_LEAD) return `the ${TEAM_LEAD}, ${i.supervisor_title || teamFor(i.role)}`;
  return [i.supervisor_name, i.supervisor_title].filter(Boolean).join(', ');
}

/**
 * The joining letter's numbered terms, as [label, text] pairs.
 * Shared by the PDF and the on-screen preview so both always say the same thing.
 */
export function letterTerms(i, ndaSignedAt) {
  const sup = supervisorText(i);
  return [
    ['Duration', `${durationText(i.start_date, i.end_date)}, from ${longDate(i.start_date)} to ${longDate(i.end_date)}.`],
    ['Supervisor', `You will report to ${sup}.`],
    ['Remote work', 'You will work remotely using your own device and internet connection, and must be available online during working days and hours.'],
    ['Stipend', i.stipend
      ? `You will receive a stipend of ${i.stipend}, subject to satisfactory performance and attendance.`
      : 'This is an unpaid learning internship. Committed, high-performing interns may later be offered a paid internship at RTL’s discretion.'],
    ['Communication', 'You must attend scheduled meetings and stay responsive on RTL’s official channels: WhatsApp, email, Meeto360 and RTL’s internal workspace.'],
    ['Confidentiality and IP', `All company information, code, data and designs are confidential and must not be shared. All work you produce during the internship belongs to RTL. You remain bound by the Non-Disclosure and Confidentiality Agreement${ndaSignedAt ? ` you signed on ${longDate(ndaSignedAt)}` : ''}.`],
    ['Termination', `Either party may end the internship with ${i.notice_days} days’ notice; RTL may end it immediately for misconduct or a confidentiality breach.`],
    ['Certificate', `On successful completion, with an overall performance score of at least ${CERT_MIN_SCORE}% across the internship, you will receive an Internship Completion Certificate.`],
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
  i.cert_completed_on::text AS cert_completed_on, i.cert_remark, i.cert_revoked_at, i.created_at, i.updated_at,
  i.cv_name, i.cv_mime, i.cv_size, i.cv_uploaded_at, i.cv_skills, i.cv_position, i.role_source, i.cert_overall, i.cert_manual`;

/* ---------- Certificate eligibility ---------- */

/** Whether the certificate may state the performance requirement (true for certificates issued on merit). */
export const certPerformanceMet = (i) => i.cert_overall == null || i.cert_overall >= CERT_MIN_SCORE;

/** Minimum monthly performance score for the completion certificate. */
export const CERT_MIN_SCORE = Math.min(100, Math.max(1, Number(process.env.CERT_MIN_SCORE) || 90));

const addMonths = (d, m) => {
  const x = new Date(`${d}T00:00:00Z`);
  const day = x.getUTCDate();
  x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x.toISOString().slice(0, 10);
};
const dayBefore = (d) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const shortRange = (a, b) => {
  const f = (d, y) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  return `${f(a)} – ${f(b, true)}`;
};

/** The internship split into months: 1 Dec – 31 Dec, 1 Jan – 31 Jan, … (the last one ends on the end date). */
export function internshipMonths(start, end) {
  const out = [];
  for (let k = 0; k < 24; k++) {
    const s = addMonths(start, k);
    if (s > end) break;
    let e = dayBefore(addMonths(start, k + 1));
    if (e > end) e = end;
    out.push({ n: k + 1, start: s, end: e });
  }
  return out;
}

/**
 * Whether the completion certificate can be issued: the internship has ended and the overall
 * performance score across the whole internship (Performance page: average of task completion
 * and on-time completion) is at least CERT_MIN_SCORE. Months are shown for progress only.
 */
export async function certEligibility(i) {
  const today = todayPk();
  const months = [];
  for (const m of internshipMonths(i.start_date, i.end_date)) {
    const state = m.start > today ? 'upcoming' : m.end >= today ? 'current' : 'done';
    let ind = null;
    if (state !== 'upcoming') ind = (await personPerformance(i.user_id, m.start, m.end > today ? today : m.end, { light: true })).indicators;
    months.push({
      ...m, label: `Month ${m.n}`, range: shortRange(m.start, m.end), state, score: ind ? ind.score : null,
      assigned: ind?.assigned ?? 0, completed: ind?.completed ?? 0,
    });
  }
  const until = i.end_date < today ? i.end_date : today;
  const all = i.start_date <= today ? (await personPerformance(i.user_id, i.start_date, until, { light: true })).indicators : null;
  const overall = all ? all.score : null;
  const ended = today > i.end_date;
  const eligible = ended && overall !== null && overall >= CERT_MIN_SCORE;
  let reason;
  if (eligible) reason = `Overall performance: ${overall}% — requirement met.`;
  else if (ended) reason = overall === null ? 'No tasks were recorded during the internship.' : `Overall performance was ${overall}%, below the required ${CERT_MIN_SCORE}%.`;
  else reason = `Available after ${longDate(i.end_date)} with an overall performance of ${CERT_MIN_SCORE}% or higher.`;
  return { min: CERT_MIN_SCORE, ended, eligible, overall, assigned: all?.assigned ?? 0, completed: all?.completed ?? 0, reason, months };
}

/* ---------- Automatic joining letters ---------- */

/** Internship role from a job title: "Social Media Manager" → "Social Media" (printed as "Social Media Intern"). */
export function roleFromTitle(title) {
  const t = String(title || '').trim();
  if (!t) return 'Social Media';
  if (/\bintern\b/i.test(t)) return t.replace(/\s*\binternship\b/i, '').trim();
  const r = t.replace(/\s+(manager|executive|officer|lead|specialist|associate|assistant|coordinator|head|member)$/i, '').trim();
  return r || t;
}

const plusMonthsMinusDay = (d, m) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + m); x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};

/**
 * Every team member who has signed the NDA gets a joining letter automatically: role from their job
 * title, start date = the day they joined the workspace, three months, supervised by the CEO.
 * The admin can edit any of it. Returns true when a letter was created.
 */
export async function ensureJoiningLetter(userId, { notifyUser = true } = {}) {
  const u = await one(
    `SELECT u.id, u.name, u.title, u.role, u.deleted_at, (u.created_at AT TIME ZONE 'Asia/Karachi')::date::text AS joined,
       EXISTS (SELECT 1 FROM nda_signatures n WHERE n.user_id = u.id AND n.superseded_at IS NULL) AS signed,
       EXISTS (SELECT 1 FROM internships i WHERE i.user_id = u.id) AS has_letter
     FROM users u WHERE u.id = $1`, [userId]
  );
  if (!u || u.role === 'admin' || u.deleted_at || !u.signed || u.has_letter) return false;
  const start = u.joined;
  const letterDate = todayPk();
  const created = await tx(async (c) => {
    const ref = await nextRef(c, 'letter', Number(letterDate.slice(0, 4)));
    const { rowCount } = await c.query(
      `INSERT INTO internships (user_id, role, start_date, end_date, supervisor_name, supervisor_title, notice_days, letter_date, letter_ref, letter_code)
       VALUES ($1,$2,$3,$4,$5,$6,7,$7,$8,$9) ON CONFLICT (user_id) DO NOTHING`,
      [u.id, roleFromTitle(u.title), start, plusMonthsMinusDay(start, 3), TEAM_LEAD, teamFor(roleFromTitle(u.title)), letterDate, ref, verifyCode()]
    );
    if (!rowCount) throw Object.assign(new Error('exists'), { skip: true });
    return ref;
  }).catch((e) => { if (e.skip) return null; throw e; });
  if (!created) return false;
  if (notifyUser) {
    await notify([u.id], { kind: 'letter', title: 'Your joining letter is ready', body: created, link: '/documents' });
    await emailUserResult(u.id, {
      kind: 'letter', subject: 'Your RTL internship joining letter is ready',
      ...noticeEmail({
        heading: 'Your joining letter is ready',
        intro: 'Your internship joining letter is ready in My documents. Review and accept it to download your signed copy and share its verified link.',
        rows: [['Reference', created]], link: '/documents', button: 'Open my documents',
      }),
    }, { important: true, ref: `letter:${u.id}` }).catch(() => {});
  }
  return true;
}

/** One pass for everyone who has already signed the NDA (runs at start-up; safe to repeat). */
export async function ensureAllJoiningLetters() {
  // Letters made with the CEO as supervisor now name the intern's team lead instead (no personal names)
  const old = await many('SELECT id, role FROM internships WHERE supervisor_name = $1 AND supervisor_title = $2', [BRAND.ceo, BRAND.ceoTitle]);
  for (const r of old) await query('UPDATE internships SET supervisor_name = $2, supervisor_title = $3, updated_at = now() WHERE id = $1', [r.id, TEAM_LEAD, teamFor(r.role)]);
  const rows = await many(
    `SELECT u.id FROM users u
     WHERE u.role <> 'admin' AND u.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM nda_signatures n WHERE n.user_id = u.id AND n.superseded_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM internships i WHERE i.user_id = u.id)
     ORDER BY u.id`
  );
  let n = 0;
  for (const r of rows) if (await ensureJoiningLetter(r.id).catch((e) => { console.error('[letters]', e.message); return false; })) n++;
  return n;
}
