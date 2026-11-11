import PDFDocument from 'pdfkit';

const INK = '#16202E';
const MUTED = '#5B6676';
const LINE = '#D9DEE5';
const GOOD = '#0E7C66';
const BAD = '#B83A32';
const ACCENT = '#2F45A8';

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
const signed = (n) => (n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + Number(n).toLocaleString('en-US'));

/** Render a saved report's data to a PDF Buffer. */
export function renderReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: report.title } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const d = report.data;
    const W = doc.page.width - 96;
    const left = 48;

    const ensure = (h) => {
      if (doc.y + h > doc.page.height - 60) doc.addPage();
    };

    const heading = (t) => {
      ensure(60);
      doc.moveDown(1.1);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(t, left);
      doc.moveTo(left, doc.y + 3).lineTo(left + W, doc.y + 3).strokeColor(LINE).lineWidth(1).stroke();
      doc.moveDown(0.6);
    };

    const table = (cols, rows) => {
      const rowH = 18;
      ensure(rowH * 2);
      let y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
      let x = left;
      cols.forEach((c) => {
        doc.text(c.label, x + 2, y, { width: c.w - 4, align: c.align || 'left' });
        x += c.w;
      });
      y += rowH - 4;
      doc.moveTo(left, y).lineTo(left + W, y).strokeColor(LINE).stroke();
      y += 4;
      doc.font('Helvetica').fontSize(9);
      for (const r of rows) {
        const h = Math.max(
          rowH,
          ...cols.map((c) => doc.heightOfString(String(r[c.key] ?? '—'), { width: c.w - 4 }) + 6)
        );
        if (y + h > doc.page.height - 60) {
          doc.addPage();
          y = doc.y;
        }
        x = left;
        cols.forEach((c) => {
          const val = r[c.key] ?? '—';
          doc.fillColor(c.color ? c.color(r) : INK).text(String(val), x + 2, y, { width: c.w - 4, align: c.align || 'left' });
          x += c.w;
        });
        y += h;
      }
      doc.y = y + 4;
      doc.x = left;
    };

    // Header
    doc.rect(0, 0, doc.page.width, 92).fill(INK);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text(report.title, left, 30, { width: W });
    doc.font('Helvetica').fontSize(10).fillColor('#C9D2DE')
      .text(`${d.range.start} to ${d.range.end}   |   Generated ${new Date(report.created_at || Date.now()).toISOString().slice(0, 10)}`, left, 60);
    doc.y = 112;

    // Headline numbers
    const t = d.totals;
    const stats = [
      ['Total followers', fmt(t.end_followers)],
      ['Net change', `${signed(t.net_change)}${t.growth_pct !== null ? ` (${t.growth_pct}%)` : ''}`],
      ['Posts published', fmt(t.posts_added)],
      ['Engagement rate', t.engagement_rate !== null ? `${t.engagement_rate}%` : '—'],
    ];
    const cw = W / 4;
    stats.forEach(([label, value], i) => {
      const x = left + i * cw;
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(label, x, 112, { width: cw - 8 });
      doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(value, x, 126, { width: cw - 8 });
    });
    doc.y = 156;
    doc.x = left;
    const extra = [
      `Reach ${fmt(t.reach)}`,
      `Impressions ${fmt(t.impressions)}`,
      `DM response ${t.response_rate !== null ? t.response_rate + '%' : '—'}`,
      `Checklist ${d.checklist?.pct !== null && d.checklist?.pct !== undefined ? d.checklist.pct + '%' : '—'}`,
      `2FA coverage ${t.two_factor_coverage !== null ? t.two_factor_coverage + '%' : '—'}`,
    ];
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(extra.join('    '), left, doc.y, { width: W });

    heading('Growth by account');
    table(
      [
        { key: 'brand', label: 'Account', w: W * 0.24 },
        { key: 'start', label: 'Start', w: W * 0.1, align: 'right' },
        { key: 'end', label: 'End', w: W * 0.1, align: 'right' },
        { key: 'net', label: 'Net', w: W * 0.1, align: 'right', color: (r) => (r._net > 0 ? GOOD : r._net < 0 ? BAD : INK) },
        { key: 'growth', label: 'Growth', w: W * 0.1, align: 'right' },
        { key: 'posts', label: 'Posts', w: W * 0.09, align: 'right' },
        { key: 'reach', label: 'Reach', w: W * 0.1, align: 'right' },
        { key: 'er', label: 'Eng. %', w: W * 0.09, align: 'right' },
        { key: 'rating', label: 'Rating', w: W * 0.08, align: 'right' },
      ],
      d.accounts.map((a) => ({
        brand: `${a.brand}\n@${a.username}`,
        start: fmt(a.start_followers),
        end: fmt(a.end_followers),
        net: signed(a.net_change),
        _net: a.net_change,
        growth: a.growth_pct !== null ? `${a.growth_pct}%` : '—',
        posts: fmt(a.posts_added),
        reach: fmt(a.reach),
        er: a.engagement_rate !== null ? `${a.engagement_rate}` : '—',
        rating: a.rating ? `${a.rating}/5` : '—',
      }))
    );

    if (d.kpis?.length) {
      heading('Key numbers');
      table(
        [
          { key: 'name', label: 'Metric', w: W * 0.36 },
          { key: 'target', label: 'Target', w: W * 0.14, align: 'right' },
          { key: 'value', label: 'Actual', w: W * 0.14, align: 'right' },
          { key: 'previous', label: 'Last period', w: W * 0.16, align: 'right' },
          { key: 'status', label: 'Status', w: W * 0.2, color: (r) => (r.status === 'On track' ? GOOD : r.status === 'Off track' ? BAD : MUTED) },
        ],
        d.kpis.map((k) => ({
          name: k.unit ? `${k.name} (${k.unit})` : k.name,
          target: fmt(k.target),
          value: fmt(k.value),
          previous: fmt(k.previous),
          status: k.status === 'on' ? 'On track' : k.status === 'off' ? 'Off track' : '—',
        }))
      );
    }

    if (d.insights?.length) {
      heading('What the numbers say');
      d.insights.forEach((i) => {
        ensure(30);
        const c = i.tone === 'good' ? GOOD : i.tone === 'risk' || i.tone === 'warn' ? BAD : ACCENT;
        doc.circle(left + 3, doc.y + 5, 2.5).fill(c);
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(i.text, left + 12, doc.y, { width: W - 12 });
        doc.moveDown(0.4);
      });
    }

    const reviews = (d.reviews || []).filter((r) => r.best_post || r.weakest || r.fix_next || r.why_worked);
    if (reviews.length) {
      heading('Account-wise analysis');
      table(
        [
          { key: 'brand', label: 'Account', w: W * 0.16 },
          { key: 'best_post', label: 'Best post', w: W * 0.21 },
          { key: 'why_worked', label: 'Why it worked', w: W * 0.21 },
          { key: 'weakest', label: 'Weakest / issue', w: W * 0.21 },
          { key: 'fix_next', label: 'Fix for next month', w: W * 0.21 },
        ],
        reviews
      );
    }

    const s = d.summary;
    if (s && (s.what_worked || s.what_didnt || s.what_change)) {
      heading('Overall summary');
      [['What worked', s.what_worked], ['What did not', s.what_didnt], ['What to change', s.what_change]].forEach(([l, v]) => {
        if (!v) return;
        ensure(40);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(l, left);
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(v, left, doc.y, { width: W });
        doc.moveDown(0.5);
      });
    }

    if (d.actions?.length) {
      heading('Action plan');
      table(
        [
          { key: 'title', label: 'Action', w: W * 0.44 },
          { key: 'brand', label: 'Account', w: W * 0.18 },
          { key: 'owner', label: 'Owner', w: W * 0.14 },
          { key: 'deadline', label: 'Deadline', w: W * 0.14 },
          { key: 'done', label: 'Done', w: W * 0.1 },
        ],
        d.actions.map((a) => ({ ...a, brand: a.brand || 'All', done: a.done ? 'Yes' : 'No' }))
      );
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(`Confidential — ${report.title} — page ${i + 1} of ${range.count}`, left, doc.page.height - 36, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
