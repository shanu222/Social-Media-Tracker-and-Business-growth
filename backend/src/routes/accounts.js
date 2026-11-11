import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { encrypt, decrypt } from '../crypto.js';
import { ah, parse, zDate, zInt, today } from '../util.js';

const router = Router();

const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'linkedin', 'threads', 'pinterest', 'website', 'other'];

const accountSchema = z.object({
  brand: z.string().trim().min(1).max(120),
  username: z.string().trim().min(1).max(120).transform((u) => u.replace(/^@/, '')),
  platform: z.enum(PLATFORMS).default('instagram'),
  profile_url: z.string().trim().url().max(500).or(z.literal('')).nullish(),
  content_theme: z.string().max(500).nullish(),
  youtube_status: z.string().max(120).nullish(),
  two_factor_enabled: z.boolean().default(false),
  login_email: z.string().max(200).nullish(),
  private_notes: z.string().max(5000).nullish(),
  baseline_date: zDate.optional(),
  baseline_posts: zInt.default(0),
  baseline_followers: zInt.default(0),
  baseline_following: zInt.default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
});

function present(row, role) {
  const canSeePrivate = role !== 'viewer';
  const { login_email_enc, private_notes_enc, ...rest } = row;
  return {
    ...rest,
    login_email: canSeePrivate ? decrypt(login_email_enc) : null,
    private_notes: canSeePrivate ? decrypt(private_notes_enc) : null,
  };
}

const LIST_SQL = `
  SELECT a.*,
    l.date AS last_date, l.followers AS last_followers, l.following AS last_following, l.posts AS last_posts,
    w.followers AS week_ago_followers
  FROM accounts a
  LEFT JOIN LATERAL (
    SELECT date, followers, following, posts FROM snapshots s
    WHERE s.account_id = a.id AND s.followers IS NOT NULL ORDER BY date DESC LIMIT 1
  ) l ON TRUE
  LEFT JOIN LATERAL (
    SELECT followers FROM snapshots s
    WHERE s.account_id = a.id AND s.followers IS NOT NULL AND s.date <= $1::date - 7 ORDER BY date DESC LIMIT 1
  ) w ON TRUE
`;

router.get(
  '/',
  ah(async (req, res) => {
    const includeArchived = req.query.archived === 'true';
    const rows = await many(
      `${LIST_SQL} ${includeArchived ? '' : 'WHERE a.archived = FALSE'} ORDER BY a.archived, a.id`,
      [today()]
    );
    res.json(rows.map((r) => present(r, req.user.role)));
  })
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const row = await one(`${LIST_SQL} WHERE a.id = $2`, [today(), id]);
    if (!row) return res.status(404).json({ error: 'Account not found.' });
    const history = await many(
      'SELECT * FROM snapshots WHERE account_id = $1 ORDER BY date DESC LIMIT 400',
      [id]
    );
    const reviews = await many('SELECT * FROM account_reviews WHERE account_id = $1 ORDER BY month DESC', [id]);
    res.json({ account: present(row, req.user.role), history: history.reverse(), reviews });
  })
);

function values(b) {
  return [
    b.brand,
    b.username,
    b.platform,
    b.profile_url || null,
    b.content_theme || null,
    b.youtube_status || 'Not noted',
    b.two_factor_enabled,
    encrypt(b.login_email),
    encrypt(b.private_notes),
    b.baseline_date || today(),
    b.baseline_posts,
    b.baseline_followers,
    b.baseline_following,
    b.color || null,
  ];
}

const INSERT_SQL = `INSERT INTO accounts
  (brand, username, platform, profile_url, content_theme, youtube_status, two_factor_enabled,
   login_email_enc, private_notes_enc, baseline_date, baseline_posts, baseline_followers, baseline_following, color)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`;

