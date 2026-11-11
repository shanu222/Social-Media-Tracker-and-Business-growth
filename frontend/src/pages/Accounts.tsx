import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Upload, ShieldCheck, ShieldAlert, Pencil, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, AccountLabel, fmt, signed, tone, todayStr, type Account } from '../lib';

import { PLATFORMS as PLATFORM_LIST, PlatformChip } from '../lib';
const PLATFORMS = PLATFORM_LIST.map((p) => p.id);
const AUTO_SYNC = ['youtube', 'telegram', 'discord'];
interface SyncSupport { support: Record<string, { needs: string; token: boolean }>; youtubeKey: boolean; telegramToken: boolean }

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
          <p>{can('admin') ? 'Every social account, with its latest numbers.' : 'Every social account, with its latest numbers.'}</p>
        </div>
        <div className="page-actions">
          <label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
          {can('admin') && <button className="btn" onClick={() => setImporting(true)}><Upload /> Import CSV</button>}
          {can('admin') && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus /> Add account</button>}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="panel empty">
          <h3>No accounts registered</h3>
          <p>Add each Instagram, YouTube or other page with today's posts, followers and following as the baseline.</p>
          {can('admin') && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus /> Add account</button>}
        </div>
      ) : (
        <div className="panel">
          <div className="table-wrap" style={{ padding: 8 }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Account</th><th>Platform</th><th>Product</th>
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
                      <td><PlatformChip id={a.platform} small /></td>
                      <td>{a.product_id ? <Link to={`/products/${a.product_id}`}>{a.product_name}</Link> : <span className="faint">—</span>}</td>
                      <td className="r num">{fmt(f)}</td>
                      <td className={`r num ${tone(wk)}`}>{signed(wk)}</td>
                      <td className="r num">{fmt(a.last_posts ?? a.baseline_posts)}</td>
                      <td className="r num">{fmt(a.last_following ?? a.baseline_following)}</td>
                      <td>{a.two_factor_enabled ? <span className="badge badge-good"><ShieldCheck size={13} /> 2FA on</span> : <span className="badge badge-bad"><ShieldAlert size={13} /> 2FA off</span>}</td>
                      <td className="muted">{a.youtube_status || '—'}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        {a.profile_url && <a className="btn btn-ghost btn-icon" href={a.profile_url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${a.brand}`}><ExternalLink size={16} /></a>}
                        {can('admin') && <button className="btn btn-ghost btn-icon" onClick={() => setEditing(a)} aria-label={`Edit ${a.brand}`}><Pencil size={16} /></button>}
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

export { default as AccountForm } from './AccountForm';
import AccountForm from './AccountForm';

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
