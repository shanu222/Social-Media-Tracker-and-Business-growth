import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, Pencil, RefreshCw, Plus, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, PlatformChip, fmt, signed, tone, timeAgo, compact } from '../lib';
import { ProductForm } from './Products';
import { AccountForm } from './Accounts';
import ProductTasks from './product/Tasks';
import Library from './product/Library';
import Published from './product/Published';
import Chat from './product/Chat';

interface Workspace {
  product: { id: number; name: string; tagline: string | null; description: string | null; website_url: string | null; color: string | null; image_url: string | null; archived: boolean };
  members: { id: number; name: string; role: string }[];
  accounts: {
    id: number; brand: string; username: string; platform: string; profile_url: string | null; color: string | null; two_factor_enabled: boolean;
    sync_enabled: boolean; last_synced_at: string | null; sync_error: string | null; baseline_followers: number; last_date: string | null;
    followers: number | null; following: number | null; posts: number | null; extra: Record<string, number> | null; week_ago_followers: number | null;
  }[];
  tasks: { todo: number; in_progress: number; done: number; overdue: number };
  posts30: number;
}

const TABS = [['overview', 'Overview'], ['tasks', 'Tasks'], ['published', 'Published'], ['chat', 'Chat'], ['library', 'Library'], ['activity', 'Activity']] as const;
const ALIASES: Record<string, string> = { content: 'tasks', files: 'library' };
type Tab = (typeof TABS)[number][0];

export default function ProductDetail() {
  const { id } = useParams();
  const pid = Number(id);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') || '';
  const tab = (TABS.find(([k]) => k === (ALIASES[rawTab] || rawTab))?.[0] || 'overview') as Tab;
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useData<Workspace>(`/products/${pid}`);
  const [editing, setEditing] = useState(false);
  const [taskRef, setTaskRef] = useState<{ id: number; title: string } | null>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  void setTaskRef;

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;
  const p = data.product;
  const go = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t });
  const openCount = data.tasks.todo + data.tasks.in_progress;

  async function uploadImage(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    try { await api.upload(`/products/${pid}/image`, fd); toast('Image updated'); reload(); } catch (e) { toast((e as Error).message, true); }
  }

  return (
    <>
      <Link to="/products" className="btn btn-ghost btn-sm" style={{ marginBottom: 10, marginLeft: -8 }}><ChevronLeft size={16} /> Products</Link>
      <div className="prod-hero">
        <div className="img" style={{ ['--pcol' as string]: p.color || '#172133', backgroundImage: p.image_url ? `url("${p.image_url}")` : undefined }}>
          {!p.image_url && p.name.slice(0, 1).toUpperCase()}
          {can('admin') && <button onClick={() => imgInput.current?.click()} aria-label="Change product image">Change image</button>}
          <input ref={imgInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1>{p.name} {p.archived && <span className="badge">Archived</span>}</h1>
          {p.tagline && <p className="muted" style={{ marginTop: 3 }}>{p.tagline}</p>}
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            {data.members.length ? data.members.map((m) => <span key={m.id} className="badge">{m.name}</span>) : <span className="badge badge-warn">No manager assigned</span>}
            {p.website_url && <a href={p.website_url} target="_blank" rel="noreferrer noopener" className="badge badge-info" style={{ textDecoration: 'none' }}><ExternalLink size={12} /> Website</a>}
          </div>
        </div>
        {can('admin') && <button className="btn" onClick={() => setEditing(true)}><Pencil /> Edit product</button>}
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>
            {label}{k === 'tasks' && openCount > 0 && <span className="dot-alert" style={{ background: data.tasks.overdue ? 'var(--loss)' : 'var(--signal)' }}>{openCount}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview ws={data} reload={reload} go={go} />}
      {tab === 'tasks' && <ProductTasks productId={pid} members={data.members} />}
      {tab === 'published' && <Published productId={pid} accounts={data.accounts} />}
      {tab === 'chat' && <Chat productId={pid} taskRef={taskRef} clearTaskRef={() => setTaskRef(null)} />}
      {tab === 'library' && <Library productId={pid} />}
      {tab === 'activity' && <Activity productId={pid} />}

      {editing && (
        <ProductForm
          product={{ ...p, memberIds: data.members.map((m) => m.id) }}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); }}
        />
      )}
      {can('admin') && tab === 'overview' && (
        <div style={{ marginTop: 28, textAlign: 'right' }}>
          <button className="btn btn-sm btn-ghost btn-danger" onClick={async () => {
            if (!window.confirm(`Delete ${p.name} with all its tasks, posts and chat? Accounts and files are kept. This cannot be undone.`)) return;
            try { await api.del(`/products/${pid}`); toast('Product deleted'); nav('/products'); } catch (e) { toast((e as Error).message, true); }
          }}>Delete product</button>
        </div>
      )}
    </>
  );
}

