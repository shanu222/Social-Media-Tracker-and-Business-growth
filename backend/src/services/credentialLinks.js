import { BRAND } from '../brand.js';
import { roleTitle } from './letters.js';
/*
 * Public links for letters and certificates.
 * Set CREDENTIALS_URL to a professional address that points at this API service, for example
 * https://credentials.sustainablesolution360.com (Railway → service → Settings → Networking → Custom domain).
 * Without it, links use this service's own address. Links never expire: the code is stored permanently,
 * and old links keep working on any address that reaches this service.
 */
export function credentialsBase(req) {
  const env = String(process.env.CREDENTIALS_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^/\s]+/i.test(env)) return env;
  return `${req.protocol}://${req.get('host')}`;
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
export function captions({ kind, role, url, minScore }) {
  const r = roleTitle(role);
  const company = BRAND.linkedinName;
  const linkedin = kind === 'certificate'
    ? `I'm happy to share that I have successfully completed my ${r}ship at ${company}, with an overall performance score of ${minScore}% or higher.\n\nThank you to ${BRAND.ceo} and the RTL team for the guidance and the opportunity.\n\nVerified certificate: ${url}\n\n#Internship #RTL #ResilienceTechnologiesLabs #CareerGrowth`
    : `I'm excited to share that I have joined ${company} as a ${r}. Looking forward to learning, contributing and growing with the team.\n\nVerified joining letter: ${url}\n\n#NewBeginnings #Internship #RTL #ResilienceTechnologiesLabs`;
  const instagram = kind === 'certificate'
    ? `Internship completed ✅ ${r} at @${BRAND.instagram}. Grateful for the experience!\nVerify: ${url}\n#Internship #RTL`
    : `New beginnings 🚀 Joined @${BRAND.instagram} as a ${r}.\nVerify: ${url}\n#Internship #RTL`;
  const short = kind === 'certificate'
    ? `I've completed my ${r}ship at Resilience Technologies Labs (RTL). Verified certificate:`
    : `I've joined Resilience Technologies Labs (RTL) as a ${r}. Verified joining letter:`;
  return { linkedin, instagram, short };
}
