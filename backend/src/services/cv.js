import { complete, aiEnabled } from './aiProviders.js';

/*
 * Reads a CV (PDF or Word) and picks a short, standard position title for the joining letter and
 * certificate, e.g. "Software Developer" or "Social Media Manager". Titles always come from the
 * list below so they stay concise and consistent. AI refines the choice when an AI key is set;
 * otherwise skills and tools in the CV are matched against each position.
 */

export const POSITIONS = {
  'Software Developer': ['javascript', 'typescript', 'react', 'node.js', 'nodejs', 'node', 'python', 'java', 'c++', 'c#', '.net', 'php', 'laravel', 'django', 'flask', 'rest api', 'api', 'git', 'github', 'sql', 'mongodb', 'postgresql', 'mysql', 'express', 'spring boot', 'golang', 'programming', 'software development', 'software engineer', 'backend', 'frontend', 'front-end', 'back-end', 'full stack', 'full-stack', 'web development', 'web developer', 'html', 'css', 'next.js', 'vue', 'angular', 'tailwind', 'developer'],
  'Mobile App Developer': ['android', 'ios', 'flutter', 'react native', 'kotlin', 'swift', 'dart', 'mobile app', 'mobile application', 'play store', 'app store', 'xcode', 'android studio'],
  'AI/ML Engineer': ['data science', 'machine learning', 'deep learning', 'tensorflow', 'pytorch', 'nlp', 'natural language processing', 'computer vision', 'llm', 'large language model', 'artificial intelligence', 'scikit-learn', 'keras', 'neural network', 'generative ai', 'langchain', 'prompt engineering', 'opencv', 'hugging face'],
  'Data Analyst': ['data analysis', 'data analyst', 'power bi', 'tableau', 'excel', 'pandas', 'numpy', 'statistics', 'dashboards', 'data visualization', 'analytics', 'data cleaning', 'looker', 'google sheets'],
  'UI/UX Designer': ['figma', 'ui/ux', 'ux', 'ui design', 'user experience', 'user interface', 'wireframe', 'wireframing', 'prototype', 'prototyping', 'adobe xd', 'usability', 'user research', 'design system'],
  'Graphic Designer': ['graphic design', 'graphic designer', 'photoshop', 'illustrator', 'canva', 'branding', 'logo design', 'indesign', 'coreldraw', 'poster', 'visual design', 'brand identity', 'print design', 'typography'],
  'Video Editor': ['video editing', 'video editor', 'premiere pro', 'after effects', 'capcut', 'final cut', 'davinci resolve', 'motion graphics', 'reels editing', 'youtube videos', 'color grading', 'filmora'],
  'Content Writer': ['content writing', 'content writer', 'copywriting', 'copywriter', 'blog', 'blogging', 'article writing', 'articles', 'proofreading', 'creative writing', 'technical writing', 'script writing', 'ghostwriting', 'editorial'],
  'Social Media Manager': ['social media', 'social media marketing', 'social media management', 'instagram', 'facebook', 'tiktok', 'linkedin', 'content calendar', 'community management', 'meta business suite', 'engagement', 'followers', 'hootsuite', 'buffer', 'influencer', 'reels', 'content creation', 'content creator', 'brand awareness'],
  'Digital Marketing Specialist': ['digital marketing', 'google ads', 'meta ads', 'facebook ads', 'ppc', 'seo', 'sem', 'email marketing', 'google analytics', 'marketing campaigns', 'campaigns', 'marketing strategy', 'lead generation', 'performance marketing', 'conversion', 'mailchimp', 'hubspot'],
  'Business Developer': ['business development', 'sales', 'client acquisition', 'crm', 'negotiation', 'partnerships', 'proposals', 'upwork', 'fiverr', 'b2b', 'cold outreach', 'client relations', 'bidding'],
  'Project Coordinator': ['project management', 'project coordinator', 'project manager', 'jira', 'trello', 'asana', 'scrum', 'agile', 'coordination', 'stakeholder', 'clickup', 'timelines'],
  'HR Associate': ['human resources', 'recruitment', 'recruiter', 'talent acquisition', 'onboarding', 'payroll', 'hr', 'interviews', 'employee relations', 'hiring'],
  'Civil Engineer': ['civil engineering', 'civil engineer', 'autocad', 'etabs', 'sap2000', 'structural', 'revit', 'staad', 'construction', 'surveying', 'primavera', 'quantity surveying', 'site engineer', 'concrete', 'safe'],
  'GIS Analyst': ['gis', 'arcgis', 'qgis', 'remote sensing', 'spatial analysis', 'mapping', 'google earth engine', 'geospatial'],
  'Research Assistant': ['research', 'literature review', 'spss', 'thesis', 'publication', 'journal', 'research paper', 'data collection', 'survey design'],
  'Cybersecurity Analyst': ['cybersecurity', 'cyber security', 'penetration testing', 'network security', 'wireshark', 'kali linux', 'ethical hacking', 'soc', 'siem', 'vulnerability assessment', 'owasp'],
  'DevOps Engineer': ['devops', 'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'ci/cd', 'terraform', 'jenkins', 'linux', 'cloud computing', 'github actions'],
  'QA Engineer': ['quality assurance', 'qa', 'software testing', 'selenium', 'test cases', 'cypress', 'manual testing', 'automation testing', 'bug tracking', 'postman'],
  'Accountant': ['accounting', 'accountant', 'quickbooks', 'bookkeeping', 'finance', 'tally', 'financial statements', 'audit', 'taxation', 'xero', 'reconciliation'],
  'Customer Support Specialist': ['customer service', 'customer support', 'call center', 'helpdesk', 'zendesk', 'client support', 'live chat', 'customer satisfaction'],
};
export const POSITION_LIST = Object.keys(POSITIONS);

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const TERM_RE = Object.fromEntries(Object.entries(POSITIONS).map(([p, terms]) => [p, terms.map((t) => [t, new RegExp(`(^|[^a-z0-9+#])${escRe(t)}(?![a-z0-9+#])`, 'gi')])]));

/** Plain text from a PDF or Word (.docx) file. */
export async function cvText(buf, mime) {
  if (mime === 'application/pdf') {
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text || '');
  }
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return String(value || '');
}

