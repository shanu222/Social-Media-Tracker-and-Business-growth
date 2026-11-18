import crypto from 'node:crypto';
import { BRAND } from '../brand.js';

/*
 * Non-disclosure agreement every team member (everyone except admins) signs before using
 * the workspace. Changing the text? Bump NDA_VERSION so everyone signs the new version.
 */
export const NDA_VERSION = '2026-11-v1';
export const NDA_TITLE = 'Non-Disclosure and Confidentiality Agreement';

/** The agreement as sections; `{name}`, `{cnic}`, `{role}` are filled in for display and PDF. */
export function ndaSections({ name = '[Full name]', cnic = '[CNIC]', role = '[Role]' } = {}) {
  return [
    {
      heading: null,
      body: `This Non-Disclosure and Confidentiality Agreement is made between ${BRAND.legal} ("the Company"), represented by its ${BRAND.ceoTitle}, ${BRAND.ceo}, and ${name}, holder of CNIC ${cnic}, working with the Company as ${role} ("the Team Member").`,
    },
    {
      heading: 'A note before you sign',
      body: 'This agreement is a normal, professional step that every member of our team signs. It is not a sign of mistrust. Its purpose is to protect the Company\'s information, its products and its users, and the credibility we have built together. Working in good faith and keeping company matters inside the team is all it asks of you.',
    },
    {
      heading: '1. Confidential information',
      body: 'Confidential information means any information you see or receive through your work with the Company that is not already public, including: product plans, designs, source code, features and roadmaps of all Company products; account usernames, passwords, login emails, verification codes, API keys and access links; user, student, customer and client data; business, financial, pricing and growth figures, reports and analytics; internal tasks, messages, meetings, files and documents; and unpublished content, campaigns and strategies.',
    },
    {
      heading: '2. What you agree to',
      body: 'You will keep confidential information private and use it only to do your work for the Company. You will not share, publish, post, forward, copy or sell it to anyone outside the Company, including on social media, in screenshots or in personal chats. You will not share any password or login with anyone, use Company accounts for personal purposes, or change account recovery details without the Company\'s permission. You will tell the Company immediately if you think information or an account has been exposed.',
    },
    {
      heading: '3. Accounts and passwords',
      body: 'All Company social media, store, email and platform accounts belong to the Company. Passwords and access are given to you only to do your work, and remain the property of the Company. When your work with the Company ends, you will stop using these accounts and will not keep, use or share any access details.',
    },
    {
      heading: '4. What is not confidential',
      body: 'This agreement does not cover information that is already public through no fault of yours, or information the law requires you to disclose. If the law requires a disclosure, you will inform the Company first where you are allowed to.',
    },
    {
      heading: '5. Company property and work',
      body: 'Content, designs, documents, code and other work you create for the Company belong to the Company. When your work ends, you will return or delete Company files and information in your possession.',
    },
    {
      heading: '6. Responsibility',
      body: 'You are responsible for keeping this agreement. If confidential information or account access is disclosed or misused through you, you will be held responsible for it. Depending on the seriousness, this may lead to ending your engagement with the Company, recovery of any loss caused, and action available under the laws of Pakistan.',
    },
    {
      heading: '7. Duration',
      body: 'This agreement applies from the date you sign it, throughout your work with the Company, and for three (3) years after it ends. Obligations about passwords, account access, source code and user data continue without a time limit.',
    },
    {
      heading: '8. Governing law',
      body: 'This agreement is governed by the laws of the Islamic Republic of Pakistan, and the courts of Islamabad have jurisdiction.',
    },
    {
      heading: 'Declaration',
      body: `I, ${name}, holder of CNIC ${cnic}, have read and understood this agreement. I agree to keep all Company information, products and passwords confidential and to follow this agreement. I sign it of my own free will.`,
    },
  ];
}

/** Hash of the exact text the person agreed to (stored with the signature as evidence). */
export function ndaHash(fields) {
  const text = ndaSections(fields).map((s) => `${s.heading || ''}\n${s.body}`).join('\n\n');
  return crypto.createHash('sha256').update(`${NDA_VERSION}\n${NDA_TITLE}\n${text}`).digest('hex');
}

/** Pakistani CNIC: 13 digits, shown as 12345-1234567-1 */
export function normalizeCnic(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length !== 13) return null;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}
export const maskCnic = (c) => (c ? `${c.slice(0, 5)}-*******-${c.slice(-1)}` : null);
