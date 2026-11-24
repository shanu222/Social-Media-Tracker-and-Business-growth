import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { BRAND } from '../brand.js';
import { CERT_MIN_SCORE, durationText, longDate, roleTitle } from './letters.js';
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
  const months = durationText(i.start_date, i.end_date).replace(/ \(\d+\)/, '').toLowerCase().replace(/ months?$/, '-month');
  return `has successfully completed a ${months} remote internship as a ${roleTitle(i.role)} at ${BRAND.legal}, from ${longDate(i.start_date)} to ${longDate(i.cert_completed_on || i.end_date)}, with a performance score of ${CERT_MIN_SCORE}% or higher in every month.`;
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
    const scale = Math.min(330 / meta.width, 96 / meta.height);
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

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${gradient('g')}${gradient('g2')}</defs>${parts.join('')}</svg>`,
    width: W, height: H,
    // Where the link and QR sit, for clickable areas in the PDF (in SVG units)
    links: [{ x: sx + lw, y: H - 114, w: uw, h: 24 }, { x: rx + colW - qs, y: by - 118, w: qs, h: qs }],
  };
}

/**
 * Social preview / share image, 1200 × 630.
 * @param o { kind: 'certificate'|'letter', name, role, period, ref, valid }
 */
export async function shareCardSvg(o) {
  const W = 1200, H = 630;
  const logo = await logoDataUrl();
  const title = o.kind === 'certificate' ? 'Internship Completion Certificate' : 'Internship Joining Letter';
  const p = [];
  p.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  p.push(`<circle cx="1040" cy="300" r="300" fill="#ffffff" opacity="0.035"/><circle cx="1040" cy="300" r="210" fill="#ffffff" opacity="0.035"/>`);
  p.push(`<rect x="0" y="${H - 12}" width="${W}" height="12" fill="url(#g)"/>`);
  if (logo) p.push(`<image href="${logo}" x="64" y="56" width="84" height="84"/>`);
  p.push(text(F.sansSemi, 'Resilience Technologies Labs', 166, 94, 28, { fill: '#ffffff' }));
  p.push(text(F.sans, '(SMC-Private) Limited  ·  Islamabad, Pakistan', 166, 128, 19, { fill: '#a9b8d6' }));

  const badge = o.valid === false ? 'WITHDRAWN' : 'VERIFIED CREDENTIAL';
  const bw = width(F.sansBold, badge, 15, 0.14) + 44;
  p.push(`<rect x="${W - 64 - bw}" y="74" width="${bw}" height="40" rx="20" fill="${o.valid === false ? '#b8322a' : GREEN}"/>`);
  p.push(text(F.sansBold, badge, W - 64 - bw / 2, 100, 15, { anchor: 'middle', ls: 0.14, fill: '#ffffff' }));

  p.push(text(F.sansMedium, title.toUpperCase(), 64, 246, 22, { ls: 0.14, fill: '#7fd8f5' }));
  const ns = fit(F.serif, o.name, 78, W - 128);
  p.push(text(F.serif, o.name, 64, 338, ns, { fill: '#ffffff' }));
  p.push(text(F.sansMedium, o.role, 64, 400, 30, { fill: '#dce5f5' }));
  p.push(text(F.sans, o.period, 64, 444, 24, { fill: '#a9b8d6' }));

  p.push(`<rect x="64" y="496" width="${W - 128}" height="1.5" fill="#ffffff" opacity="0.16"/>`);
  p.push(text(F.sans, 'Credential ID', 64, 546, 18, { fill: '#a9b8d6' }));
  p.push(text(F.sansSemi, o.ref, 64, 576, 22, { fill: '#ffffff' }));
  p.push(text(F.sans, 'Issued by', W - 64, 546, 18, { anchor: 'end', fill: '#a9b8d6' }));
  p.push(text(F.sansSemi, `${BRAND.ceo}, ${BRAND.ceoTitle}`, W - 64, 576, 22, { anchor: 'end', fill: '#ffffff' }));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a1a3d"/><stop offset=".6" stop-color="#112a5e"/><stop offset="1" stop-color="#0d4f6b"/></linearGradient>
    ${gradient('g')}</defs>${p.join('')}</svg>`;
}

export const svgToPng = (svg, w) => sharp(Buffer.from(svg), { density: 96 }).resize({ width: w }).png({ compressionLevel: 9 }).toBuffer();
export { esc };