/** CV text with its line breaks kept (for reading). PDFs are rebuilt line by line from the page layout. */
export async function cvReadableText(buf, mime) {
  if (mime !== 'application/pdf') return cvText(buf, mime);
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 8); n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    let out = '', lastY = null;
    for (const it of content.items) {
      if (typeof it.str !== 'string') continue;
      const y = it.transform?.[5];
      if (!it.str.trim() && !it.hasEOL) { if (it.str) out += ' '; continue; }
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
        out = out.replace(/[ \n]+$/, '');
        out += Math.abs(y - lastY) > (it.height || 10) * 1.9 ? '\n\n' : '\n';
      }
      out += it.str;
      if (y !== undefined && it.str.trim()) lastY = y;
    }
    pages.push(out.trim());
  }
  return pages.join('\n\n');
}

/** Skill matching: unique skills count most; titles in the CV's headline get a strong boost. */
export function matchPositions(text) {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const head = t.slice(0, 700);
  const scores = POSITION_LIST.map((p) => {
    let score = 0;
    const skills = [];
    for (const [term, re] of TERM_RE[p]) {
      const n = (t.match(re) || []).length;
      if (!n) continue;
      score += 1 + Math.log2(n) * 0.5 + (term.includes(' ') ? 0.5 : 0);
      skills.push(term);
    }
    // The title (or its core, e.g. "Graphic Designer" → "graphic designer") written near the top of the CV
    const core = p.toLowerCase().replace(/ (manager|specialist|analyst|engineer|associate)$/, '');
    const inHead = (w) => w.length >= 4 && new RegExp(`(^|[^a-z0-9])${escRe(w)}(?![a-z0-9])`).test(head);
    if (inHead(p.toLowerCase()) || inHead(core)) score += 6;
    return { position: p, score: Math.round(score * 10) / 10, skills };
  }).sort((a, b) => b.score - a.score);
  return scores;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/**
 * Best position for the CV: { position, skills, alternatives, method }.
 * Returns position null when the CV has too little to go on.
 */
export async function positionFromCv(text) {
  const ranked = matchPositions(text);
  const top = ranked[0];
  const base = {
    skills: top.skills.slice(0, 8),
    alternatives: ranked.slice(1, 3).filter((r) => r.score >= 3).map((r) => r.position),
  };
  if (await aiEnabled().catch(() => false)) {
    try {
      const SYSTEM = `You choose the single best job position for an intern from their CV. Answer with exactly one title copied from this list and nothing else:\n${POSITION_LIST.join('\n')}`;
      const user = `Skill match scores (for reference): ${ranked.slice(0, 5).map((r) => `${r.position}=${r.score}`).join(', ')}\n\nCV:\n${text.slice(0, 7000)}`;
      const { result } = await withTimeout(complete(SYSTEM, user, (out) => {
        const ans = String(out).trim().replace(/^["'`*\s]+|["'`*.\s]+$/g, '');
        const hit = POSITION_LIST.find((p) => p.toLowerCase() === ans.toLowerCase());
        if (!hit) throw new Error('Not a listed position');
        return hit;
      }), 25000);
      const r = ranked.find((x) => x.position === result);
      return { ...base, position: result, skills: (r?.skills.length ? r.skills : base.skills).slice(0, 8), alternatives: ranked.filter((x) => x.position !== result && x.score >= 3).slice(0, 2).map((x) => x.position), method: 'ai' };
    } catch { /* fall back to skill matching */ }
  }
  if (top.score < 3) return { ...base, position: null, method: 'skills' };
  return { ...base, position: top.position, method: 'skills' };
}
