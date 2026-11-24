import { many, one, query } from '../db.js';
import { today } from '../util.js';

/**
 * Pulls follower / post counts through each platform's OFFICIAL API only.
 * No scraping, no logging in with passwords — nothing that risks an account ban.
 *
 *  YouTube    YouTube Data API v3 (YOUTUBE_API_KEY env)            external_id = channel ID (UC…) or @handle
 *  Telegram   Bot API getChatMemberCount (TELEGRAM_BOT_TOKEN env)  external_id = @channelusername or chat id
 *  Discord    Public invite endpoint with_counts=true              external_id = invite code (e.g. abc123)
 *  Instagram, Facebook, LinkedIn, TikTok, X and others are logged manually in Daily update
 *  (Meta's API needs a developer app and tokens that expire, so it is not worth the upkeep here).
 */

const TIMEOUT = 15000;

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'GrowthDesk/1.0' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || data?.description || data?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

export const SYNC_SUPPORT = {
  youtube: { needs: 'Channel link, @handle or Channel ID (YOUTUBE_API_KEY on the server)', token: false },
  telegram: { needs: 'TELEGRAM_BOT_TOKEN on the server; channel @username (bot must be added to private channels)', token: false },
  discord: { needs: 'A permanent invite code for the server (the part after discord.gg/)', token: false },
};

