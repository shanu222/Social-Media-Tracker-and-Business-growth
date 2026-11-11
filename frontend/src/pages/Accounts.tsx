import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Upload, ShieldCheck, ShieldAlert, Pencil, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, AccountLabel, fmt, signed, tone, todayStr, type Account } from '../lib';

const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'linkedin', 'threads', 'pinterest', 'website', 'other'];

export default function Accounts() {
  const { can } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const { data, error, loading, reload } = useData<Account[]>(`/accounts?archived=${showArchived}`);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p>The register of every page you manage, with starting numbers. Login emails and private notes are encrypted before they are stored.</p>
        </div>
        <div className="page-actions">
          <label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
          {can('manager') && <button className="btn" onClick={() => setImporting(true)}><Upload /> Import CSV</button>}
          {can('manager') && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus /> Add account</button>}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="panel empty">
          <h3>No accounts registered</h3>
          <p>Add each Instagram, YouTube or other page with today's posts, followers and following as the baseline.</p>
          {can('manager') && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus /> Add account</button>}
        </div>
      ) : (
        <div className="panel">
          <div className="table-wrap" style={{ padding: 8 }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Account</th><th>Platform</th>
                  <th className="r">Followers</th><th className="r">7-day change</th><th className="r">Posts</th><th className="r">Following</th>
                  <th>Security</th><th>YouTube</th><th />
                </tr>
              </thead>
              <tbody>
                {data.map((a) => {
                  const f = a.last_followers ?? a.baseline_followers;
                  const wk = a.week_ago_followers !== null && a.week_ago_followers !== undefined ? f - a.week_ago_followers : null;
                  return (
                    <tr key={a.id} style={a.archived ? { opacity: 0.55 } : undefined}>
                      <td><Link to={`/accounts/${a.id}`} style={{ textDecoration: 'none' }}><AccountLabel a={a} /></Link></td>
                      <td style={{ textTransform: 'capitalize' }}>{a.platform}</td>
                      <td className="r num">{fmt(f)}</td>
                      <td className={`r num ${tone(wk)}`}>{signed(wk)}</td>
                      <td className="r num">{fmt(a.last_posts ?? a.baseline_posts)}</td>
                      <td className="r num">{fmt(a.last_following ?? a.baseline_following)}</td>
                      <td>{a.two_factor_enabled ? <span className="badge badge-good"><ShieldCheck size={13} /> 2FA on</span> : <span className="badge badge-bad"><ShieldAlert size={13} /> 2FA off</span>}</td>
                      <td className="muted">{a.youtube_status || '—'}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        {a.profile_url && <a className="btn btn-ghost btn-icon" href={a.profile_url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${a.brand}`}><ExternalLink size={16} /></a>}
                        {can('manager') && <button className="btn btn-ghost btn-icon" onClick={() => setEditing(a)} aria-label={`Edit ${a.brand}`}><Pencil size={16} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {editing && <AccountForm account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); }} />}
    </>
  );
}

export function AccountForm({ account, onClose, onSaved, onDeleted }: { account: Account | null; onClose: () => void; onSaved: () => void; onDeleted?: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [f, setF] = useState({
    brand: account?.brand || '',
    username: account?.username || '',
    platform: account?.platform || 'instagram',
    profile_url: account?.profile_url || '',
    content_theme: account?.content_theme || '',
    youtube_status: account?.youtube_status || 'Not noted',
    two_factor_enabled: account?.two_factor_enabled || false,
    login_email: account?.login_email || '',
    private_notes: account?.private_notes || '',
    baseline_date: account?.baseline_date || todayStr(),
    baseline_posts: String(account?.baseline_posts ?? 0),
    baseline_followers: String(account?.baseline_followers ?? 0),
    baseline_following: String(account?.baseline_following ?? 0),
    color: account?.color || '',
    archived: account?.archived || false,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      ...f,
      baseline_posts: Number(f.baseline_posts) || 0,
      baseline_followers: Number(f.baseline_followers) || 0,
      baseline_following: Number(f.baseline_following) || 0,
      color: f.color || null,
    };
    try {
      if (account) await api.put(`/accounts/${account.id}`, body);
      else await api.post('/accounts', body);
      toast(account ? 'Account updated' : 'Account added');
      onSaved();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!account || !window.confirm(`Delete ${account.brand} and all its logged numbers? This cannot be undone. Archive it instead to keep history.`)) return;
    try {
      await api.del(`/accounts/${account.id}`);
      toast('Account deleted');
      (onDeleted || onSaved)();
    } catch (err) {
      toast((err as Error).message, true);
    }
  }

  const num = (k: 'baseline_posts' | 'baseline_followers' | 'baseline_following', label: string) => (
    <div className="field">
      <label htmlFor={k}>{label}</label>
      <input id={k} className="input input-num" inputMode="numeric" value={f[k]} onChange={(e) => /^\d*$/.test(e.target.value) && set(k, e.target.value)} />
    </div>
  );

  return (
    <Modal
      title={account ? `Edit ${account.brand}` : 'Add account'}
      onClose={onClose}
      footer={
        <>
          {account && can('admin') && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={remove}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="acct-form" disabled={busy}>{busy ? 'Saving…' : account ? 'Save changes' : 'Add account'}</button>
        </>
      }
    >
      <form id="acct-form" className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="brand">Brand name</label><input id="brand" className="input" required value={f.brand} onChange={(e) => set('brand', e.target.value)} /></div>
        <div className="field"><label htmlFor="username">Username</label><input id="username" className="input" required value={f.username} onChange={(e) => set('username', e.target.value)} placeholder="without @" /></div>
        <div className="field">
          <label htmlFor="platform">Platform</label>
          <select id="platform" className="input" value={f.platform} onChange={(e) => set('platform', e.target.value)}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="url">Profile link</label><input id="url" className="input" type="url" value={f.profile_url} onChange={(e) => set('profile_url', e.target.value)} placeholder="https://instagram.com/…" /></div>
        {num('baseline_posts', 'Starting posts')}
        {num('baseline_followers', 'Starting followers')}
        {num('baseline_following', 'Starting following')}
        <div className="field"><label htmlFor="bdate">Tracking started</label><input id="bdate" type="date" className="input" value={f.baseline_date} onChange={(e) => set('baseline_date', e.target.value)} /></div>
        <div className="field"><label htmlFor="yt">YouTube channel</label><input id="yt" className="input" value={f.youtube_status} onChange={(e) => set('youtube_status', e.target.value)} placeholder="Created, Pending, Not noted…" /></div>
        <div className="field"><label htmlFor="theme">Content theme</label><input id="theme" className="input" value={f.content_theme} onChange={(e) => set('content_theme', e.target.value)} /></div>
        <div className="field"><label htmlFor="lemail">Login email</label><input id="lemail" className="input" value={f.login_email} onChange={(e) => set('login_email', e.target.value)} autoComplete="off" /><span className="hint">Encrypted. Never store passwords here — use a password manager.</span></div>
        <div className="field"><label htmlFor="color">Chart colour</label><input id="color" type="color" className="input" style={{ padding: 3 }} value={f.color || '#0b7a62'} onChange={(e) => set('color', e.target.value)} /></div>
        <div className="field full"><label htmlFor="notes">Private notes</label><textarea id="notes" className="input" value={f.private_notes} onChange={(e) => set('private_notes', e.target.value)} /><span className="hint">Encrypted. Hidden from viewer-role users.</span></div>
        <label className="check full"><input type="checkbox" checked={f.two_factor_enabled} onChange={(e) => set('two_factor_enabled', e.target.checked)} /> Two-factor authentication is turned on</label>
        {account && <label className="check full"><input type="checkbox" checked={f.archived} onChange={(e) => set('archived', e.target.checked)} /> Archive this account (hide it but keep history)</label>}
      </form>
    </Modal>
  );
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const ALIASES: Record<string, string> = {
  'account': 'brand', 'brand': 'brand', 'account / brand': 'brand', 'name': 'brand',
  'username': 'username', 'handle': 'username', 'platform': 'platform',
  'posts': 'baseline_posts', 'followers': 'baseline_followers', 'following': 'baseline_following',
  'youtube': 'youtube_status', 'notes': 'private_notes', 'url': 'profile_url', 'profile_url': 'profile_url',
  'login email': 'login_email', 'login_email': 'login_email', '2fa': 'two_factor_enabled',
};

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);

  function onFile(file: File) {
    file.text().then((t) => {
      const [head, ...body] = parseCsv(t);
      const keys = head.map((h) => ALIASES[h.trim().toLowerCase()] || null);
      setRows(
        body.map((r) => {
          const o: Record<string, unknown> = {};
          keys.forEach((k, i) => {
            if (!k) return;
            const v = (r[i] || '').trim();
            if (k.startsWith('baseline_')) o[k] = Number(v.replace(/,/g, '')) || 0;
            else if (k === 'two_factor_enabled') o[k] = /^(y|yes|true|on|1)$/i.test(v);
            else if (k === 'platform') o[k] = v.toLowerCase() || 'instagram';
            else o[k] = v;
          });
          return o;
        })
      );
    });
  }

  async function run() {
    setBusy(true);
    try {
      const r = await api.post<{ created: number; skipped: { row: number; reason: string }[] }>('/accounts/import', { rows });
      toast(`Imported ${r.created} accounts${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}`);
      onDone();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import accounts from CSV" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!rows.length || busy} onClick={run}>{busy ? 'Importing…' : `Import ${rows.length || ''} accounts`}</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="muted">The first row must be headers. Recognised columns: <b>Brand, Username, Platform, Posts, Followers, Following, YouTube, Login email, 2FA, URL, Notes</b>. Accounts that already exist are skipped.</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {rows.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 260, border: '1px solid var(--line)', borderRadius: 10 }}>
            <table className="t">
              <thead><tr><th>Brand</th><th>Username</th><th className="r">Posts</th><th className="r">Followers</th><th className="r">Following</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}><td>{String(r.brand || '')}</td><td>{String(r.username || '')}</td><td className="r">{String(r.baseline_posts ?? '')}</td><td className="r">{String(r.baseline_followers ?? '')}</td><td className="r">{String(r.baseline_following ?? '')}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
