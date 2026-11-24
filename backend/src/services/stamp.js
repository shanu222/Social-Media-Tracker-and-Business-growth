import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';

/*
 * The company's round rubber stamp, redrawn as vector art from the real stamp so it prints sharply,
 * then rendered with ink texture (uneven pressure, speckle, rough edges) and a slight tilt so it
 * reads as stamped rather than printed. Placed on joining letters and certificates.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const font = (f) => opentype.loadSync(path.resolve(here, '../../assets/fonts', f));
const BOLD = font('inter-latin-700-normal.woff');
const SEMI = font('inter-latin-600-normal.woff');

export const STAMP_TEXT = process.env.STAMP_TEXT || 'Resilience Technologies Labs (SMC-Pvt) Ltd';
const INK = '#1c369e';

/** Glyphs laid along a circle, centred on `mid` degrees (0 = top), reading clockwise. */
function arcText(f, text, cx, cy, r, size, midDeg, ls = 0.04) {
  const glyphs = f.stringToGlyphs(text);
  const scale = size / f.unitsPerEm;
  const adv = glyphs.map((g) => g.advanceWidth * scale + ls * size);
  const total = adv.reduce((a, b) => a + b, 0) - ls * size;
  let ang = (midDeg * Math.PI) / 180 - total / r / 2;
  let out = '';
  glyphs.forEach((g, k) => {
    const w = g.advanceWidth * scale;
    const a = ang + w / 2 / r; // angle at the glyph's centre
    const x = cx + r * Math.sin(a), y = cy - r * Math.cos(a);
    const d = g.getPath(-w / 2, 0, size).toPathData(2);
    if (d) out += `<path d="${d}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${((a * 180) / Math.PI).toFixed(2)})"/>`;
    ang += adv[k] / r;
  });
  return { svg: out, spanDeg: (total / r) * (180 / Math.PI) };
}

function centred(f, text, cx, y, size, ls = 0) {
  const w = f.getAdvanceWidth(text, size, { letterSpacing: ls }) - ls * size;
  return `<path d="${f.getPath(text, cx - w / 2, y, size, { letterSpacing: ls }).toPathData(2)}"/>`;
}
const star = (cx, cy, r) => {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = (Math.PI / 5) * k - Math.PI / 2, rr = k % 2 ? r * 0.45 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
};

/** The stamp as SVG (600 × 600 artboard). `seed` varies the ink so each document looks individually stamped. */
export function stampSvg({ seed = 7, tilt = -9 } = {}) {
  const S = 600, c = S / 2;
  const ring = arcText(BOLD, STAMP_TEXT, c, c, 222, 44, 0, 0.03);
  // Stars in the gap at the bottom of the ring
  const gapMid = 180;
  const stars = [gapMid - 14, gapMid, gapMid + 14].map((d, k) => {
    const a = (d * Math.PI) / 180, r = 236;
    return star(c + r * Math.sin(a), c - r * Math.cos(a), k === 1 ? 15 : 10);
  }).join('');
  const body = `
    <circle cx="${c}" cy="${c}" r="286" fill="none" stroke="${INK}" stroke-width="11"/>
    <circle cx="${c}" cy="${c}" r="270" fill="none" stroke="${INK}" stroke-width="3"/>
    <circle cx="${c}" cy="${c}" r="176" fill="none" stroke="${INK}" stroke-width="6"/>
    <g fill="${INK}">${ring.svg}${stars}
      <path d="M ${c - 116} ${c - 42} A 130 116 0 0 1 ${c + 116} ${c - 42}" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
      ${centred(BOLD, 'RTL', c, c + 40, 120, -0.02)}
      ${centred(BOLD, 'RESILIENCE', c, c + 86, 34, 0.06)}
      ${centred(SEMI, 'TECHNOLOGIES', c, c + 118, 22, 0.16)}
      <rect x="${c - 92}" y="${c + 134}" width="46" height="3"/><rect x="${c + 46}" y="${c + 134}" width="46" height="3"/>
      ${centred(SEMI, 'LABS', c, c + 143, 22, 0.24)}
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <defs>
    <filter id="ink" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed}" result="fine"/>
      <feColorMatrix in="fine" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.75" result="speck"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="2" seed="${seed + 11}" result="press"/>
      <feColorMatrix in="press" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.5 0.32" result="pressure"/>
      <feComposite in="speck" in2="pressure" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="mask"/>
      <feComposite in="SourceGraphic" in2="mask" operator="in" result="inked"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="${seed + 3}" result="warp"/>
      <feDisplacementMap in="inked" in2="warp" scale="5" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <g filter="url(#ink)" opacity="0.95" transform="rotate(${tilt} ${c} ${c})">${body}</g>
</svg>`;
}

/** A stable seed and tilt per document, so each one looks individually stamped (and stays the same on re-download). */
export function stampStyle(ref = '') {
  let h = 0;
  for (const ch of String(ref)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { seed: 3 + (h % 40), tilt: -15 + (h % 11) };
}

const cache = new Map();
/** The stamp as a transparent PNG (cached). */
export async function stampPng({ size = 640, seed = 7, tilt = -9 } = {}) {
  const key = `${size}:${seed}:${tilt}`;
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  if (!cache.has(key)) cache.set(key, await sharp(Buffer.from(stampSvg({ seed, tilt })), { density: 72 * (size / 600) }).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
  return cache.get(key);
}
