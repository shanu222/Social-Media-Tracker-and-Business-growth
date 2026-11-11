import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, Wand2 } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Modal, PLATFORMS, platformOf, todayStr, type Account } from '../lib';

const AUTO_SYNC = ['youtube', 'telegram', 'discord'];
const NO_FOLLOWING = ['youtube', 'telegram', 'discord', 'website', 'whatsapp'];
const FOLLOWER_WORD: Record<string, string> = { youtube: 'Subscribers', telegram: 'Members', discord: 'Members' };
const POSTS_WORD: Record<string, string> = { youtube: 'Videos' };

export interface Parsed { platform?: string; username?: string; external_id?: string; profile_url?: string }

/** Work out platform, username and the sync ID from a pasted link or @handle. */
export function parseProfile(raw: string): Parsed {
  const s = raw.trim();
  if (!s) return {};
  if (!/^https?:\/\//i.test(s) && !s.includes('/')) {
    const h = s.replace(/^@/, '');
    return { username: h };
  }
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return {}; }
  const host = url.hostname.replace(/^www\.|^m\.|^web\./, '').toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  const clean = `${url.protocol}//${url.hostname}${url.pathname}`.replace(/\/$/, '/');
  const first = decodeURIComponent(parts[0] || '');
  if (host.endsWith('instagram.com')) return { platform: 'instagram', username: first, profile_url: `https://www.instagram.com/${first}/` };
  if (host.endsWith('youtube.com') || host === 'youtu.be') {
    if (first.startsWith('@')) return { platform: 'youtube', username: first.slice(1), external_id: first, profile_url: `https://www.youtube.com/${first}` };
    if (first === 'channel' && parts[1]) return { platform: 'youtube', external_id: parts[1], profile_url: `https://www.youtube.com/channel/${parts[1]}` };
    if ((first === 'c' || first === 'user') && parts[1]) return { platform: 'youtube', username: parts[1], external_id: `@${parts[1]}`, profile_url: clean };
    return { platform: 'youtube', profile_url: clean };
  }
  if (host === 't.me' || host === 'telegram.me') return { platform: 'telegram', username: first, external_id: `@${first}`, profile_url: `https://t.me/${first}` };
  if (host === 'discord.gg') return { platform: 'discord', external_id: first, profile_url: `https://discord.gg/${first}` };
  if (host.endsWith('discord.com') && first === 'invite' && parts[1]) return { platform: 'discord', external_id: parts[1], profile_url: `https://discord.gg/${parts[1]}` };
  if (host.endsWith('facebook.com') || host === 'fb.com') {
    const isShare = ['share', 'profile.php', 'people', 'groups'].includes(first);
    return { platform: 'facebook', username: isShare ? undefined : first, profile_url: url.toString().split('?')[0] };
  }
  if (host.endsWith('linkedin.com')) return { platform: 'linkedin', username: parts[1] || first, profile_url: clean };
  if (host.endsWith('tiktok.com')) return { platform: 'tiktok', username: first.replace(/^@/, ''), profile_url: clean };
  if (host === 'x.com' || host.endsWith('twitter.com')) return { platform: 'x', username: first, profile_url: `https://x.com/${first}` };
  if (host.endsWith('threads.net') || host.endsWith('threads.com')) return { platform: 'threads', username: first.replace(/^@/, ''), profile_url: clean };
  if (host.endsWith('pinterest.com')) return { platform: 'pinterest', username: first, profile_url: clean };
  if (host === 'wa.me' || host.endsWith('whatsapp.com')) return { platform: 'whatsapp', username: first || host, profile_url: clean };
  return { platform: 'website', username: host, profile_url: clean };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export default function AccountForm({ account, onClose, onSaved, onDeleted, defaultProductId }: {
  account: Account | null; onClose: () => void; onSaved: () => void; onDeleted?: () => void; defaultProductId?: number;
}) {
  const toast = useToast();
  const { can } = useAuth();
  const products = useData<{ id: number; name: string }[]>('/products');
  const sync = useData<{ youtubeKey: boolean; telegramToken: boolean }>('/accounts/sync-support');
  const [link, setLink] = useState(account?.profile_url || '');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    platform: account?.platform || 'instagram',
    product_id: account?.product_id ? String(account.product_id) : defaultProductId ? String(defaultProductId) : '',
    username: account?.username || '',
    external_id: account?.external_id || '',
    brand: account?.brand || '',
    baseline_followers: account ? String(account.baseline_followers) : '',
    baseline_posts: account ? String(account.baseline_posts) : '',
    baseline_following: account ? String(account.baseline_following) : '',
    baseline_date: account?.baseline_date || todayStr(),
    sync_enabled: account ? Boolean(account.sync_enabled) : false,
    content_theme: account?.content_theme || '',
    login_email: account?.login_email || '',
    private_notes: account?.private_notes || '',
    two_factor_enabled: account?.two_factor_enabled || false,
    color: account?.color || '',
    archived: account?.archived || false,
  });
  const [touchedBrand, setTouchedBrand] = useState(Boolean(account));
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const productName = products.data?.find((p) => String(p.id) === f.product_id)?.name || '';
  const auto = AUTO_SYNC.includes(f.platform);
  const keyMissing = (f.platform === 'youtube' && sync.data && !sync.data.youtubeKey) || (f.platform === 'telegram' && sync.data && !sync.data.telegramToken);

  // Paste a link → fill platform, username and sync ID
  function onLink(v: string) {
    setLink(v);
    const p = parseProfile(v);
    setF((x) => {
      const platform = p.platform || x.platform;
      return {
        ...x,
        platform,
        username: p.username ?? x.username,
        external_id: p.external_id ?? (platform === x.platform ? x.external_id : ''),
        sync_enabled: account ? x.sync_enabled : AUTO_SYNC.includes(platform),
      };
    });
  }
  function onPlatform(pl: string) {
    setF((x) => ({ ...x, platform: pl, sync_enabled: account ? x.sync_enabled : AUTO_SYNC.includes(pl) }));
  }
  const autoBrand = useMemo(() => `${productName || 'Account'} ${platformOf(f.platform).label}`.trim(), [productName, f.platform]);
  useEffect(() => { if (!touchedBrand) setF((x) => ({ ...x, brand: autoBrand })); }, [autoBrand, touchedBrand]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const username = (f.username || slug(productName ? `${productName}-${f.platform}` : link || 'account')).replace(/^@/, '');
    const external = f.external_id || (auto && f.platform !== 'discord' && username ? `@${username}` : '');
    if (f.platform === 'discord' && f.sync_enabled && !external) return toast('Paste the Discord invite link (discord.gg/…) so members can be counted.', true);
    setBusy(true);
    const num = (v: string) => Number(v) || 0;
    const body = {
      brand: f.brand || autoBrand,
      username,
      platform: f.platform,
      product_id: f.product_id ? Number(f.product_id) : null,
      profile_url: parseProfile(link).profile_url || (link && /^https?:\/\//.test(link) ? link : ''),
      external_id: external || null,
      sync_enabled: auto && f.sync_enabled,
      baseline_followers: num(f.baseline_followers),
      baseline_posts: num(f.baseline_posts),
      baseline_following: NO_FOLLOWING.includes(f.platform) ? 0 : num(f.baseline_following),
      baseline_date: f.baseline_date,
      content_theme: f.content_theme || null,
      login_email: f.login_email || null,
      private_notes: f.private_notes || null,
      two_factor_enabled: f.two_factor_enabled,
      color: f.color || platformOf(f.platform).color,
      youtube_status: account?.youtube_status || null,
      archived: f.archived,
    };
    try {
      const r = account ? await api.put<Account & { synced?: boolean }>(`/accounts/${account.id}`, body) : await api.post<Account & { synced?: boolean }>('/accounts', body);
      toast(r.synced ? `Added — ${r.baseline_followers.toLocaleString()} ${(FOLLOWER_WORD[f.platform] || 'followers').toLowerCase()} fetched automatically` : account ? 'Account updated' : 'Account added');
      onSaved();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }

  async function remove() {
    if (!account || !window.confirm(`Delete ${account.brand} and all its logged numbers? Archive it instead to keep history.`)) return;
    try { await api.del(`/accounts/${account.id}`); toast('Account deleted'); (onDeleted || onSaved)(); } catch (err) { toast((err as Error).message, true); }
  }

  const numField = (k: 'baseline_followers' | 'baseline_posts' | 'baseline_following', label: string) => (
    <div className="field">
      <label htmlFor={k}>{label}</label>
      <input id={k} className="input input-num" inputMode="numeric" placeholder={auto && f.sync_enabled && !account ? 'Auto' : '0'} value={f[k]} onChange={(e) => /^\d*$/.test(e.target.value) && set(k, e.target.value)} />
    </div>
  );

  return (
    <Modal title={account ? `Edit ${account.brand}` : 'Add account'} onClose={onClose}
      footer={<>
        {account && can('admin') && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={remove}>Delete</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" form="acct-form" disabled={busy}>{busy ? (auto && f.sync_enabled ? 'Adding & fetching numbers…' : 'Saving…') : account ? 'Save changes' : 'Add account'}</button>
      </>}>
      <form id="acct-form" className="form-grid" onSubmit={submit}>
        <div className="field full">
          <label htmlFor="link">Profile link</label>
          <input id="link" className="input" autoFocus={!account} value={link} onChange={(e) => onLink(e.target.value)} placeholder="Paste the page link, e.g. https://instagram.com/yourpage or youtube.com/@channel" />
          <span className="hint"><Wand2 size={12} style={{ verticalAlign: -2 }} /> Platform and username fill in automatically from the link.</span>
        </div>
        <div className="field full">
          <label>Platform</label>
          <div className="chips-select">
            {PLATFORMS.filter((p) => p.id !== 'other').map((p) => (
              <button type="button" key={p.id} className={f.platform === p.id ? 'on' : ''} onClick={() => onPlatform(p.id)} aria-pressed={f.platform === p.id}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="un">Username</label>
          <input id="un" className="input" value={f.username} onChange={(e) => set('username', e.target.value.replace(/^@/, ''))} placeholder="without @" />
        </div>
        <div className="field">
          <label htmlFor="prod">Product</label>
          <select id="prod" className="input" value={f.product_id} onChange={(e) => set('product_id', e.target.value)}>
            <option value="">Not linked</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {auto && (
          <div className="full notice info" style={{ display: 'block' }}>
            <label className="check" style={{ fontWeight: 500 }}>
              <input type="checkbox" checked={f.sync_enabled} onChange={(e) => set('sync_enabled', e.target.checked)} />
              Get {(FOLLOWER_WORD[f.platform] || 'follower').toLowerCase()} automatically (free, updates every 6 hours)
            </label>
            {f.sync_enabled && f.platform === 'discord' && !f.external_id && <div style={{ marginTop: 4 }}>Paste a permanent invite link (discord.gg/…) above.</div>}
            {f.sync_enabled && keyMissing && <div className="down" style={{ marginTop: 4 }}>{f.platform === 'youtube' ? 'YOUTUBE_API_KEY' : 'TELEGRAM_BOT_TOKEN'} isn't set on Railway yet — numbers will start once it is.</div>}
            {f.sync_enabled && !account && <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>Leave the numbers below empty — they're fetched when you save.</div>}
          </div>
        )}

        {numField('baseline_followers', FOLLOWER_WORD[f.platform] || 'Followers')}
        {numField('baseline_posts', POSTS_WORD[f.platform] || 'Posts')}
        {!NO_FOLLOWING.includes(f.platform) && numField('baseline_following', 'Following')}

        <div className="full">
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: -8 }} onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <ChevronDown size={15} style={{ transform: more ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} /> More options
          </button>
        </div>
        {more && (
          <>
            <div className="field"><label htmlFor="brand">Display name</label><input id="brand" className="input" value={f.brand} onChange={(e) => { setTouchedBrand(true); set('brand', e.target.value); }} /></div>
            {auto && <div className="field"><label htmlFor="ext">{f.platform === 'discord' ? 'Invite code' : f.platform === 'youtube' ? 'Channel ID or @handle' : 'Channel @username'}</label><input id="ext" className="input" value={f.external_id} onChange={(e) => set('external_id', e.target.value)} placeholder={f.username ? `@${f.username}` : ''} /></div>}
            <div className="field"><label htmlFor="bdate">Tracking started</label><input id="bdate" type="date" className="input" value={f.baseline_date} onChange={(e) => set('baseline_date', e.target.value)} /></div>
            <div className="field"><label htmlFor="theme">Content theme</label><input id="theme" className="input" value={f.content_theme} onChange={(e) => set('content_theme', e.target.value)} /></div>
            {can('admin') && <div className="field"><label htmlFor="lemail">Login email</label><input id="lemail" className="input" value={f.login_email} onChange={(e) => set('login_email', e.target.value)} autoComplete="off" /><span className="hint">Encrypted, admin only. Never store passwords here.</span></div>}
            <div className="field"><label htmlFor="color">Chart colour</label><input id="color" type="color" className="input" style={{ padding: 3 }} value={f.color || platformOf(f.platform).color} onChange={(e) => set('color', e.target.value)} /></div>
            {can('admin') && <div className="field full"><label htmlFor="notes">Private notes</label><textarea id="notes" className="input" value={f.private_notes} onChange={(e) => set('private_notes', e.target.value)} /></div>}
            <label className="check full"><input type="checkbox" checked={f.two_factor_enabled} onChange={(e) => set('two_factor_enabled', e.target.checked)} /> Two-factor authentication is on</label>
            {account && <label className="check full"><input type="checkbox" checked={f.archived} onChange={(e) => set('archived', e.target.checked)} /> Archive (hide but keep history)</label>}
          </>
        )}
      </form>
    </Modal>
  );
}
