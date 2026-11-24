import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { BRAND } from '../brand.js';
import SVGtoPDF from 'svg-to-pdfkit';
import { intro, letterTerms, longDate } from './letters.js';
import { certificateSvg } from './credentialArt.js';
import { stampPng, stampStyle } from './stamp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LETTERHEAD = path.resolve(here, '../../assets/letterhead.jpg');
const NAVY = '#0a1a3d', INK = '#1b2433', MUTED = '#5b6676', LINE = '#8a95a5', BLUE = '#1a5fe0';

/** "Label value" on one line with the value in bold, placed by measured width (left, right or centre aligned). */
function pair(doc, label, value, x, y, { size = 10, align = 'left', width = 0, color = INK, valueColor = INK, link } = {}) {
  doc.fontSize(size);
  const lw = doc.font('Helvetica').widthOfString(label), vw = doc.font('Helvetica-Bold').widthOfString(value);
  const sx = align === 'right' ? x + width - lw - vw : align === 'center' ? x + (width - lw - vw) / 2 : x;
  doc.font('Helvetica').fillColor(color).text(label, sx, y, { lineBreak: false, width: lw + 2 });
  doc.font(link ? 'Helvetica' : 'Helvetica-Bold').fillColor(valueColor).text(value, sx + lw, y, { lineBreak: false, link, width: vw + 2 });
}

function collect(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
const qr = (url) => QRCode.toBuffer(url, { margin: 0, width: 360, errorCorrectionLevel: 'M', color: { dark: NAVY, light: '#ffffff' } });

/**
 * Internship joining letter on the RTL letterhead.
 * @param o { intern, name, ndaSignedAt, ceoSig (png|null), memberSig (png|null), acceptedAt, verifyUrl }
 */
export async function renderJoiningLetter(o) {
  const { intern: i } = o;
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, info: { Title: `Internship Joining Letter — ${o.name}`, Author: BRAND.legal, Subject: i.letter_ref } });
  const out = collect(doc);
  const PW = doc.page.width, L = 54, W = PW - 108;
  if (fs.existsSync(LETTERHEAD)) doc.image(LETTERHEAD, 0, 0, { width: PW, height: doc.page.height });

  const body = (size = 10.5) => doc.font('Helvetica').fontSize(size).fillColor(INK);
  const bold = (size = 10.5) => doc.font('Helvetica-Bold').fontSize(size).fillColor(INK);
  const GAP = 1.0;

  // Reference and date
  let y = 182;
  pair(doc, 'Ref No: ', i.letter_ref, L, y);
  pair(doc, 'Date: ', longDate(i.letter_date), L, y, { align: 'right', width: W });
  y += 15;
  pair(doc, 'To: ', o.name, L, y);

  y += 22;
  bold(11).text('SUBJECT: INTERNSHIP JOINING LETTER', L, y, { width: W, align: 'center', underline: true });
  y = doc.y + 9;
  body().text(`Dear ${o.name},`, L, y);
  y = doc.y + 6;

  const t = intro(i);
  body().text(t.before, L, y, { width: W, align: 'justify', lineGap: GAP, continued: true })
    .font('Helvetica-Bold').text(t.company, { continued: true })
    .font('Helvetica').text(t.middle, { continued: true })
    .font('Helvetica-Bold').text(t.role, { continued: true })
    .font('Helvetica').text(t.after, { continued: true })
    .font('Helvetica-Bold').text(t.date, { continued: true })
    .font('Helvetica').text(t.end);
  y = doc.y + 6;

  letterTerms(i, o.ndaSignedAt).forEach(([label, text], n) => {
    body().text(`${n + 1}.`, L + 2, y, { width: 16 });
    bold().text(`${label}: `, L + 18, y, { width: W - 18, align: 'justify', lineGap: GAP, continued: true })
      .font('Helvetica').text(text);
    y = doc.y + 2.5;
  });

  y += 3;
  body().text('Welcome to the RTL team. Your electronic acceptance below confirms that you have read and agree to these terms.', L, y, { width: W, align: 'justify', lineGap: GAP });

  // Signatures
  const sy = doc.y + 6;
  const colW = 190, rx = L + W - colW;
  if (o.ceoSig) doc.image(o.ceoSig, L, sy, { fit: [170, 46], align: 'left', valign: 'bottom' });
  if (o.memberSig && o.acceptedAt) doc.image(o.memberSig, rx, sy, { fit: [170, 46], align: 'left', valign: 'bottom' });
  const ly = sy + 49;
  doc.moveTo(L, ly).lineTo(L + colW, ly).moveTo(rx, ly).lineTo(rx + colW, ly).strokeColor(LINE).lineWidth(0.7).stroke();
  bold(10).text(BRAND.ceo, L, ly + 4, { width: colW });
  body(9.5).fillColor(MUTED).text(`${BRAND.ceoTitle}, RTL`, L, doc.y + 1, { width: colW });
  bold(10).text(`Accepted by: ${o.name}`, rx, ly + 4, { width: colW });
  body(9.5).fillColor(MUTED).text(o.acceptedAt ? `Date: ${longDate(o.acceptedAt)}` : 'Awaiting acceptance', rx, doc.y + 1, { width: colW });
  // Company stamp over the CEO's signature, as on a hand-stamped letter
  doc.image(await stampPng({ size: 520, ...stampStyle(i.letter_ref) }), L + 108, ly - 52, { width: 90, height: 90 });

  // Verification
  const vy = Math.max(doc.y + 7, 624), qs = 34;
  doc.moveTo(L, vy - 6).lineTo(L + W, vy - 6).strokeColor('#dfe5ee').lineWidth(0.5).stroke();
  doc.image(await qr(o.verifyUrl), L + W - qs, vy, { width: qs, height: qs });
  const note = o.acceptedAt
    ? `Issued electronically by ${BRAND.legal}. The intern's signature is the one provided with their Non-Disclosure Agreement and was applied when they accepted this letter online on ${longDate(o.acceptedAt)}.`
    : `Issued electronically by ${BRAND.legal}. Not yet accepted by the intern.`;
  body(7.5).fillColor(MUTED).text(note, L, vy, { width: W - qs - 12, lineGap: 0.5 });
  pair(doc, 'Verify this letter: ', o.verifyUrl, L, doc.y + 2, { size: 7.5, color: MUTED, valueColor: BLUE, link: o.verifyUrl });

  doc.end();
  return out;
}

/**
 * Internship completion certificate (A4 landscape), drawn from the same artwork as the public credential page.
 * @param o { intern, name, ceoSig (png|null), verifyUrl }
 */
export async function renderCertificate(o) {
  const { intern: i } = o;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Internship Certificate — ${o.name}`, Author: BRAND.legal, Subject: i.cert_ref, Keywords: o.verifyUrl } });
  const out = collect(doc);
  const PW = doc.page.width, PH = doc.page.height;
  const art = await certificateSvg(o);
  const k = PW / art.width;
  SVGtoPDF(doc, art.svg, 0, 0, { width: PW, height: PH, preserveAspectRatio: 'xMidYMid meet', assumePt: true });
  for (const l of art.links) doc.link(l.x * k, l.y * k, l.w * k, l.h * k, o.verifyUrl);
  doc.end();
  return out;
}
