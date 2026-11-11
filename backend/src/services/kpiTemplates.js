/*
 * KPI sets by product type. Each product gets the metrics that fit what it is,
 * plus social metrics that fill in automatically from its linked social accounts.
 * [name, group, unit, aggregation ('sum' | 'last' | 'avg'), higher_is_better]
 */

export const AUTO_SOCIAL = [
  { name: 'Followers gained', category: 'Social media', unit: null, aggregation: 'sum', higher_is_better: true, source: 'followers_gained' },
  { name: 'Posts published', category: 'Social media', unit: null, aggregation: 'sum', higher_is_better: true, source: 'posts' },
  { name: 'Reach', category: 'Social media', unit: null, aggregation: 'sum', higher_is_better: true, source: 'reach' },
  { name: 'Engagement rate', category: 'Social media', unit: '%', aggregation: 'avg', higher_is_better: true, source: 'engagement_rate' },
];
export const AUTO_SOURCES = new Set(AUTO_SOCIAL.map((m) => m.source));

export const PRODUCT_TYPES = {
  education: {
    label: 'Education / e-learning',
    hint: 'Courses, test prep, learning apps',
    metrics: [
      ['New student sign-ups', 'Growth', null, 'sum', true],
      ['Paid enrolments', 'Revenue', null, 'sum', true],
      ['Revenue', 'Revenue', 'PKR', 'sum', true],
      ['Active learners', 'Engagement', null, 'last', true],
      ['Lectures / videos published', 'Content', null, 'sum', true],
      ['Practice questions added', 'Content', null, 'sum', true],
      ['App installs', 'Growth', null, 'sum', true],
      ['App rating', 'Quality', 'stars', 'last', true],
    ],
  },
  ecommerce: {
    label: 'E-commerce / store',
    hint: 'Online shop, marketplace',
    metrics: [
      ['Revenue', 'Sales', 'PKR', 'sum', true],
      ['Orders', 'Sales', null, 'sum', true],
      ['Average order value', 'Sales', 'PKR', 'avg', true],
      ['New customers', 'Customers', null, 'sum', true],
      ['Website visitors', 'Traffic', null, 'sum', true],
      ['Conversion rate', 'Traffic', '%', 'avg', true],
      ['Returns / refunds', 'Customers', null, 'sum', false],
      ['Ad spend', 'Marketing', 'PKR', 'sum', false],
    ],
  },
  saas: {
    label: 'SaaS / web platform',
    hint: 'Subscription software, online platform',
    metrics: [
      ['New sign-ups', 'Growth', null, 'sum', true],
      ['Active users', 'Usage', null, 'last', true],
      ['Paying customers', 'Revenue', null, 'last', true],
      ['Monthly recurring revenue', 'Revenue', 'PKR', 'last', true],
      ['Demos / meetings booked', 'Sales', null, 'sum', true],
      ['Customers lost', 'Retention', null, 'sum', false],
      ['Support requests', 'Quality', null, 'sum', false],
    ],
  },
  community: {
    label: 'Community / social impact',
    hint: 'Membership, empowerment, events',
    metrics: [
      ['New members', 'Community', null, 'sum', true],
      ['Active members', 'Community', null, 'last', true],
      ['Events / workshops held', 'Programmes', null, 'sum', true],
      ['Event attendees', 'Programmes', null, 'sum', true],
      ['Opportunities shared', 'Impact', null, 'sum', true],
      ['Partnerships signed', 'Partnerships', null, 'sum', true],
      ['Website visitors', 'Reach', null, 'sum', true],
    ],
  },
  app_testing: {
    label: 'App testing service',
    hint: 'Testers for Play Store closed testing',
    metrics: [
      ['New client apps', 'Clients', null, 'sum', true],
      ['Apps tested', 'Delivery', null, 'sum', true],
      ['Active testers', 'Testers', null, 'last', true],
      ['Test reports delivered', 'Delivery', null, 'sum', true],
      ['Bugs reported to clients', 'Delivery', null, 'sum', true],
      ['Revenue', 'Revenue', 'PKR', 'sum', true],
    ],
  },
  games: {
    label: 'Games / mobile apps',
    hint: 'Casual games, utility apps',
    metrics: [
      ['Installs', 'Growth', null, 'sum', true],
      ['Daily active users', 'Usage', null, 'last', true],
      ['Store rating', 'Quality', 'stars', 'last', true],
      ['Ad revenue', 'Revenue', 'PKR', 'sum', true],
      ['Updates released', 'Delivery', null, 'sum', true],
      ['Crash rate', 'Quality', '%', 'avg', false],
    ],
  },
  channel: {
    label: 'YouTube / content channel',
    hint: 'Video channel, creator brand',
    metrics: [
      ['Videos published', 'Content', null, 'sum', true],
      ['Views', 'Audience', null, 'sum', true],
      ['Watch time', 'Audience', 'hours', 'sum', true],
      ['Average view duration', 'Audience', 'min', 'avg', true],
      ['Channel revenue', 'Revenue', 'USD', 'sum', true],
    ],
  },
  services: {
    label: 'Company / services',
    hint: 'Agency, consulting, client projects',
    metrics: [
      ['Revenue', 'Revenue', 'PKR', 'sum', true],
      ['New leads / inquiries', 'Sales', null, 'sum', true],
      ['Proposals sent', 'Sales', null, 'sum', true],
      ['Projects won', 'Sales', null, 'sum', true],
      ['Projects delivered', 'Delivery', null, 'sum', true],
      ['Client rating', 'Quality', 'stars', 'avg', true],
      ['Ad spend', 'Marketing', 'PKR', 'sum', false],
    ],
  },
  other: {
    label: 'Other',
    hint: 'Start with the basics and add your own',
    metrics: [
      ['Revenue', 'Revenue', 'PKR', 'sum', true],
      ['New leads', 'Sales', null, 'sum', true],
      ['New customers', 'Customers', null, 'sum', true],
      ['Website visitors', 'Traffic', null, 'sum', true],
    ],
  },
};

