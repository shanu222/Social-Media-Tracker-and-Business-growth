/*
 * Professional routines per product. Every product gets:
 *  - a social media routine for the platforms it actually has accounts on
 *  - routine tasks for its type (education, e-commerce, SaaS, ...)
 * Company-wide tasks (security, backups, renewals, monthly report) stay shared.
 *
 * Each item: [key, title, frequency, group, platform?]
 * The key keeps setup idempotent, so re-running only adds what's missing.
 */

const SOCIAL = [
  // Daily
  ['s.reply', 'Reply to every comment and DM from the last 24 hours', 'daily', 'Engagement'],
  ['s.publish', 'Publish today\'s planned post or story', 'daily', 'Content'],
  ['s.mentions', 'Check mentions and tags; share or respond to good ones', 'daily', 'Engagement'],
  ['ig.stories', 'Instagram: post at least one story; reply to story replies', 'daily', 'Instagram', 'instagram'],
  ['fb.inbox', 'Facebook: clear page inbox and answer reviews', 'daily', 'Facebook', 'facebook'],
  ['yt.comments', 'YouTube: reply to new comments and pin the best one', 'daily', 'YouTube', 'youtube'],
  ['tg.update', 'Telegram: post today\'s update and remove spam', 'daily', 'Telegram', 'telegram'],
  ['dc.moderate', 'Discord: welcome new members and answer open questions', 'daily', 'Discord', 'discord'],
  ['li.engage', 'LinkedIn: engage with 5 relevant posts from the industry', 'daily', 'LinkedIn', 'linkedin'],
  ['tt.post', 'TikTok: post or schedule a short video; reply to comments', 'daily', 'TikTok', 'tiktok'],
  ['wa.reply', 'WhatsApp: reply to every customer chat', 'daily', 'WhatsApp', 'whatsapp'],
  ['s.numbers', 'Log today\'s follower numbers in Daily update', 'daily', 'Reporting'],
  // Weekly
  ['s.calendar', 'Plan and schedule next week\'s content calendar', 'weekly', 'Content'],
  ['s.top', 'Review the top 3 posts of the week and note what worked', 'weekly', 'Analytics'],
  ['s.clean', 'Remove spam comments and fake followers', 'weekly', 'Engagement'],
  ['s.trends', 'Research trending topics, audio and hashtags for the niche', 'weekly', 'Content'],
  ['yt.weekly', 'YouTube: check titles, thumbnails and descriptions of recent uploads', 'weekly', 'YouTube', 'youtube'],
  // Monthly
  ['s.profile', 'Update bios, links and highlights; confirm every link works', 'monthly', 'Brand'],
  ['s.review', 'Compare this month with last month and write the summary', 'monthly', 'Analytics'],
];

