import { many, one, query } from '../db.js';
import { decrypt } from '../crypto.js';
import { today } from '../util.js';

/**
 * Pulls follower / post counts through each platform's OFFICIAL API only.
 * No scraping, no logging in with passwords — nothing that risks an account ban.
 *
 *  YouTube    YouTube Data API v3 (YOUTUBE_API_KEY env)            external_id = channel ID (UC…) or @handle
 *  Telegram   Bot API getChatMemberCount (TELEGRAM_BOT_TOKEN env)  external_id = @channelusername or chat id
 *  Discord    Public invite endpoint with_counts=true              external_id = invite code (e.g. abc123)
 *  Instagram  Instagram Graph API (business/creator account)       external_id = IG user id, token = long-lived access token
 *  Facebook   Facebook Graph API (Page)                            external_id = Page id, token = Page access token
 *  LinkedIn / X / TikTok and others need partner-approved apps → log numbers manually in Daily update.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
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
  youtube: { needs: 'YOUTUBE_API_KEY on the server; Channel ID (starts with UC) or @handle', token: false },
  telegram: { needs: 'TELEGRAM_BOT_TOKEN on the server; channel @username (bot must be added to private channels)', token: false },
  discord: { needs: 'A permanent invite code for the server (the part after discord.gg/)', token: false },
  instagram: { needs: 'Instagram business/creator user ID and a long-lived access token from Meta', token: true },
  facebook: { needs: 'Facebook Page ID and a Page access token from Meta', token: true },
};

const fetchers = {
  async youtube(acc) {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new Error('YOUTUBE_API_KEY is not set on the server.');
    const id = acc.external_id || acc.username;
    const q = id.startsWith('UC') ? `id=${encodeURIComponent(id)}` : `forHandle=${encodeURIComponent(id.startsWith('@') ? id : '@' + id)}`;
    const d = await getJson(`https://www.googleapis.com/youtube/v3/channels?part=statistics&${q}&key=${key}`);
    const s = d.items?.[0]?.statistics;
    if (!s) throw new Error('Channel not found. Check the Channel ID or handle.');
    return {
      followers: s.hiddenSubscriberCount ? null : Number(s.subscriberCount),
      posts: Number(s.videoCount),
      extra: { total_views: Number(s.viewCount) },
    };
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
  async instagram(acc) {
    const token = decrypt(acc.api_token_enc);
    if (!acc.external_id || !token) throw new Error('Add the Instagram user ID and access token first.');
    const d = await getJson(`${GRAPH}/${encodeURIComponent(acc.external_id)}?fields=followers_count,follows_count,media_count&access_token=${encodeURIComponent(token)}`);
    return { followers: d.followers_count ?? null, following: d.follows_count ?? null, posts: d.media_count ?? null };
  },
  async facebook(acc) {
    const token = decrypt(acc.api_token_enc);
    if (!acc.external_id || !token) throw new Error('Add the Page ID and Page access token first.');
    const d = await getJson(`${GRAPH}/${encodeURIComponent(acc.external_id)}?fields=followers_count,fan_count&access_token=${encodeURIComponent(token)}`);
    return { followers: d.followers_count ?? d.fan_count ?? null, extra: { page_likes: d.fan_count ?? null } };
  },
};

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
