import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { BRAND } from '../brand.js';
import { NDA_TITLE, NDA_VERSION, ndaSections } from './nda.js';

/** The signed agreement as a branded PDF: letterhead, full text, signature block, evidence footer, watermark. */
export function renderNdaPdf(sig, signatureBuf) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 70, left: 56, right: 56 }, bufferPages: true, info: { Title: `${NDA_TITLE} — ${sig.full_name}`, Author: BRAND.legal } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const L = 56, W = doc.page.width - 112;
    const hasLogo = fs.existsSync(BRAND.logo);
    const signed = new Date(sig.signed_at);
    const dateText = signed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });

    // Letterhead
    if (hasLogo) doc.image(BRAND.logo, L, 44, { width: 54, height: 54 });
    doc.fillColor('#0a1a3d').font('Helvetica-Bold').fontSize(13).text(BRAND.legal, L + 66, 50, { width: W - 66 });
    doc.fillColor('#5b6676').font('Helvetica').fontSize(8.5).text(`${BRAND.email}  ·  ${BRAND.phone}  ·  ${BRAND.website}`, L + 66, doc.y + 3, { width: W - 66 });
    const g = doc.linearGradient(L, 108, L + W, 108); g.stop(0, '#1a5fe0').stop(0.5, '#12b5e8').stop(1, '#16b97a');
    doc.rect(L, 108, W, 3).fill(g);
    doc.fillColor('#0f1b33').font('Helvetica-Bold').fontSize(16).text(NDA_TITLE, L, 128, { width: W, align: 'center' });
    doc.fillColor('#5b6676').font('Helvetica').fontSize(9).text(`Signed on ${dateText}  ·  Version ${NDA_VERSION}`, L, doc.y + 4, { width: W, align: 'center' });
    doc.moveDown(1.2);

    for (const s of ndaSections({ name: sig.full_name + (sig.guardian ? ` (${sig.guardian})` : ''), cnic: sig.cnic, role: sig.role_title || 'Team Member' })) {
      if (doc.y > doc.page.height - 140) doc.addPage();
      if (s.heading) doc.fillColor('#0f1b33').font('Helvetica-Bold').fontSize(10.5).text(s.heading, L, doc.y, { width: W }).moveDown(0.25);
      doc.fillColor('#1b2433').font('Helvetica').fontSize(10).text(s.body, L, doc.y, { width: W, align: 'justify', lineGap: 2 }).moveDown(0.7);
    }

    // Signature block
    if (doc.y > doc.page.height - 230) doc.addPage();
    doc.moveDown(0.6);
    const y0 = doc.y;
    const colW = (W - 30) / 2;
    doc.roundedRect(L, y0, colW, 176, 6).strokeColor('#dfe5ee').lineWidth(1).stroke();
    doc.fillColor('#5b6676').font('Helvetica-Bold').fontSize(8.5).text('TEAM MEMBER', L + 12, y0 + 10);
    try { doc.image(signatureBuf, L + 12, y0 + 26, { fit: [colW - 24, 56], align: 'left' }); } catch { doc.fillColor('#c2372f').fontSize(9).text('[signature image]', L + 12, y0 + 40); }
    doc.moveTo(L + 12, y0 + 88).lineTo(L + colW - 12, y0 + 88).strokeColor('#8a95a5').lineWidth(0.6).stroke();
    doc.fillColor('#0f1b33').font('Helvetica-Bold').fontSize(10).text(sig.full_name, L + 12, y0 + 94, { width: colW - 24 });
    doc.fillColor('#1b2433').font('Helvetica').fontSize(9)
      .text(sig.guardian || ' ', L + 12, doc.y + 1, { width: colW - 24 })
      .text(`CNIC: ${sig.cnic}`, { width: colW - 24 })
      .text(`Role: ${sig.role_title || 'Team Member'}`, { width: colW - 24 })
      .text(sig.phone ? `Mobile: ${sig.phone}` : ' ', { width: colW - 24 })
      .text(`Date: ${dateText}`, { width: colW - 24 });

    const x2 = L + colW + 30;
    doc.roundedRect(x2, y0, colW, 176, 6).strokeColor('#dfe5ee').lineWidth(1).stroke();
    doc.fillColor('#5b6676').font('Helvetica-Bold').fontSize(8.5).text('FOR THE COMPANY', x2 + 12, y0 + 10);
    if (hasLogo) doc.image(BRAND.logo, x2 + 12, y0 + 28, { width: 48, height: 48 });
    doc.moveTo(x2 + 12, y0 + 88).lineTo(x2 + colW - 12, y0 + 88).strokeColor('#8a95a5').lineWidth(0.6).stroke();
    doc.fillColor('#0f1b33').font('Helvetica-Bold').fontSize(10).text(BRAND.ceo, x2 + 12, y0 + 94, { width: colW - 24 });
    doc.fillColor('#1b2433').font('Helvetica').fontSize(9).text(BRAND.ceoTitle, x2 + 12, doc.y + 2, { width: colW - 24 }).text(BRAND.legal, { width: colW - 24 });
    doc.y = y0 + 190;
    doc.fillColor('#8a95a5').font('Helvetica').fontSize(7.5).text(
      `Signed electronically in ${BRAND.app} on ${signed.toISOString().replace('T', ' ').slice(0, 19)} UTC from IP ${sig.ip || 'unknown'}. Document fingerprint (SHA-256): ${sig.doc_hash}`,
      L, doc.y, { width: W }
    );
    if (sig.typed_name) doc.text(`Typed name as signature: "${sig.typed_name}".`, L, doc.y + 2, { width: W });

    // Annex A: identity details and CNIC images
    if (sig.cnicFront || sig.cnicBack || sig.address) {
      doc.addPage();
      doc.fillColor('#0f1b33').font('Helvetica-Bold').fontSize(14).text('Annex A — Identity verification', L, 56, { width: W });
      doc.fillColor('#5b6676').font('Helvetica').fontSize(9).text('Provided by the Team Member when signing. Confidential: for verification by the Company only.', L, doc.y + 2, { width: W });
      doc.moveDown(0.8);
      const row = (k, v) => { const y = doc.y; doc.fillColor('#5b6676').font('Helvetica').fontSize(10).text(k, L, y, { width: 110 }); doc.fillColor('#0f1b33').font('Helvetica-Bold').text(v || '—', L + 115, y, { width: W - 115 }); doc.moveDown(0.35); };
      row('Full name', sig.full_name + (sig.guardian ? ` (${sig.guardian})` : ''));
      row('CNIC', sig.cnic);
      row('Mobile', sig.phone);
      row('Address', sig.address);
      row('Signed', `${dateText} · IP ${sig.ip || 'unknown'}`);
      doc.moveDown(0.6);
      const boxW = (W - 20) / 2, boxH = boxW * 0.66, by = doc.y;
      [['CNIC — front', sig.cnicFront], ['CNIC — back', sig.cnicBack]].forEach(([label, buf], i) => {
        const bx = L + i * (boxW + 20);
        doc.fillColor('#5b6676').font('Helvetica-Bold').fontSize(8.5).text(String(label).toUpperCase(), bx, by, { width: boxW });
        doc.roundedRect(bx, by + 14, boxW, boxH, 6).strokeColor('#dfe5ee').lineWidth(1).stroke();
        if (buf) { try { doc.image(buf, bx + 6, by + 20, { fit: [boxW - 12, boxH - 12], align: 'center', valign: 'center' }); } catch { /* unreadable image */ } }
      });
      doc.y = by + boxH + 30;
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      const cx = doc.page.width / 2, cy = doc.page.height / 2;
      doc.save();
      if (hasLogo) { doc.opacity(0.035); doc.image(BRAND.logo, cx - 130, cy - 130, { width: 260, height: 260 }); }
      doc.opacity(0.05).fillColor('#0a1a3d').font('Helvetica-Bold').fontSize(34).rotate(-35, { origin: [cx, cy] });
      doc.text('CONFIDENTIAL', cx - 250, cy - 18, { width: 500, align: 'center', characterSpacing: 6, lineBreak: false });
      doc.restore();
      const fy = doc.page.height - 44;
      doc.moveTo(L, fy - 8).lineTo(L + W, fy - 8).strokeColor('#dfe5ee').lineWidth(0.6).stroke();
      doc.fillColor('#5b6676').font('Helvetica').fontSize(7.5).text(`${BRAND.legal}  ·  ${NDA_TITLE}  ·  ${sig.full_name}`, L, fy, { width: W - 80, lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, L + W - 80, fy, { width: 80, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
