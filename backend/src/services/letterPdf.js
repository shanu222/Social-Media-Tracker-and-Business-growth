import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { BRAND } from '../brand.js';
import { intro, letterTerms, longDate, durationText, roleTitle } from './letters.js';

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
  const GAP = 1.6;

  // Reference and date
  let y = 182;
  pair(doc, 'Ref No: ', i.letter_ref, L, y);
  pair(doc, 'Date: ', longDate(i.letter_date), L, y, { align: 'right', width: W });
  y += 15;
  pair(doc, 'To: ', o.name, L, y);

  y += 22;
  bold(11).text('SUBJECT: INTERNSHIP JOINING LETTER', L, y, { width: W, align: 'center', underline: true });
  y = doc.y + 12;
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
    y = doc.y + 3.5;
  });

  y += 4;
  body().text('Welcome to the RTL team. Your electronic acceptance below confirms that you have read and agree to these terms.', L, y, { width: W, align: 'justify', lineGap: GAP });

  // Signatures
  const sy = doc.y + 6;
  const colW = 190, rx = L + W - colW;
  if (o.ceoSig) doc.image(o.ceoSig, L, sy, { fit: [140, 36], align: 'left', valign: 'bottom' });
  if (o.memberSig && o.acceptedAt) doc.image(o.memberSig, rx, sy, { fit: [140, 36], align: 'left', valign: 'bottom' });
  const ly = sy + 39;
  doc.moveTo(L, ly).lineTo(L + colW, ly).moveTo(rx, ly).lineTo(rx + colW, ly).strokeColor(LINE).lineWidth(0.7).stroke();
  bold(10).text(BRAND.ceo, L, ly + 4, { width: colW });
  body(9.5).fillColor(MUTED).text(`${BRAND.ceoTitle}, RTL`, L, doc.y + 1, { width: colW });
  bold(10).text(`Accepted by: ${o.name}`, rx, ly + 4, { width: colW });
  body(9.5).fillColor(MUTED).text(o.acceptedAt ? `Date: ${longDate(o.acceptedAt)}` : 'Awaiting acceptance', rx, doc.y + 1, { width: colW });

  // Verification
  const vy = Math.max(doc.y + 9, 630), qs = 34;
  doc.moveTo(L, vy - 6).lineTo(L + W, vy - 6).strokeColor('#dfe5ee').lineWidth(0.5).stroke();
  doc.image(await qr(o.verifyUrl), L + W - qs, vy, { width: qs, height: qs });
  const note = o.acceptedAt
    ? `Issued electronically by ${BRAND.legal}. The intern's signature is the one provided with their Non-Disclosure Agreement and was applied when they accepted this letter in Growth Desk on ${longDate(o.acceptedAt)}.`
    : `Issued electronically by ${BRAND.legal}. Not yet accepted by the intern.`;
  body(7.5).fillColor(MUTED).text(note, L, vy, { width: W - qs - 12, lineGap: 0.5 });
  pair(doc, 'Verify this letter: ', o.verifyUrl, L, doc.y + 2, { size: 7.5, color: MUTED, valueColor: BLUE, link: o.verifyUrl });

  doc.end();
  return out;
}

/**
 * Internship completion certificate (A4 landscape).
 * @param o { intern, name, ceoSig (png|null), verifyUrl }
 */
