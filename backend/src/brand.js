import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Company branding used in reports and emails. Override any value with BRAND_* environment variables. */
export const BRAND = {
  app: process.env.BRAND_APP || 'Growth Desk for RTL',
  company: process.env.BRAND_COMPANY || 'Resilience Technologies Labs',
  legal: process.env.BRAND_LEGAL || 'Resilience Technologies Labs (SMC-Private) Limited',
  ceo: process.env.BRAND_CEO || 'Shahnawaz',
  ceoTitle: process.env.BRAND_CEO_TITLE || 'Founder & CEO',
  email: process.env.BRAND_EMAIL || 'shahnawaz@sustainablesolution360.com',
  phone: process.env.BRAND_PHONE || '+92 340 3318127',
  website: process.env.BRAND_WEBSITE || 'sustainablesolution360.com',
  logo: path.join(here, '..', 'assets', 'rtl-logo.png'),
  // Company LinkedIn page; LINKEDIN_ORG_ID (the number in the page's admin URL) links shared certificates to it
  linkedin: process.env.BRAND_LINKEDIN || 'https://www.linkedin.com/company/resiliencetechnologieslabs',
  linkedinName: process.env.BRAND_LINKEDIN_NAME || 'Resilience Technologies Labs (SMC-PRIVATE) Ltd.',
  linkedinOrgId: String(process.env.LINKEDIN_ORG_ID || '').replace(/\D/g, ''),
  instagram: process.env.BRAND_INSTAGRAM || 'resilience_technologies_labs',
  colors: { navy: '#0a1a3d', navy2: '#13285a', blue: '#1a5fe0', cyan: '#12b5e8', green: '#16b97a', greenDark: '#0b7f66' },
};
