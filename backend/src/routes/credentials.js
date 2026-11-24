import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router } from 'express';
import sharp from 'sharp';
import { one } from '../db.js';
import { ah } from '../util.js';
import { BRAND } from '../brand.js';
import { INTERN_COLS, CERT_MIN_SCORE, getCompanySignature, longDate, roleTitle, durationText } from '../services/letters.js';
import { certificateSvg, shareCardSvg, svgToPng, esc } from '../services/credentialArt.js';
import { credentialsBase, credentialUrl, linkedinAddUrl, captions } from '../services/credentialLinks.js';

/*
 * Public credential pages (no sign-in), like the verification pages of online course certificates:
 *   /verify                 look up a code
 *   /verify/<code>          the official record of a letter or certificate, with share buttons
 *   /verify/<code>/image.png        social preview card (1200×630)
 *   /verify/<code>/certificate.png  the full certificate image
 * They never mention the internal workspace, and they keep working for as long as the record exists.
 */
const router = Router();

const normCode = (raw) => {
  const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}` : null;
};

async function lookup(code) {
  if (!code) return null;
  const i = await one(`SELECT ${INTERN_COLS} FROM internships i WHERE i.letter_code = $1 OR i.cert_code = $1`, [code]);
  if (!i) return null;
  const n = await one(
    'SELECT full_name FROM nda_signatures WHERE user_id = $1 ORDER BY (superseded_at IS NULL) DESC, signed_at DESC LIMIT 1', [i.user_id]
  ) || await one('SELECT name AS full_name FROM users WHERE id = $1', [i.user_id]);
  const isCert = i.cert_code === code;
  return {
    i, isCert, name: n?.full_name || 'RTL Intern',
    valid: isCert ? !i.cert_revoked_at : true,
    ref: isCert ? i.cert_ref : i.letter_ref,
    period: `${longDate(i.start_date)} – ${longDate(isCert ? i.cert_completed_on || i.end_date : i.end_date)}`,
    issued: isCert ? i.cert_issued_on : i.letter_date,
    stamp: `${i.updated_at?.toISOString?.() || ''}`,
  };
}

// Rendered images are cached briefly in memory (they only change when the record changes)
const cache = new Map();
async function cached(key, make) {
  if (cache.has(key)) return cache.get(key);
  const v = await make();
  cache.set(key, v);
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  return v;
}

const LOGO_URI = '/verify/assets/logo.png';
let logoPng = null;
router.get('/assets/logo.png', ah(async (_req, res) => {
  if (!logoPng && fs.existsSync(BRAND.logo)) logoPng = await sharp(BRAND.logo).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  if (!logoPng) return res.status(404).end();
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.type('png').send(logoPng);
}));

function securityHeaders(res, nonce) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'", "img-src 'self' data:", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com', `script-src 'nonce-${nonce}'`, "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

const ICONS = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>',
  xsocial: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.8h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88zm8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41z"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const STYLE = `