const TYPE_TASKS = {
  education: [
    ['ed.queries', 'Answer student questions in comments, DMs and the app', 'daily', 'Students'],
    ['ed.mcq', 'Post the practice question of the day', 'daily', 'Content'],
    ['ed.lectures', 'Upload or schedule this week\'s lecture videos', 'weekly', 'Content'],
    ['ed.reviews', 'Reply to Play Store reviews', 'weekly', 'App'],
    ['ed.results', 'Share a student result, testimonial or success story', 'weekly', 'Content'],
    ['ed.bank', 'Fill gaps in the question bank for upcoming test topics', 'monthly', 'Content'],
    ['ed.funnel', 'Review sign-ups vs paid enrolments and plan improvements', 'monthly', 'Growth'],
  ],
  ecommerce: [
    ['ec.orders', 'Check new orders and stock for promoted products', 'daily', 'Store'],
    ['ec.inquiries', 'Answer product questions within 1 hour', 'daily', 'Customers'],
    ['ec.products', 'Post new arrivals or product highlights', 'weekly', 'Content'],
    ['ec.carts', 'Follow up abandoned carts or run a small promotion', 'weekly', 'Sales'],
    ['ec.ads', 'Review ad spend and results; pause weak ads', 'weekly', 'Marketing'],
    ['ec.sales', 'Plan next month\'s sales and seasonal campaigns', 'monthly', 'Sales'],
    ['ec.feedback', 'Review returns, complaints and customer feedback', 'monthly', 'Customers'],
  ],
  saas: [
    ['sa.support', 'Answer support requests and log common issues', 'daily', 'Customers'],
    ['sa.usecase', 'Share a use case, tip or feature highlight', 'daily', 'Content'],
    ['sa.demos', 'Follow up demo requests and new sign-ups', 'weekly', 'Sales'],
    ['sa.update', 'Publish a product update or short tutorial', 'weekly', 'Content'],
    ['sa.testimonial', 'Collect a testimonial or write a customer story', 'monthly', 'Growth'],
    ['sa.funnel', 'Review sign-up to paid conversion and churn', 'monthly', 'Growth'],
  ],
  community: [
    ['co.welcome', 'Welcome new members and answer their questions', 'daily', 'Community'],
    ['co.share', 'Share an opportunity, resource or member story', 'daily', 'Content'],
    ['co.feature', 'Feature a member success story', 'weekly', 'Content'],
    ['co.event', 'Promote the next event or workshop', 'weekly', 'Programmes'],
    ['co.plan', 'Plan next month\'s events and partners', 'monthly', 'Programmes'],
    ['co.impact', 'Share impact numbers with partners and supporters', 'monthly', 'Partnerships'],
  ],
  app_testing: [
    ['at.requests', 'Check new client app requests and tester sign-ups', 'daily', 'Clients'],
    ['at.recruit', 'Post a call for testers', 'daily', 'Testers'],
    ['at.reports', 'Send test reports and status updates to clients', 'weekly', 'Delivery'],
    ['at.console', 'Check Play Console closed-testing status for client apps', 'weekly', 'Delivery'],
    ['at.clean', 'Remove inactive testers and refill the pool', 'monthly', 'Testers'],
    ['at.reviews', 'Ask finished clients for a review', 'monthly', 'Clients'],
  ],
  games: [
    ['gm.reviews', 'Reply to new store reviews', 'daily', 'Players'],
    ['gm.clip', 'Share a gameplay clip, screenshot or challenge', 'daily', 'Content'],
    ['gm.crashes', 'Check crash reports and ratings', 'weekly', 'Quality'],
    ['gm.event', 'Post a weekly challenge or update teaser', 'weekly', 'Content'],
    ['gm.release', 'Plan the next update and its launch posts', 'monthly', 'Delivery'],
    ['gm.revenue', 'Review ad revenue and ad placements', 'monthly', 'Revenue'],
  ],
  channel: [
    ['ch.short', 'Post a short or teaser clip', 'daily', 'Content'],
    ['ch.video', 'Publish the new video on schedule', 'weekly', 'Content'],
    ['ch.thumbs', 'Prepare thumbnails and titles for the next videos', 'weekly', 'Content'],
    ['ch.analytics', 'Check click-through rate and audience retention', 'weekly', 'Analytics'],
    ['ch.topics', 'Plan next month\'s video topics', 'monthly', 'Content'],
    ['ch.policy', 'Check monetisation status and policy notices', 'monthly', 'Channel'],
  ],
  services: [
    ['sv.leads', 'Reply to new leads and inquiries within 2 hours', 'daily', 'Sales'],
    ['sv.market', 'Check Fiverr / Upwork messages and orders', 'daily', 'Sales'],
    ['sv.portfolio', 'Share a portfolio piece or case study', 'weekly', 'Content'],
    ['sv.proposals', 'Follow up open proposals', 'weekly', 'Sales'],
    ['sv.update', 'Update the portfolio and service pages', 'monthly', 'Brand'],
    ['sv.reviews', 'Ask finished clients for a review', 'monthly', 'Clients'],
  ],
  other: [],
};

/** Company-wide routine (not tied to one product). */
export const COMPANY_TASKS = [
  ['c.security', 'Check login alerts and security emails for all accounts', 'daily', 'Security'],
  ['c.accountsec', 'Confirm account security and recovery details for every account', 'monthly', 'Security'],
  ['c.backup', 'Back up content (videos, graphics, captions) and question banks', 'monthly', 'Operations'],
  ['c.db', 'Check database usage and backup status', 'monthly', 'Operations'],
  ['c.renewals', 'Check domain, hosting and subscription renewal dates', 'monthly', 'Operations'],
  ['c.payments', 'Review ads and payments against results', 'monthly', 'Finance'],
  ['c.report', 'Generate the monthly report and share it with the team', 'monthly', 'Reporting'],
];