const fetchers = {
  async youtube(acc) {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new Error('YOUTUBE_API_KEY is not set on the server.');
    const tries = youtubeLookups(acc);
    if (!tries.length) throw new Error('Add the channel link, @handle or Channel ID to this account.');
    for (const q of tries) {
      const d = await getJson(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&${q}&key=${key}`);
      const ch = d.items?.[0];
      if (!ch?.statistics) continue;
      const s = ch.statistics;
      // Remember the permanent channel ID so later syncs never depend on a handle that can change
      if (!/^UC[\w-]{22}$/.test(acc.external_id || '')) {
        await query('UPDATE accounts SET external_id = $2 WHERE id = $1', [acc.id, ch.id]).catch(() => {});
      }
      return {
        followers: s.hiddenSubscriberCount ? null : Number(s.subscriberCount),
        posts: Number(s.videoCount),
        extra: { total_views: Number(s.viewCount), channel_id: ch.id, channel_title: ch.snippet?.title || null },
      };
    }
    throw new Error(`Channel not found for ${tries.map((q) => decodeURIComponent(q.split('=')[1])).join(' / ')}. Check the channel link or @handle.`);
  },
  async telegram(acc) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set on the server.');
    let chat = acc.external_id || acc.username;
    if (!/^-?\d+$/.test(chat) && !chat.startsWith('@')) chat = '@' + chat;
    const d = await getJson(`https://api.telegram.org/bot${token}/getChatMemberCount?chat_id=${encodeURIComponent(chat)}`);
    return { followers: Number(d.result) };
  },
  async discord(acc) {
    const code = (acc.external_id || '').replace(/^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//, '');
    if (!code) throw new Error('Add the server invite code first.');
    const d = await getJson(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`);
    return { followers: Number(d.approximate_member_count), extra: { online: Number(d.approximate_presence_count) } };
  },
};

/**
 * Every way we can look the channel up, most reliable first, from whatever was entered:
 * Channel ID (UC…), @handle, channel/handle/user/c links (with or without ?si=… share parameters),
 * the profile URL, or the username.
 */
export function youtubeLookups(acc) {
  const out = [];
  const add = (q) => { if (q && !out.includes(q)) out.push(q); };
  for (const raw of [acc.external_id, acc.profile_url, acc.username]) {
    let v = String(raw || '').trim();
    if (!v) continue;
    const uc = /(UC[\w-]{22})/.exec(v);
    if (uc) { add(`id=${uc[1]}`); continue; }
    if (/youtu\.?be|youtube\.com|^www\.|^m\./i.test(v)) {
      try {
        const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
        const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        if (parts[0]?.startsWith('@')) add(`forHandle=${encodeURIComponent(parts[0])}`);
        else if (parts[0] === 'user' && parts[1]) { add(`forUsername=${encodeURIComponent(parts[1])}`); add(`forHandle=${encodeURIComponent('@' + parts[1])}`); }
        else if (parts[0] === 'c' && parts[1]) add(`forHandle=${encodeURIComponent('@' + parts[1])}`);
        else if (parts.length === 1 && !['watch', 'shorts', 'playlist', 'results'].includes(parts[0])) add(`forHandle=${encodeURIComponent('@' + parts[0])}`);
      } catch { /* not a link */ }
      continue;
    }
    // A plain handle only (no spaces) — never guess from a display name, it could match someone else's channel
    v = v.split(/[?#]/)[0];
    if (/^@?[\w.-]{3,}$/.test(v)) add(`forHandle=${encodeURIComponent(v.startsWith('@') ? v : '@' + v)}`);
  }
  return out;
}

export function canSync(platform) {
  return Boolean(fetchers[platform]);
}

/** Sync one account. Writes into today's snapshot without overwriting manually logged fields it doesn't know. */
export async function syncAccount(accountId) {
  const acc = await one('SELECT * FROM accounts WHERE id = $1', [accountId]);
  if (!acc) throw new Error('Account not found');
  const fn = fetchers[acc.platform];
  if (!fn) {
    const err = new Error(`Automatic sync isn't available for ${acc.platform}. Log its numbers in Daily update.`);
    err.status = 400;
    throw err;
  }
  try {
    const r = await fn(acc);
    const date = today();
    await query(
      `INSERT INTO snapshots (account_id, date, followers, following, posts, extra, notes)
       VALUES ($1,$2,$3,$4,$5,$6,NULL)
       ON CONFLICT (account_id, date) DO UPDATE SET
         followers = COALESCE(EXCLUDED.followers, snapshots.followers),
         following = COALESCE(EXCLUDED.following, snapshots.following),
         posts     = COALESCE(EXCLUDED.posts, snapshots.posts),
         extra     = COALESCE(snapshots.extra, '{}'::jsonb) || COALESCE(EXCLUDED.extra, '{}'::jsonb),
         updated_at = now()`,
      [acc.id, date, r.followers ?? null, r.following ?? null, r.posts ?? null, r.extra ? JSON.stringify(r.extra) : null]
    );
    await query('UPDATE accounts SET last_synced_at = now(), sync_error = NULL WHERE id = $1', [acc.id]);
    return { ok: true, ...r };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'The platform did not respond in time.' : e.message;
    await query('UPDATE accounts SET sync_error = $2, last_synced_at = now() WHERE id = $1', [acc.id, msg.slice(0, 300)]);
    const err = new Error(`Sync failed: ${msg}`);
    err.status = 502;
    throw err;
  }
}

/** Once: switch automatic sync on for YouTube channels that were added before sync was on by default. */
export async function enableYoutubeSync() {
  const first = await one("INSERT INTO job_runs (key, run_on) VALUES ('youtube_sync_on', DATE '2000-01-01') ON CONFLICT DO NOTHING RETURNING key").catch(() => null);
  if (!first) return 0;
  const r = await query(`UPDATE accounts SET sync_enabled = TRUE
    WHERE platform = 'youtube' AND archived = FALSE AND sync_enabled = FALSE
      AND coalesce(nullif(external_id, ''), nullif(profile_url, ''), nullif(username, '')) IS NOT NULL`);
  return r.rowCount;
}

export async function syncAll() {
  const accounts = await many('SELECT id, platform FROM accounts WHERE sync_enabled = TRUE AND archived = FALSE');
  let ok = 0, failed = 0;
  for (const a of accounts) {
    if (!canSync(a.platform)) continue;
    try {
      await syncAccount(a.id);
      ok++;
    } catch {
      failed++;
    }
  }
  return { ok, failed };
}