export async function renderCertificate(o) {
  const { intern: i } = o;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Internship Certificate — ${o.name}`, Author: BRAND.legal, Subject: i.cert_ref } });
  const out = collect(doc);
  const PW = doc.page.width, PH = doc.page.height, cx = PW / 2;
  const hasLogo = fs.existsSync(BRAND.logo);

  // Frame
  doc.rect(0, 0, PW, PH).fill('#ffffff');
  if (hasLogo) { doc.save().opacity(0.04).image(BRAND.logo, cx - 150, PH / 2 - 130, { width: 300, height: 300 }).restore(); }
  doc.rect(18, 18, PW - 36, PH - 36).lineWidth(2).strokeColor(NAVY).stroke();
  doc.rect(26, 26, PW - 52, PH - 52).lineWidth(0.7).strokeColor('#12b5e8').stroke();
  const g = doc.linearGradient(26, 0, PW - 26, 0); g.stop(0, '#1a5fe0').stop(0.5, '#12b5e8').stop(1, '#16b97a');
  doc.rect(26, 26, PW - 52, 5).fill(g);
  doc.rect(26, PH - 31, PW - 52, 5).fill(g);
  // Corner accents
  for (const [x, y, sx, sy] of [[34, 39, 1, 1], [PW - 34, 39, -1, 1], [34, PH - 39, 1, -1], [PW - 34, PH - 39, -1, -1]]) {
    doc.moveTo(x, y + sy * 34).lineTo(x, y).lineTo(x + sx * 34, y).lineWidth(2).strokeColor('#16b97a').stroke();
  }

  // Heading
  if (hasLogo) doc.image(BRAND.logo, cx - 29, 50, { width: 58, height: 58 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(BRAND.legal.toUpperCase(), 0, 114, { width: PW, align: 'center', characterSpacing: 1.6 });
  doc.font('Times-Bold').fontSize(38).fillColor(NAVY).text('CERTIFICATE', 0, 140, { width: PW, align: 'center', characterSpacing: 7 });
  doc.font('Helvetica').fontSize(11.5).fillColor(BLUE).text('OF INTERNSHIP COMPLETION', 0, 184, { width: PW, align: 'center', characterSpacing: 4.5 });

  doc.font('Times-Italic').fontSize(14).fillColor(MUTED).text('This is to certify that', 0, 222, { width: PW, align: 'center' });
  doc.font('Times-Bold').fontSize(31).fillColor(NAVY).text(o.name, 60, 244, { width: PW - 120, align: 'center' });
  const ny = doc.y + 4;
  const ng = doc.linearGradient(cx - 150, 0, cx + 150, 0); ng.stop(0, '#1a5fe0').stop(1, '#16b97a');
  doc.rect(cx - 150, ny, 300, 1.6).fill(ng);

  const months = durationText(i.start_date, i.end_date).replace(/ \(\d+\)/, '').toLowerCase().replace(' months', '-month').replace(' month', '-month');
  doc.font('Helvetica').fontSize(12.5).fillColor(INK).text(
    `has successfully completed a ${months} remote internship as a ${roleTitle(i.role)} at ${BRAND.legal}, from ${longDate(i.start_date)} to ${longDate(i.cert_completed_on || i.end_date)}.`,
    110, ny + 16, { width: PW - 220, align: 'center', lineGap: 3 }
  );
  if (i.cert_remark) doc.font('Times-Italic').fontSize(12.5).fillColor(MUTED).text(`“${i.cert_remark.trim().replace(/[.]?$/, '.')}”`, 130, doc.y + 8, { width: PW - 260, align: 'center', lineGap: 2 });
  const first = o.name.split(/\s+/)[0];
  doc.font('Helvetica').fontSize(12.5).fillColor(INK).text(`We thank ${first} for their dedication and contribution, and wish them every success in the future.`, 110, doc.y + 8, { width: PW - 220, align: 'center', lineGap: 3 });

  // Signature, seal and verification
  const by = 452;
  const lx = 92, colW = 200;
  if (o.ceoSig) doc.image(o.ceoSig, lx + 10, by - 2, { fit: [170, 46], align: 'center', valign: 'bottom' });
  doc.moveTo(lx, by + 48).lineTo(lx + colW, by + 48).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(BRAND.ceo, lx, by + 54, { width: colW, align: 'center' });
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(`${BRAND.ceoTitle}, RTL`, lx, doc.y + 1, { width: colW, align: 'center' });

  // Seal
  const sx = cx, sy = by + 36;
  doc.circle(sx, sy, 44).lineWidth(1.6).strokeColor(NAVY).stroke();
  doc.circle(sx, sy, 39).lineWidth(0.6).strokeColor('#12b5e8').stroke();
  if (hasLogo) doc.image(BRAND.logo, sx - 25, sy - 33, { width: 50, height: 50 });
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(NAVY).text('OFFICIAL', sx - 40, sy + 24, { width: 80, align: 'center', characterSpacing: 1.5 });

  const rx = PW - 92 - colW, qs = 58;
  doc.image(await qr(o.verifyUrl), rx + colW - qs, by - 6, { width: qs, height: qs });
  const meta = (k, v, y) => {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k, rx, y, { width: colW - qs - 10 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(v, rx, doc.y + 0.5, { width: colW - qs - 10 });
  };
  meta('Certificate No.', i.cert_ref, by - 4);
  meta('Issued on', longDate(i.cert_issued_on), doc.y + 5);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Scan the code or visit the link below to verify this certificate.', rx, by + 62, { width: colW });

  pair(doc, 'Verify this certificate: ', o.verifyUrl, 0, PH - 50, { size: 8, align: 'center', width: PW, color: MUTED, valueColor: BLUE, link: o.verifyUrl });
  doc.end();
  return out;
}