:root{--navy:#0a1a3d;--ink:#17223a;--muted:#5b6676;--line:#e2e7ee;--bg:#f3f5f9;--blue:#1a5fe0;--green:#12925d;--red:#b8322a}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif}
a{color:var(--blue)}
.top{background:var(--navy);color:#fff}
.top-in{max-width:1160px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:12px}
.top img{width:40px;height:40px}
.top b{display:block;font-size:15px;font-weight:600}.top span{display:block;font-size:12.5px;color:#a9b8d6}
.top a.lookup{margin-left:auto;color:#dce5f5;font-size:13.5px;text-decoration:none;border:1px solid rgba(255,255,255,.25);padding:7px 12px;border-radius:8px;white-space:nowrap}
.top a.lookup:hover{background:rgba(255,255,255,.08)}
.bar{height:4px;background:linear-gradient(90deg,#1a5fe0,#12b5e8,#16b97a)}
main{max-width:1160px;margin:0 auto;padding:26px 20px 40px}
.status{display:flex;gap:14px;align-items:flex-start;padding:16px 18px;border-radius:12px;background:#e6f5ee;border:1px solid #bfe5d2;margin-bottom:22px}
.status.bad{background:#fdecea;border-color:#f3c5c0}
.status .ic{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--green);color:#fff}
.status.bad .ic{background:var(--red)}.status .ic svg{width:19px;height:19px}
.status h1{margin:0 0 2px;font-size:18px;line-height:1.3}.status p{margin:0;color:#365046;font-size:14px}.status.bad p{color:#6d2c27}
.grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(0,1fr);gap:22px;align-items:start}
.art{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px;box-shadow:0 10px 30px rgba(10,26,61,.07);position:relative}
.art img{display:block;width:100%;height:auto;border-radius:6px}
.art.void img{filter:grayscale(1);opacity:.55}
.art .stamp{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.art .stamp span{border:4px solid var(--red);color:var(--red);font-weight:800;letter-spacing:.2em;font-size:clamp(20px,4vw,40px);padding:6px 18px;transform:rotate(-12deg);background:rgba(255,255,255,.85)}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px}
.kind{color:var(--blue);font-weight:600;font-size:13px;margin:0 0 4px}
.name{font-family:"Playfair Display",Georgia,serif;font-size:30px;line-height:1.15;margin:0 0 4px;color:var(--navy)}
.role{color:var(--muted);margin:0 0 18px}
dl{display:grid;grid-template-columns:118px minmax(0,1fr);gap:10px 14px;margin:0;padding:16px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:14px}
dt{color:var(--muted)}dd{margin:0;font-weight:600;overflow-wrap:anywhere}
.share{margin-top:18px}.share h2{font-size:14px;margin:0 0 10px}
.btns{display:flex;flex-wrap:wrap;gap:8px}
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 12px;border-radius:9px;border:1px solid var(--line);background:#fff;color:var(--ink);font:inherit;font-size:13.5px;font-weight:500;text-decoration:none;cursor:pointer}
.btn:hover{border-color:#c4ccd6;background:#f8fafc}.btn:focus-visible,input:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.btn svg{width:16px;height:16px;flex:none}
.btn.primary{background:#0a66c2;border-color:#0a66c2;color:#fff}.btn.primary:hover{background:#09579f}
.btn .li{color:#0a66c2}.btn .fb{color:#1877f2}.btn .wa{color:#25d366}
.follow{margin:12px 0 0;font-size:13px;color:var(--muted)}
.note{margin-top:22px;padding:14px 16px;border-radius:10px;background:#fff;border:1px solid var(--line);color:var(--muted);font-size:13px}
.note b{color:var(--ink)}
footer{max-width:1160px;margin:0 auto;padding:0 20px 34px;color:var(--muted);font-size:12.5px;display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:space-between}
.lookup-box{max-width:520px;margin:30px auto;background:#fff;border:1px solid var(--line);border-radius:14px;padding:26px}
.lookup-box h1{font-family:"Playfair Display",Georgia,serif;font-size:28px;margin:0 0 6px;color:var(--navy)}
.lookup-box p{color:var(--muted);margin:0 0 16px}
.lookup-box form{display:flex;gap:8px}
.lookup-box input{flex:1;min-width:0;padding:11px 12px;border:1px solid #cfd6e0;border-radius:9px;font:inherit;font-size:16px;letter-spacing:.06em;text-transform:uppercase}
.lookup-box button{padding:11px 16px;border:0;border-radius:9px;background:var(--navy);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.lookup-box .err{color:var(--red);font-size:14px;margin:12px 0 0}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:var(--navy);color:#fff;padding:10px 16px;border-radius:9px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.on{opacity:1}
@media (max-width:860px){.grid{grid-template-columns:minmax(0,1fr)}.name{font-size:26px}dl{grid-template-columns:104px minmax(0,1fr)}}
@media (max-width:480px){.top a.lookup{display:none}.lookup-box form{flex-direction:column}}
@media (prefers-reduced-motion:reduce){.toast{transition:none}}
`;

function page({ title, head = '', body, nonce, script = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex,nofollow">
<link rel="icon" type="image/png" href="${LOGO_URI}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
${head}<style>${STYLE}</style></head><body>
<header class="top"><div class="top-in"><img src="${LOGO_URI}" alt="RTL"><div><b>${esc(BRAND.legal)}</b><span>Credential verification</span></div><a class="lookup" href="/verify">Verify another credential</a></div></header><div class="bar"></div>
${body}
<footer><span>© ${new Date().getFullYear()} ${esc(BRAND.legal)}</span><span><a href="mailto:${esc(BRAND.email)}">${esc(BRAND.email)}</a> · ${esc(BRAND.phone)} · <a href="https://${esc(BRAND.website.replace(/^https?:\/\//, ''))}" rel="noopener">${esc(BRAND.website.replace(/^https?:\/\//, ''))}</a> · <a href="${esc(BRAND.linkedin)}" rel="noopener">LinkedIn</a></span></footer>
${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`;
}

function lookupPage(res, { code = '', error = '' } = {}) {
  const nonce = crypto.randomBytes(12).toString('base64');
  securityHeaders(res, nonce);
  res.status(error ? 404 : 200).type('html').send(page({
    nonce, title: 'Verify a credential — Resilience Technologies Labs',
    body: `<main><div class="lookup-box"><h1>Verify a credential</h1>
<p>Enter the verification code printed on an RTL letter or certificate (next to the QR code), for example <b>ABCD-EFGH-JKLM</b>.</p>
<form method="get" action="/verify"><label for="c" style="position:absolute;left:-9999px">Verification code</label>
<input id="c" name="code" value="${esc(code)}" placeholder="XXXX-XXXX-XXXX" autocomplete="off" required maxlength="20" autofocus>
<button type="submit">Verify</button></form>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}</div></main>`,
  }));
}

router.get('/', ah(async (req, res) => {
  if (req.query.code) {
    const c = normCode(req.query.code);
    if (c) return res.redirect(302, `/verify/${c}`);
    return lookupPage(res, { code: String(req.query.code).slice(0, 20), error: 'That code is not in the right format. It has 12 letters and numbers, like ABCD-EFGH-JKLM.' });
  }
  lookupPage(res);
}));

router.get('/:code', ah(async (req, res) => {
  const code = normCode(req.params.code);
  if (code && req.params.code !== code) return res.redirect(301, `/verify/${code}`);
  const r = await lookup(code);
  if (!r) return lookupPage(res, { code: req.params.code.slice(0, 20), error: 'No letter or certificate matches this code. Check it and try again, or contact us.' });

  const { i, isCert, name, valid } = r;
  const url = credentialUrl(req, code);
  const img = `${url}/image.png`;
  const docName = isCert ? 'Internship Completion Certificate' : 'Internship Joining Letter';
  const role = roleTitle(i.role);
  const title = `${name} — ${docName} | Resilience Technologies Labs`;
  const desc = valid
    ? `Verified ${docName.toLowerCase()} issued by ${BRAND.legal} to ${name}, ${role}. Credential ID ${r.ref}.`
    : `This ${docName.toLowerCase()} (${r.ref}) has been withdrawn by ${BRAND.legal}.`;
  const issuedYear = r.issued.slice(0, 4), issuedMonth = Number(r.issued.slice(5, 7));
  const shareText = isCert
    ? `I've completed my ${role}ship at Resilience Technologies Labs (RTL). Verified certificate:`
    : `I've joined Resilience Technologies Labs (RTL) as a ${role}. Verified joining letter:`;
  const enc = encodeURIComponent;
  const liAdd = linkedinAddUrl({ name: docName, issueYear: issuedYear, issueMonth: issuedMonth, url, ref: r.ref });
  const cap = captions({ kind: isCert ? 'certificate' : 'letter', role: i.role, url, minScore: CERT_MIN_SCORE });

  const status = valid
    ? `<div class="status" role="status"><span class="ic">${ICONS.check}</span><div><h1>Verified ${isCert ? 'certificate' : 'joining letter'}</h1><p>This ${docName.toLowerCase()} was issued by ${esc(BRAND.legal)} to <b>${esc(name)}</b>. Checked ${esc(longDate(new Date().toISOString()))}.</p></div></div>`
    : `<div class="status bad" role="status"><span class="ic">${ICONS.x}</span><div><h1>Withdrawn</h1><p>This ${docName.toLowerCase()} was issued by ${esc(BRAND.legal)} but has since been withdrawn and is no longer valid.</p></div></div>`;

  const rows = [
    ['Credential ID', r.ref],
    ['Issued to', name],
    ['Role', role],
    [isCert ? 'Internship' : 'Period', r.period],
    ['Issued on', longDate(r.issued)],
    ...(isCert ? [['Awarded for', `Completing the internship with a performance score of ${CERT_MIN_SCORE}% or higher in every month`]] : []),
    ...(!isCert ? [['Status', i.accepted_at ? `Accepted on ${longDate(i.accepted_at.toISOString())}` : 'Issued, awaiting acceptance']] : []),
    ['Issued by', `${BRAND.legal} · signed by ${BRAND.ceo}, ${BRAND.ceoTitle}`],
    ['Verification code', code],
  ];

  const share = valid ? `<div class="share"><h2>Share this ${isCert ? 'certificate' : 'letter'}</h2><div class="btns">
${isCert ? `<a class="btn primary" href="${esc(liAdd)}" target="_blank" rel="noopener">${ICONS.linkedin} Add to LinkedIn profile</a>` : ''}
<a class="btn" href="https://www.linkedin.com/feed/?shareActive=true&text=${enc(cap.linkedin)}" target="_blank" rel="noopener"><span class="li">${ICONS.linkedin}</span> LinkedIn post</a>
<a class="btn" href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}" target="_blank" rel="noopener"><span class="fb">${ICONS.facebook}</span> Facebook</a>
<a class="btn" href="https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(url)}" target="_blank" rel="noopener">${ICONS.xsocial} X</a>
<a class="btn" href="https://wa.me/?text=${enc(`${shareText} ${url}`)}" target="_blank" rel="noopener"><span class="wa">${ICONS.whatsapp}</span> WhatsApp</a>
<button class="btn" type="button" id="copy" data-url="${esc(url)}">${ICONS.link} Copy link</button>
<a class="btn" href="${esc(isCert ? `${url}/certificate.png` : img)}" download="${esc(`${r.ref.replace(/[^\w]+/g, '-')}.png`)}">${ICONS.download} Download image</a>
</div><p class="follow">Tag <a href="${esc(BRAND.linkedin)}" target="_blank" rel="noopener">${esc(BRAND.linkedinName)}</a> in your post: type <b>@Resilience Technologies Labs</b> and pick the company page.</p></div>` : '';

  const artSrc = isCert ? `${url}/certificate.png` : img;
  const body = `<main>${status}<div class="grid">
<div class="art${valid ? '' : ' void'}"><img src="${esc(artSrc)}" alt="${esc(`${docName} issued to ${name}`)}" width="${isCert ? 1684 : 1200}" height="${isCert ? 1190 : 630}">${valid ? '' : '<div class="stamp"><span>WITHDRAWN</span></div>'}</div>
<section class="card" aria-label="Credential details"><p class="kind">${esc(docName)}</p><h2 class="name">${esc(name)}</h2><p class="role">${esc(role)} · ${esc(durationText(i.start_date, i.end_date))}</p>
<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${share}</section></div>
<div class="note"><b>This page is the official record.</b> Only RTL letters and certificates that show as verified on this page are genuine. Screenshots, edited copies or certificates bearing another person's name cannot be verified. To report misuse, write to <a href="mailto:${esc(BRAND.email)}">${esc(BRAND.email)}</a>.</div>
</main>`;

  const nonce = crypto.randomBytes(12).toString('base64');
  securityHeaders(res, nonce);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('html').send(page({
    nonce, title, body,
    head: `<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Resilience Technologies Labs">
<meta property="og:title" content="${esc(`${name} — ${docName}`)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(img)}"><meta property="og:image:secure_url" content="${esc(img)}">
<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`${docName} — ${name}`)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(`${name} — ${docName}`)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">`,
    script: valid ? `document.getElementById('copy').addEventListener('click',function(e){var u=e.currentTarget.getAttribute('data-url');var t=document.createElement('div');t.className='toast';t.setAttribute('role','status');document.body.appendChild(t);function show(m){t.textContent=m;t.classList.add('on');setTimeout(function(){t.classList.remove('on')},2200)}if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){show('Link copied')},function(){show(u)})}else{show(u)}});` : '',
  }));
}));

/** Social preview card. */
router.get('/:code/image.png', ah(async (req, res) => {
  const r = await lookup(normCode(req.params.code));
  if (!r) return res.status(404).type('text').send('Not found');
  const png = await cached(`card:${req.params.code}:${r.stamp}`, async () => svgToPng(await shareCardSvg({
    kind: r.isCert ? 'certificate' : 'letter', name: r.name, role: roleTitle(r.i.role), period: r.period, ref: r.ref, valid: r.valid,
  }), 1200));
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('png').send(png);
}));

/** The full certificate as an image. */
router.get('/:code/certificate.png', ah(async (req, res) => {
  const code = normCode(req.params.code);
  const r = await lookup(code);
  if (!r || !r.isCert) return res.status(404).type('text').send('Not found');
  const ceo = await getCompanySignature();
  const base = credentialsBase(req);
  const png = await cached(`cert:${code}:${r.stamp}:${base}:${ceo?.updated_at || ''}`, async () => {
    const art = await certificateSvg({ intern: r.i, name: r.name, ceoSig: ceo?.png || null, verifyUrl: credentialUrl(req, code) });
    return svgToPng(art.svg, 1684);
  });
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('png').send(png);
}));

export default router;
