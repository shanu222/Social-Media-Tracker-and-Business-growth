import { BRAND } from '../brand.js';
import { roleTitle } from './letters.js';
/*
 * Public links for letters and certificates, e.g. https://sustainablesolution360.com/verify/<code>.
 *
 * The company website forwards /verify to this service, so links carry the company's own address.
 * At start-up (and every 10 minutes) we confirm the website really forwards — it must answer with our
 * X-RTL-Credentials header — before using it; until then links use this service's own address, so
 * no link can ever point somewhere that does not work.
 *   CREDENTIALS_SITE  the website to use (default https://sustainablesolution360.com)
 *   CREDENTIALS_URL   force a specific address without checking (e.g. a custom domain on this service)
 */
const FORCED = String(process.env.CREDENTIALS_URL || '').trim().replace(/\/+$/, '');
const SITE = String(process.env.CREDENTIALS_SITE || 'https://sustainablesolution360.com').trim().replace(/\/+$/, '');
let siteBase = null, checkedAt = 0, checking = null;

export async function checkCredentialsSite() {
  if (checking) return checking;
  checking = (async () => {
    try {
      const r = await fetch(`${SITE}/verify/assets/logo.png`, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
      siteBase = r.ok && r.headers.get('x-rtl-credentials') === '1' ? new URL(r.url).origin : null;
    } catch { siteBase = null; }
    checkedAt = Date.now();
    checking = null;
    return siteBase;
  })();
  return checking;
}

export function credentialsBase(req) {
  if (/^https?:\/\/[^/\s]+/i.test(FORCED)) return FORCED;
  if (Date.now() - checkedAt > 10 * 60 * 1000) checkCredentialsSite();
  if (siteBase) return siteBase;
  if (req) return `${req.protocol}://${req.get('host')}`;
  // No request (scheduled job): this service's public address on Railway
  return process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : SITE;
}
export const usingCompanyAddress = () => Boolean(FORCED || siteBase);

/** After start-up (the website forwards to us, so we must be listening first): check now, then retry for a while. */
export function watchCredentialsSite() {
  if (FORCED) { console.log(`[credentials] Public links use ${FORCED}`); return; }
  let tries = 0;
  const run = async () => {
    const b = await checkCredentialsSite();
    if (b) return console.log(`[credentials] Public links use ${b}`);
    if (++tries === 1) console.log(`[credentials] ${SITE} is not forwarding /verify yet; links use this service's address`);
    if (tries < 10) setTimeout(run, 60_000).unref();
  };
  setTimeout(run, 3000).unref();
}

export const credentialUrl = (req, code) => `${credentialsBase(req)}/verify/${code}`;


/** LinkedIn "Add to profile" link; with LINKEDIN_ORG_ID set, the certificate shows RTL's logo and links to the company page. */
export function linkedinAddUrl({ name, issueYear, issueMonth, url, ref }) {
  const q = new URLSearchParams({ startTask: 'CERTIFICATION_NAME', name, issueYear: String(issueYear), issueMonth: String(issueMonth), certUrl: url, certId: ref });
  if (BRAND.linkedinOrgId) q.set('organizationId', BRAND.linkedinOrgId);
  else q.set('organizationName', BRAND.linkedinName);
  return `https://www.linkedin.com/profile/add?${q.toString()}`;
}

/** Ready-to-post captions. Instagram @handles become live tags when pasted; LinkedIn needs the page picked from the @ list. */
export function captions({ kind, role, url, minScore, performanceMet = true }) {
  const r = roleTitle(role);
  const company = BRAND.linkedinName;
  const linkedin = kind === 'certificate'
    ? `I'm happy to share that I have successfully completed my ${r}ship at ${company}${performanceMet ? `, with an overall performance score of ${minScore}% or higher` : ''}.\n\nThank you to ${BRAND.ceo} and the RTL team for the guidance and the opportunity.\n\nVerified certificate: ${url}\n\n#Internship #RTL #ResilienceTechnologiesLabs #CareerGrowth`
    : `I'm excited to share that I have joined ${company} as a ${r}. Looking forward to learning, contributing and growing with the team.\n\nVerified joining letter: ${url}\n\n#NewBeginnings #Internship #RTL #ResilienceTechnologiesLabs`;
  const instagram = kind === 'certificate'
    ? `Internship completed ✅ ${r} at @${BRAND.instagram}. Grateful for the experience!\nVerify: ${url}\n#Internship #RTL`
    : `New beginnings 🚀 Joined @${BRAND.instagram} as a ${r}.\nVerify: ${url}\n#Internship #RTL`;
  const short = kind === 'certificate'
    ? `I've completed my ${r}ship at Resilience Technologies Labs (RTL). Verified certificate:`
    : `I've joined Resilience Technologies Labs (RTL) as a ${r}. Verified joining letter:`;
  return { linkedin, instagram, short };
}