function Overview({ ws, reload, go }: { ws: Workspace; reload: () => void; go: (t: Tab) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [syncing, setSyncing] = useState<number | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const totalFollowers = ws.accounts.reduce((s, a) => s + (a.followers ?? a.baseline_followers ?? 0), 0);
  const weekGain = ws.accounts.reduce((s, a) => s + (a.followers !== null && a.week_ago_followers !== null ? a.followers - a.week_ago_followers : 0), 0);

  async function sync(id: number) {
    setSyncing(id);
    try { await api.post(`/accounts/${id}/sync`); toast('Numbers updated from the platform'); } catch (e) { toast((e as Error).message, true); } finally { setSyncing(null); reload(); }
  }

  return (
    <div className="stack">
      <div className="kpis" style={{ margin: 0 }}>
        <div className="panel kpi"><div className="k">Followers, all accounts</div><div className="v">{compact(totalFollowers)}</div><div className="d"><span className={tone(weekGain)}>{signed(weekGain)}</span> <span className="muted">in 7 days</span></div></div>
        <button className="panel kpi" style={{ textAlign: 'left', border: 0, cursor: 'pointer' }} onClick={() => go('tasks')}><div className="k">Open tasks</div><div className="v">{ws.tasks.todo + ws.tasks.in_progress}</div><div className="d">{ws.tasks.overdue > 0 ? <span className="down">{ws.tasks.overdue} overdue</span> : <span className="muted">{ws.tasks.in_progress} in progress</span>}</div></button>
        <button className="panel kpi" style={{ textAlign: 'left', border: 0, cursor: 'pointer' }} onClick={() => go('published')}><div className="k">Posts in 30 days</div><div className="v">{ws.posts30}</div><div className="d muted">{ws.tasks.done} tasks completed in total</div></button>
        <div className="panel kpi"><div className="k">Accounts</div><div className="v">{ws.accounts.length}</div><div className="d muted">{ws.accounts.filter((a) => a.sync_enabled).length} syncing automatically</div></div>
      </div>

      <div className="panel panel-pad">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2>Social media accounts</h2>
          {can('admin') && <button className="btn btn-sm" onClick={() => setAddingAccount(true)}><Plus size={14} /> Add account</button>}
        </div>
        {ws.accounts.length === 0 ? <p className="muted">No accounts linked yet. {can('admin') ? 'Add this product\'s Instagram, YouTube, Discord and other pages.' : ''}</p> : (
          <div className="acc-grid">
            {ws.accounts.map((a) => {
              const wk = a.followers !== null && a.week_ago_followers !== null ? a.followers - a.week_ago_followers : null;
              return (
                <div key={a.id} className="panel acc-card" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <PlatformChip id={a.platform} />
                    {a.profile_url && <a href={a.profile_url} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-icon btn-sm" aria-label={`Open ${a.brand}`}><ExternalLink size={14} /></a>}
                  </div>
                  <Link to={`/accounts/${a.id}`} style={{ textDecoration: 'none', color: 'inherit' }}><div style={{ fontWeight: 500 }}>@{a.username}</div></Link>
                  <div className="big">{fmt(a.followers ?? a.baseline_followers)}</div>
                  <div style={{ fontSize: 13 }}>
                    <span className="muted">{a.platform === 'youtube' ? 'subscribers' : a.platform === 'discord' || a.platform === 'telegram' ? 'members' : 'followers'}</span>
                    {wk !== null && <span className={tone(wk)}> · {signed(wk)} this week</span>}
                  </div>
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    {a.posts !== null && `${fmt(a.posts)} posts`}{a.following !== null && ` · ${fmt(a.following)} following`}
                    {a.extra?.total_views ? ` · ${compact(a.extra.total_views)} views` : ''}{a.extra?.online ? ` · ${a.extra.online} online` : ''}
                  </div>
                  {a.sync_error && <div className="down" style={{ fontSize: 12.5, display: 'flex', gap: 5 }}><AlertTriangle size={13} style={{ flex: 'none', marginTop: 2 }} />{a.sync_error}</div>}
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 'auto', paddingTop: 6 }}>
                    <span className="faint" style={{ fontSize: 12 }}>{a.sync_enabled ? (a.last_synced_at ? `Synced ${timeAgo(a.last_synced_at)}` : 'Auto-sync on') : a.last_date ? `Logged ${a.last_date}` : 'Manual'}</span>
                    {a.sync_enabled && can('manager') && <button className="btn btn-sm btn-ghost" onClick={() => sync(a.id)} disabled={syncing === a.id}><RefreshCw size={13} className={syncing === a.id ? 'spin' : ''} /> {syncing === a.id ? 'Syncing…' : 'Sync now'}</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {ws.product.description && (
        <div className="panel panel-pad"><h2 style={{ marginBottom: 8 }}>About this product</h2><p style={{ whiteSpace: 'pre-wrap', maxWidth: '75ch' }}>{ws.product.description}</p></div>
      )}
      <div className="panel panel-pad">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}><h2>Recent activity</h2><button className="btn btn-sm btn-ghost" onClick={() => go('activity')}>See all</button></div>
        <Activity productId={ws.product.id} limit={6} />
      </div>
      {addingAccount && (
        <AccountForm account={null} defaultProductId={ws.product.id} onClose={() => setAddingAccount(false)} onSaved={() => { setAddingAccount(false); reload(); }} />
      )}
    </div>
  );
}

const ACTION_TEXT: Record<string, [string, string]> = {
  'product.created': ['created this product', '#0b7a62'], 'product.updated': ['updated the product details', '#5e6a7c'],
  'product.image_updated': ['changed the product image', '#5e6a7c'], 'task.created': ['shared new content', '#3346b0'],
  'task.updated': ['edited content', '#5e6a7c'], 'task.in_progress': ['started working on', '#a86a12'], 'task.done': ['marked as posted', '#0b7a62'],
  'task.todo': ['reopened', '#a86a12'], 'task.cancelled': ['cancelled', '#5e6a7c'], 'task.deleted': ['deleted content', '#b8322a'],
  'post.recorded': ['recorded a published post', '#0b7a62'], 'post.deleted': ['removed a post record', '#b8322a'],
  'file.uploaded': ['uploaded a file', '#3346b0'], 'file.deleted': ['deleted a file', '#b8322a'], 'file.downloaded': ['downloaded a file', '#8a95a5'],
};

function Activity({ productId, limit }: { productId: number; limit?: number }) {
  const { data, loading } = useData<{ id: number; action: string; detail: Record<string, string> | null; created_at: string; user_name: string | null }[]>(`/products/${productId}/activity`);
  if (loading && !data) return <Loading />;
  const rows = (data || []).filter((r) => r.action !== 'file.downloaded').slice(0, limit || 200);
  if (!rows.length) return <p className="muted">Nothing has happened yet.</p>;
  const body = (
    <div className="timeline">
      {rows.map((r) => {
        const [text, color] = ACTION_TEXT[r.action] || [r.action, '#5e6a7c'];
        const what = r.detail?.title || r.detail?.name || (r.detail?.platform ? `on ${r.detail.platform}` : '');
        return (
          <div key={r.id} className="tl-item" style={{ ['--tl' as string]: color }}>
            <div><b>{r.user_name || 'System'}</b> {text}{what && <> — <span>{what}</span></>}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>{timeAgo(r.created_at)}</div>
          </div>
        );
      })}
    </div>
  );
  return limit ? body : <div className="panel panel-pad">{body}</div>;
}
