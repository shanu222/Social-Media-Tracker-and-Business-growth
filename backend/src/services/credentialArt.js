import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { BRAND } from '../brand.js';
import { CERT_MIN_SCORE, durationText, longDate, roleTitle, intro, letterTerms, certPerformanceMet } from './letters.js';
import { stampPng, stampStyle } from './stamp.js';

/*
 * Certificate and share-card artwork as SVG with all text converted to outlines, so they render
 * identically everywhere (PDF, the public credential page, social previews) without system fonts.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(here, '../../assets/fonts');
const load = (f) => opentype.loadSync(path.join(FONT_DIR, f));
const F = {
  serif: load('playfair-display-latin-700-normal.woff'),
  serifItalic: load('playfair-display-latin-400-italic.woff'),
  sans: load('inter-latin-400-normal.woff'),
  sansMedium: load('inter-latin-500-normal.woff'),
  sansSemi: load('inter-latin-600-normal.woff'),
  sansBold: load('inter-latin-700-normal.woff'),
};

const NAVY = '#0a1a3d', INK = '#1b2433', MUTED = '#5b6676', BLUE = '#1a5fe0', CYAN = '#12b5e8', GREEN = '#16b97a';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Width of a line of text at `size` px with letter spacing `ls` (em). */
const width = (font, text, size, ls = 0) => font.getAdvanceWidth(text, size, { letterSpacing: ls, kerning: true }) - (ls ? ls * size : 0);

/** Text as an SVG path. anchor: start | middle | end. */
function text(font, str, x, y, size, { anchor = 'start', ls = 0, fill = INK, opacity } = {}) {
  const w = width(font, str, size, ls);
  const sx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  const d = font.getPath(str, sx, y, size, { letterSpacing: ls, kerning: true }).toPathData(2);
  return `<path d="${d}" fill="${fill}"${opacity ? ` opacity="${opacity}"` : ''}/>`;
}

/** Shrinks `size` until the text fits `max` px. */
const fit = (font, str, size, max, ls = 0) => { let s = size; while (s > 10 && width(font, str, s, ls) > max) s -= 1; return s; };