/** The routine a product should have, given its type and the platforms of its accounts. */
export function routineFor(type, platforms) {
  const have = new Set(platforms);
  const social = platforms.length ? SOCIAL.filter(([, , , , p]) => !p || have.has(p)) : SOCIAL.filter(([k]) => ['s.calendar', 's.review'].includes(k));
  return [...(TYPE_TASKS[type] || []), ...social];
}

export async function productPlatforms(c, productId) {
  const { rows } = await c.query('SELECT DISTINCT platform FROM accounts WHERE product_id = $1 AND archived = FALSE', [productId]);
  return rows.map((r) => r.platform);
}

/** Adds any missing routine tasks for a product (never re-adds ones the admin removed). */
export async function setupProductChecklist(c, productId, { type = null, onlyKeys = null } = {}) {
  const t = type || (await c.query('SELECT category FROM products WHERE id = $1', [productId])).rows[0]?.category || 'other';
  const items = routineFor(t, await productPlatforms(c, productId)).filter(([k]) => !onlyKeys || onlyKeys.includes(k));
  let added = 0, pos = 0;
  for (const [key, title, frequency, group] of items) {
    const r = await c.query(
      `INSERT INTO checklist_tasks (title, scope, frequency, position, product_id, tpl_key)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (product_id, tpl_key) WHERE product_id IS NOT NULL DO NOTHING`,
      [title, group, frequency, pos++, productId, key]
    );
    added += r.rowCount;
  }
  return added;
}

/** Suggested items for the admin's "Suggested routine" picker. */
export async function suggestionsFor(c, productId) {
  const { rows: [p] } = await c.query('SELECT category FROM products WHERE id = $1', [productId]);
  const items = routineFor(p?.category || 'other', await productPlatforms(c, productId));
  const { rows: existing } = await c.query('SELECT tpl_key, active FROM checklist_tasks WHERE product_id = $1 AND tpl_key IS NOT NULL', [productId]);
  const state = new Map(existing.map((e) => [e.tpl_key, e.active]));
  return items.map(([key, title, frequency, group]) => ({ key, title, frequency, group, added: state.get(key) === true, removed: state.get(key) === false }));
}

/*
 * One-time move to product checklists:
 *  - the old shared social/product tasks are retired (their ticks stay in history)
 *  - company tasks stay shared, renamed where needed
 *  - every product gets its routine
 */
export async function upgradeToProductChecklists(tx) {
  return tx(async (c) => {
    if ((await c.query("SELECT 1 FROM job_runs WHERE key = 'checklist_v6'")).rowCount) return false;
    const keepCompany = {
      'Check for login alerts or security emails': 'c.security',
      'Confirm 2FA is on and recovery email/phone is correct for every account': 'c.accountsec',
      'Back up content (videos, graphics, captions) and question banks': 'c.backup',
      'Check database usage and backup status': 'c.db',
      'Check domain, hosting and subscription renewal dates': 'c.renewals',
      'Review ads / payments (if any) against results': 'c.payments',
      'Compare this month with last month and write the report': 'c.report',
    };
    const { rows: old } = await c.query('SELECT * FROM checklist_tasks WHERE product_id IS NULL AND active = TRUE AND tpl_key IS NULL');
    for (const t of old) {
      const key = keepCompany[t.title];
      if (key) {
        const def = COMPANY_TASKS.find(([k]) => k === key);
        await c.query('UPDATE checklist_tasks SET tpl_key = $2, title = $3, scope = $4 WHERE id = $1', [t.id, key, def[1], def[3]]);
      } else {
        await c.query('UPDATE checklist_tasks SET active = FALSE WHERE id = $1', [t.id]);
      }
    }
    let pos = 100;
    for (const [key, title, frequency, group] of COMPANY_TASKS) {
      const exists = await c.query('SELECT 1 FROM checklist_tasks WHERE product_id IS NULL AND tpl_key = $1', [key]);
      if (!exists.rowCount) await c.query('INSERT INTO checklist_tasks (title, scope, frequency, position, tpl_key) VALUES ($1,$2,$3,$4,$5)', [title, group, frequency, pos++, key]);
    }
    const { rows: products } = await c.query('SELECT id FROM products WHERE archived = FALSE');
    for (const p of products) await setupProductChecklist(c, p.id);
    await c.query("INSERT INTO job_runs (key, run_on) VALUES ('checklist_v6', '2000-01-01')");
    return true;
  });
}