/** Best guess of a product's type from its name, tagline, description and website. */
export function guessType(p) {
  const t = `${p.name || ''} ${p.tagline || ''} ${p.description || ''} ${p.website_url || ''}`.toLowerCase();
  if (/test ?loop|testers?|closed testing|app testing|testing network/.test(t)) return 'app_testing';
  if (/shop|store|commerce|cart|marketplace|walk ?360/.test(t)) return 'ecommerce';
  if (/meeto|meeting|classroom platform|saas|subscription|dashboard|platform for teams/.test(t)) return 'saas';
  if (/net ?360|entry test|exam|mcq|learn|course|lecture|student|tutor|academy|edtech/.test(t)) return 'education';
  if (/she ?360|women|empower|community|ngo|foundation|social impact/.test(t)) return 'community';
  if (/arcade|game|puzzle|rush|quest|play store app/.test(t)) return 'games';
  if (/tales|kids|stories|channel|youtube|vlog|podcast/.test(t)) return 'channel';
  if (/resilience technologies|rtl\b|agency|consult|services|software house|solutions/.test(t)) return 'services';
  return 'other';
}

export const typeList = () => Object.entries(PRODUCT_TYPES).map(([id, t]) => ({
  id, label: t.label, hint: t.hint,
  metrics: t.metrics.map(([name, category, unit, aggregation, hib]) => ({ name, category, unit, aggregation, higher_is_better: hib })),
}));

/** Creates the template metrics (all, or only `names`) and the automatic social metrics for a product. */
export async function setupProductKpis(c, productId, type, names = null, { keepExisting = false } = {}) {
  const tpl = PRODUCT_TYPES[type] || PRODUCT_TYPES.other;
  const pick = tpl.metrics.filter(([n]) => !names || names.includes(n));
  const rows = [
    ...pick.map(([name, category, unit, aggregation, hib]) => ({ name, category, unit, aggregation, higher_is_better: hib, source: 'manual' })),
    ...AUTO_SOCIAL,
  ];
  let pos = 0;
  for (const m of rows) {
    await c.query(
      `INSERT INTO metrics (name, category, unit, aggregation, higher_is_better, position, product_id, source, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
       ON CONFLICT ((coalesce(product_id, 0)), (lower(name))) DO ${keepExisting ? 'NOTHING' : 'UPDATE SET active = TRUE'}`,
      [m.name, m.category, m.unit, m.aggregation, m.higher_is_better, pos++, productId, m.source]
    );
  }
  return rows.length;
}

/*
 * One-time move to per-product KPIs:
 *  - give every product a type (best guess, editable later)
 *  - move the NET360-only metrics (students, lectures, MCQs) to NET360, keeping their history
 *  - retire company-wide metrics that never had data and are now covered per product
 *  - create each product's KPI set
 */
export async function upgradeToProductKpis(tx) {
  return tx(async (c) => {
    const done = await c.query("SELECT 1 FROM job_runs WHERE key = 'kpi_v5'");
    if (done.rowCount) return false;
    const { rows: products } = await c.query('SELECT * FROM products');
    for (const p of products) {
      if (!p.category) { p.category = guessType(p); await c.query('UPDATE products SET category = $2 WHERE id = $1', [p.id, p.category]); }
    }
    const net = products.find((p) => /net ?360/i.test(p.name)) || products.find((p) => p.category === 'education');
    if (net) {
      const moves = [['New signups / students', 'New student sign-ups'], ['Lecture videos uploaded', 'Lectures / videos published'], ['MCQs added to the bank', 'Practice questions added']];
      for (const [from, to] of moves) {
        await c.query(
          `UPDATE metrics SET product_id = $1, name = $3, category = CASE WHEN $3 = 'New student sign-ups' THEN 'Growth' ELSE 'Content' END
           WHERE product_id IS NULL AND name = $2 AND NOT EXISTS (SELECT 1 FROM metrics x WHERE x.product_id = $1 AND lower(x.name) = lower($3))`,
          [net.id, from, to]
        );
      }
    }
    // Company-wide metrics that only make sense per product: retire them if they never had data
    await c.query(
      `UPDATE metrics m SET active = FALSE WHERE m.product_id IS NULL AND m.name = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM metric_entries e WHERE e.metric_id = m.id)`,
      [['New signups / students', 'Lecture videos uploaded', 'MCQs added to the bank', 'YouTube subscribers gained', 'YouTube views', 'YouTube watch time', 'Play Store testers opted in', 'Website visitors']]
    );
    // Add each product's full set; metrics that already exist (e.g. the moved NET360 ones) are kept as they are
    for (const p of products) await setupProductKpis(c, p.id, p.category, null, { keepExisting: true });
    await c.query("INSERT INTO job_runs (key, run_on) VALUES ('kpi_v5', '2000-01-01')");
    return true;
  });
}