async function insertAccount(client, b, userId) {
  const { rows } = await client.query(INSERT_SQL, values(b));
  const acc = rows[0];
  // The baseline becomes the first data point so growth can be measured from day one.
  await client.query(
    `INSERT INTO snapshots (account_id, date, followers, following, posts, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (account_id, date) DO NOTHING`,
    [acc.id, acc.baseline_date, acc.baseline_followers, acc.baseline_following, acc.baseline_posts, userId]
  );
  return acc;
}

router.post(
  '/',
  requireRole('manager'),
  ah(async (req, res) => {
    const body = parse(accountSchema, req.body);
    const dup = await one('SELECT 1 FROM accounts WHERE platform = $1 AND lower(username) = lower($2)', [body.platform, body.username]);
    if (dup) return res.status(409).json({ error: `@${body.username} on ${body.platform} is already registered.` });
    const acc = await tx((c) => insertAccount(c, body, req.user.id));
    await audit(req, 'account.created', 'account', acc.id, { brand: acc.brand, username: acc.username });
    res.status(201).json(present(acc, req.user.role));
  })
);

/** Bulk import (rows parsed from CSV in the browser). Skips duplicates. */
router.post(
  '/import',
  requireRole('manager'),
  ah(async (req, res) => {
    const { rows } = parse(z.object({ rows: z.array(z.any()).min(1).max(500) }), req.body);
    let created = 0;
    const skipped = [];
    await tx(async (c) => {
      for (const [i, raw] of rows.entries()) {
        const r = accountSchema.safeParse(raw);
        if (!r.success) {
          skipped.push({ row: i + 1, reason: r.error.issues[0].path.join('.') + ' ' + r.error.issues[0].message });
          continue;
        }
        const { rows: d } = await c.query(
          'SELECT 1 FROM accounts WHERE platform = $1 AND lower(username) = lower($2)',
          [r.data.platform, r.data.username]
        );
        if (d.length) {
          skipped.push({ row: i + 1, reason: `@${r.data.username} already exists` });
          continue;
        }
        await insertAccount(c, r.data, req.user.id);
        created++;
      }
    });
    await audit(req, 'account.imported', 'account', null, { created, skipped: skipped.length });
    res.json({ created, skipped });
  })
);

router.put(
  '/:id',
  requireRole('manager'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const body = parse(accountSchema.extend({ archived: z.boolean().optional() }), req.body);
    const current = await one('SELECT * FROM accounts WHERE id = $1', [id]);
    if (!current) return res.status(404).json({ error: 'Account not found.' });
    // Keep encrypted values when the client didn't send them (e.g. viewer-masked forms)
    const loginEnc = body.login_email === undefined ? current.login_email_enc : encrypt(body.login_email);
    const notesEnc = body.private_notes === undefined ? current.private_notes_enc : encrypt(body.private_notes);
    const acc = await one(
      `UPDATE accounts SET brand=$2, username=$3, platform=$4, profile_url=$5, content_theme=$6, youtube_status=$7,
        two_factor_enabled=$8, login_email_enc=$9, private_notes_enc=$10, baseline_date=$11, baseline_posts=$12,
        baseline_followers=$13, baseline_following=$14, color=$15, archived=$16
       WHERE id=$1 RETURNING *`,
      [
        id,
        body.brand,
        body.username,
        body.platform,
        body.profile_url || null,
        body.content_theme || null,
        body.youtube_status || 'Not noted',
        body.two_factor_enabled,
        loginEnc,
        notesEnc,
        body.baseline_date || current.baseline_date,
        body.baseline_posts,
        body.baseline_followers,
        body.baseline_following,
        body.color || null,
        body.archived ?? current.archived,
      ]
    );
    await audit(req, 'account.updated', 'account', id, { brand: acc.brand });
    res.json(present(acc, req.user.role));
  })
);

router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const acc = await one('DELETE FROM accounts WHERE id = $1 RETURNING brand, username', [id]);
    if (!acc) return res.status(404).json({ error: 'Account not found.' });
    await audit(req, 'account.deleted', 'account', id, acc);
    res.json({ ok: true });
  })
);

export default router;