/** Word-wraps into lines no wider than `max`. */
function wrap(font, str, size, max) {
  const lines = []; let cur = '';
  for (const w of str.split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && width(font, next, size) > max) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
/** Centred paragraph; returns { svg, bottom }. */
function para(font, str, cx, y, size, max, { lh = 1.5, fill = INK } = {}) {
  const lines = wrap(font, str, size, max);
  const svg = lines.map((l, k) => text(font, l, cx, y + k * size * lh, size, { anchor: 'middle', fill })).join('');
  return { svg, bottom: y + (lines.length - 1) * size * lh };
}

let logoCache = null;
async function logoDataUrl() {
  if (logoCache) return logoCache;
  const buf = fs.existsSync(BRAND.logo) ? await sharp(BRAND.logo).resize(320, 320, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() : null;
  logoCache = buf ? `data:image/png;base64,${buf.toString('base64')}` : null;
  return logoCache;
}
const png64 = (buf) => (buf ? `data:image/png;base64,${buf.toString('base64')}` : null);
async function qrDataUrl(url) {
  return png64(await QRCode.toBuffer(url, { margin: 0, width: 360, errorCorrectionLevel: 'M', color: { dark: NAVY, light: '#ffffff' } }));
}

const gradient = (id, x1 = 0, x2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="0" x2="${x2}" y2="0"><stop offset="0" stop-color="${BLUE}"/><stop offset=".5" stop-color="${CYAN}"/><stop offset="1" stop-color="${GREEN}"/></linearGradient>`;

/** The certificate sentence (shared with the public page). */
export function certificateSentence(i) {
  const until = i.cert_completed_on || i.end_date;
  const months = durationText(i.start_date, until).replace(/ \(\d+\)/, '').toLowerCase().replace(/ months?$/, '-month');
  const perf = certPerformanceMet(i) ? `, with an overall performance score of ${CERT_MIN_SCORE}% or higher` : '';
  return `has successfully completed a ${months} remote internship as a ${roleTitle(i.role)} at ${BRAND.legal}, from ${longDate(i.start_date)} to ${longDate(until)}${perf}.`;
}

/**
 * Internship completion certificate, A4 landscape at 2× points (1684 × 1190).
 * @param o { intern, name, ceoSig (png buffer|null), verifyUrl }
 */
export async function certificateSvg(o) {
  const { intern: i } = o;
  const W = 1684, H = 1190, cx = W / 2;
  const logo = await logoDataUrl();
  const qr = await qrDataUrl(o.verifyUrl);
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  if (logo) parts.push(`<image href="${logo}" x="${cx - 300}" y="${H / 2 - 270}" width="600" height="600" opacity="0.04"/>`);
  parts.push(`<rect x="36" y="36" width="${W - 72}" height="${H - 72}" fill="none" stroke="${NAVY}" stroke-width="4"/>`);
  parts.push(`<rect x="52" y="52" width="${W - 104}" height="${H - 104}" fill="none" stroke="${CYAN}" stroke-width="1.5"/>`);
  parts.push(`<rect x="52" y="52" width="${W - 104}" height="10" fill="url(#g)"/><rect x="52" y="${H - 62}" width="${W - 104}" height="10" fill="url(#g)"/>`);
  for (const [x, y, sx, sy] of [[68, 78, 1, 1], [W - 68, 78, -1, 1], [68, H - 78, 1, -1], [W - 68, H - 78, -1, -1]]) {
    parts.push(`<path d="M${x} ${y + sy * 68} L${x} ${y} L${x + sx * 68} ${y}" fill="none" stroke="${GREEN}" stroke-width="4"/>`);
  }

  if (logo) parts.push(`<image href="${logo}" x="${cx - 58}" y="96" width="116" height="116"/>`);
  parts.push(text(F.sansSemi, BRAND.legal.toUpperCase(), cx, 252, 20, { anchor: 'middle', ls: 0.16, fill: NAVY }));
  parts.push(text(F.serif, 'CERTIFICATE', cx, 350, 80, { anchor: 'middle', ls: 0.12, fill: NAVY }));
  parts.push(text(F.sansMedium, 'OF INTERNSHIP COMPLETION', cx, 400, 23, { anchor: 'middle', ls: 0.3, fill: BLUE }));
  parts.push(text(F.serifItalic, 'This is to certify that', cx, 470, 29, { anchor: 'middle', fill: MUTED }));
  const ns = fit(F.serif, o.name, 66, 1240);
  parts.push(text(F.serif, o.name, cx, 552, ns, { anchor: 'middle', fill: NAVY }));
  parts.push(`<rect x="${cx - 300}" y="576" width="600" height="3.5" fill="url(#g2)"/>`);

  const body = para(F.sans, certificateSentence(i), cx, 626, 25, 1220, { lh: 1.55, fill: INK });
  parts.push(body.svg);
  let y = body.bottom + 50;
  if (i.cert_remark) {
    const r = para(F.serifItalic, `“${i.cert_remark.trim().replace(/[.]?$/, '.')}”`, cx, y, 25, 1120, { lh: 1.45, fill: MUTED });
    parts.push(r.svg); y = r.bottom + 48;
  }
  const first = o.name.split(/\s+/)[0];
  parts.push(para(F.sans, `We thank ${first} for their dedication and contribution, and wish them every success in the future.`, cx, y, 25, 1220, { fill: INK }).svg);

  // Signature, seal, details
  const by = 956, lx = 184, colW = 400;
  if (o.ceoSig) {
    const meta = await sharp(o.ceoSig).metadata();
    const scale = Math.min(370 / meta.width, 112 / meta.height);
    const w = meta.width * scale, h = meta.height * scale;
    parts.push(`<image href="${png64(o.ceoSig)}" x="${lx + (colW - w) / 2}" y="${by - h}" width="${w}" height="${h}"/>`);
  }
  parts.push(`<rect x="${lx}" y="${by + 4}" width="${colW}" height="1.6" fill="#8a95a5"/>`);
  parts.push(text(F.sansSemi, BRAND.ceo, lx + colW / 2, by + 40, 22, { anchor: 'middle', fill: NAVY }));
  parts.push(text(F.sans, `${BRAND.ceoTitle}, RTL`, lx + colW / 2, by + 70, 19, { anchor: 'middle', fill: MUTED }));

  const sy = by - 8;
  // Company stamp
  const st = await stampPng({ size: 640, ...stampStyle(i.cert_ref) });
  parts.push(`<image href="${png64(st)}" x="${cx - 118}" y="${sy - 118}" width="236" height="236"/>`);

  const rx = W - 184 - colW, qs = 124;
  parts.push(`<image href="${qr}" x="${rx + colW - qs}" y="${by - 118}" width="${qs}" height="${qs}"/>`);
  parts.push(text(F.sans, 'Certificate No.', rx, by - 96, 17, { fill: MUTED }));
  parts.push(text(F.sansBold, i.cert_ref, rx, by - 68, 21, { fill: NAVY }));
  parts.push(text(F.sans, 'Issued on', rx, by - 34, 17, { fill: MUTED }));
  parts.push(text(F.sansBold, longDate(i.cert_issued_on), rx, by - 6, 21, { fill: NAVY }));
  parts.push(para(F.sans, 'Scan the code or open the link below to verify this certificate.', rx + colW / 2, by + 36, 16, colW, { lh: 1.4, fill: MUTED }).svg);

  const label = 'Verify this certificate: ';
  const lw = width(F.sans, label, 17), uw = width(F.sansMedium, o.verifyUrl, 17);
  const sx = cx - (lw + uw) / 2;
  parts.push(text(F.sans, label, sx, H - 96, 17, { fill: MUTED }));
  parts.push(text(F.sansMedium, o.verifyUrl, sx + lw, H - 96, 17, { fill: BLUE }));

  if (o.preview) {
    // Admin preview: clearly not a valid certificate
    parts.push(`<g transform="rotate(-24 ${cx} ${H / 2})" opacity="0.13">${text(F.sansBold, 'PREVIEW · NOT ISSUED', cx, H / 2 + 40, 118, { anchor: 'middle', ls: 0.06, fill: '#b8322a' })}</g>`);
  }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${gradient('g')}${gradient('g2')}</defs>${parts.join('')}</svg>`,
    width: W, height: H,
    // Where the link and QR sit, for clickable areas in the PDF (in SVG units)
    links: [{ x: sx + lw, y: H - 114, w: uw, h: 24 }, { x: rx + colW - qs, y: by - 118, w: qs, h: qs }],
  };
}

/* ---------- Joining letter as an image (same content as the PDF, on the real letterhead) ---------- */

const LETTERHEAD = path.resolve(here, '../../assets/letterhead.jpg');
let letterheadUri = null;
async function letterheadDataUrl() {
  if (!letterheadUri && fs.existsSync(LETTERHEAD)) {
    letterheadUri = `data:image/jpeg;base64,${(await sharp(LETTERHEAD).resize(1191, 1684).jpeg({ quality: 84 }).toBuffer()).toString('base64')}`;
  }
  return letterheadUri;
}

/** Justified paragraph with bold runs. runs: [{ t, b }]. Returns { svg, bottom } (bottom = last baseline). */
function richPara(runs, x, y, maxW, size, lh, { justify = true, fill = INK } = {}) {
  const toks = [];
  let space = true;
  for (const r of runs) {
    for (const part of String(r.t).split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { space = true; continue; }
      const font = r.b ? F.sansSemi : F.sans;
      if (!space && toks.length) toks[toks.length - 1].push({ w: part, font });
      else toks.push([{ w: part, font }]);
      space = false;
    }
  }
  const unitW = (u) => u.reduce((a, t) => a + width(t.font, t.w, size), 0);
  const sp = width(F.sans, ' ', size);
  const lines = [];
  let cur = [], curW = 0;
  for (const u of toks) {
    const w = unitW(u);
    if (cur.length && curW + sp + w > maxW) { lines.push(cur); cur = [u]; curW = w; } else { curW += (cur.length ? sp : 0) + w; cur.push(u); }
  }
  if (cur.length) lines.push(cur);
  let out = '';
  lines.forEach((line, k) => {
    const total = line.reduce((a, u) => a + unitW(u), 0);
    const last = k === lines.length - 1;
    const gap = justify && !last && line.length > 1 ? (maxW - total) / (line.length - 1) : sp;
    let cx = x;
    const by = y + k * lh;
    for (const u of line) {
      for (const t of u) { out += `<path d="${t.font.getPath(t.w, cx, by, size, { kerning: true }).toPathData(2)}" fill="${fill}"/>`; cx += width(t.font, t.w, size); }
      cx += gap;
    }
  });
  return { svg: out, bottom: y + (lines.length - 1) * lh };
}

/** A label + bold value on one line. */
function pairText(label, value, x, y, size, { anchor = 'start' } = {}) {
  const lw = width(F.sans, label, size), vw = width(F.sansSemi, value, size);
  const sx = anchor === 'end' ? x - lw - vw : x;
  return text(F.sans, label, sx, y, size, { fill: INK }) + text(F.sansSemi, value, sx + lw, y, size, { fill: INK });
}

async function fitImage(buf, x, yBottom, maxW, maxH) {
  const m = await sharp(buf).metadata();
  const k = Math.min(maxW / m.width, maxH / m.height);
  const w = m.width * k, h = m.height * k;
  return `<image href="${png64(buf)}" x="${x}" y="${yBottom - h}" width="${w}" height="${h}"/>`;
}

/**
 * The joining letter as an A4 image (1191 × 1684), matching the PDF: letterhead, reference, terms,
 * both signatures, company stamp and verification QR.
 * @param o { intern, name, ndaSignedAt, ceoSig, memberSig, acceptedAt, verifyUrl, stamp }
 */
export async function letterSvg(o) {
  const i = o.intern;
  const W = 1191, H = 1684, L = 108, TW = 975, size = 20, lh = 26.5;
  const p = [];
  const lhImg = await letterheadDataUrl();
  p.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  if (lhImg) p.push(`<image href="${lhImg}" x="0" y="0" width="${W}" height="${H}"/>`);
  p.push(pairText('Ref No: ', i.letter_ref, L, 380, 19));
  p.push(pairText('Date: ', longDate(i.letter_date), L + TW, 380, 19, { anchor: 'end' }));
  p.push(pairText('To: ', o.name, L, 410, 19));
  const subj = 'SUBJECT: INTERNSHIP JOINING LETTER';
  const sw = width(F.sansBold, subj, 21);
  p.push(text(F.sansBold, subj, W / 2, 462, 21, { anchor: 'middle', fill: INK }));
  p.push(`<rect x="${W / 2 - sw / 2}" y="466" width="${sw}" height="1.6" fill="${INK}"/>`);
  p.push(text(F.sans, `Dear ${o.name},`, L, 508, size, { fill: INK }));
  const t = intro(i);
  let r = richPara([{ t: t.before }, { t: t.company, b: true }, { t: t.middle }, { t: t.role, b: true }, { t: t.after }, { t: t.date, b: true }, { t: t.end }], L, 544, TW, size, lh);
  p.push(r.svg);
  let y = r.bottom + lh + 12;
  letterTerms(i, o.ndaSignedAt).forEach(([label, body], n) => {
    p.push(text(F.sans, `${n + 1}.`, L + 4, y, size, { fill: INK }));
    r = richPara([{ t: `${label}:`, b: true }, { t: ` ${body}` }], L + 36, y, TW - 36, size, lh);
    p.push(r.svg);
    y = r.bottom + lh + 6;
  });
  r = richPara([{ t: 'Welcome to the RTL team. Your electronic acceptance below confirms that you have read and agree to these terms.' }], L, y + 2, TW, size, lh);
  p.push(r.svg);

  // Signatures and stamp
  const sigBottom = r.bottom + 104, colW = 380, rx = L + TW - colW;
  if (o.ceoSig) p.push(await fitImage(o.ceoSig, L, sigBottom, 340, 92));
  if (o.memberSig && o.acceptedAt) p.push(await fitImage(o.memberSig, rx, sigBottom, 340, 92));
  const ly = sigBottom + 6;
  p.push(`<rect x="${L}" y="${ly}" width="${colW}" height="1.4" fill="#8a95a5"/><rect x="${rx}" y="${ly}" width="${colW}" height="1.4" fill="#8a95a5"/>`);
  p.push(text(F.sansBold, BRAND.ceo, L, ly + 30, 20, { fill: INK }));
  p.push(text(F.sans, `${BRAND.ceoTitle}, RTL`, L, ly + 56, 18, { fill: MUTED }));
  p.push(text(F.sansBold, `Accepted by: ${o.name}`, rx, ly + 30, 20, { fill: INK }));
  p.push(text(F.sans, o.acceptedAt ? `Date: ${longDate(o.acceptedAt)}` : 'Awaiting acceptance', rx, ly + 56, 18, { fill: MUTED }));
  if (o.stamp) p.push(`<image href="${png64(o.stamp)}" x="${L + 216}" y="${ly - 104}" width="180" height="180"/>`);

  const vy = Math.max(ly + 84, 1248);
  p.push(`<rect x="${L}" y="${vy - 12}" width="${TW}" height="1" fill="#dfe5ee"/>`);
  p.push(`<image href="${await qrDataUrl(o.verifyUrl)}" x="${L + TW - 68}" y="${vy}" width="68" height="68"/>`);
  const note = o.acceptedAt
    ? `Issued electronically by ${BRAND.legal}. The intern's signature is the one provided with their Non-Disclosure Agreement and was applied when they accepted this letter online on ${longDate(o.acceptedAt)}.`
    : `Issued electronically by ${BRAND.legal}. Not yet accepted by the intern.`;
  r = richPara([{ t: note }], L, vy + 16, TW - 92, 14.5, 20, { justify: false, fill: MUTED });
  p.push(r.svg);
  p.push(text(F.sans, 'Verify this letter: ', L, r.bottom + 22, 14.5, { fill: MUTED }) + text(F.sansMedium, o.verifyUrl, L + width(F.sans, 'Verify this letter: ', 14.5), r.bottom + 22, 14.5, { fill: BLUE }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${p.join('')}</svg>`;
}

/**
 * Social preview (1200 × 630): the actual document on a plain desk-grey background, like a scan.
 * Certificates fill the frame; letters sit on the left with the key details beside them.
 * @param o { kind, docPng, name, role, period, ref, valid }
 */
export async function previewSvg(o) {
  const W = 1200, H = 630;
  const m = await sharp(o.docPng).metadata();
  const p = [`<rect width="${W}" height="${H}" fill="#e7eaee"/>`];
  const shadow = (x, y, w, h) => `<rect x="${x + 3}" y="${y + 8}" width="${w}" height="${h}" fill="#0a1a3d" opacity=".16" filter="url(#sh)"/>`;
  if (o.kind === 'certificate') {
    const h = 566, w = Math.round((m.width / m.height) * h), x = (W - w) / 2, y = 30;
    p.push(shadow(x, y, w, h), `<image href="${png64(o.docPng)}" x="${x}" y="${y}" width="${w}" height="${h}"/>`);
  } else {
    const h = 582, w = Math.round((m.width / m.height) * h), x = 64, y = 24;
    p.push(shadow(x, y, w, h), `<image href="${png64(o.docPng)}" x="${x}" y="${y}" width="${w}" height="${h}"/>`);
    const tx = x + w + 64, maxW = W - tx - 56;
    p.push(text(F.sansSemi, 'Internship Joining Letter', tx, 190, 26, { fill: BLUE }));
    p.push(text(F.serif, o.name, tx, 262, fit(F.serif, o.name, 56, maxW), { fill: NAVY }));
    p.push(text(F.sansMedium, o.role, tx, 314, fit(F.sansMedium, o.role, 28, maxW), { fill: INK }));
    p.push(text(F.sans, o.period, tx, 354, fit(F.sans, o.period, 22, maxW), { fill: MUTED }));
    p.push(`<rect x="${tx}" y="392" width="${maxW}" height="1.5" fill="#c9d0da"/>`);
    p.push(text(F.sans, BRAND.legal, tx, 436, fit(F.sans, BRAND.legal, 20, maxW), { fill: INK }));
    p.push(text(F.sans, `Ref ${o.ref}`, tx, 470, 20, { fill: MUTED }));
    if (o.valid !== false) p.push(text(F.sansSemi, 'Verified record', tx, 520, 20, { fill: '#0f7a4d' }));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><filter id="sh" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter></defs>${p.join('')}</svg>`;
}

export const svgToPng = (svg, w) => sharp(Buffer.from(svg), { density: 96 }).resize({ width: w }).png({ compressionLevel: 9 }).toBuffer();
export { esc };
