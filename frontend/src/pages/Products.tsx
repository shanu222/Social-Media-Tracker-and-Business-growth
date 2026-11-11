import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, MessageSquare, ChevronDown } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, compact, type User } from '../lib';

export interface ProductRow {
  id: number; name: string; tagline: string | null; description: string | null; website_url: string | null; color: string | null;
  image_url: string | null; archived: boolean; account_count: number; followers: number; open_tasks: number; overdue_tasks: number;
  posts_30d: number; unread: number; members: { id: number; name: string }[];
}

export function ProductCover({ p }: { p: { name: string; color: string | null; image_url: string | null } }) {
  return (
    <div className="prod-cover" style={{ ['--pcol' as string]: p.color || '#172133', backgroundImage: p.image_url ? `url("${p.image_url}")` : undefined }}>
      <span className="initial">{p.name.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

export default function Products() {
  const { can } = useAuth();
  const [archived, setArchived] = useState(false);
  const { data, error, loading, reload } = useData<ProductRow[]>(`/products?archived=${archived}`);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p>{can('admin') ? 'Each product has its own workspace: accounts, content to post, published links, files and chat.' : 'The products you manage. Open one to see what needs posting.'}</p>
        </div>
        <div className="page-actions">
          {can('admin') && <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>}
          {can('admin') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus /> New product</button>}
        </div>
      </div>
      {data.length === 0 ? (
        <div className="panel empty">
          <h3>{can('admin') ? 'Create your first product' : 'No products assigned yet'}</h3>
          <p>{can('admin') ? 'Add a product, link its social accounts and assign your social media manager.' : 'Your admin will add you to products you manage.'}</p>
          {can('admin') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus /> New product</button>}
        </div>
      ) : (
        <div className="prod-grid">
          {data.map((p) => (
            <Link key={p.id} to={`/products/${p.id}`} className="panel prod-card" style={{ ['--pcol' as string]: p.color || '#172133', opacity: p.archived ? 0.6 : 1 }}>
              <ProductCover p={p} />
              <div className="prod-body">
                <div>
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <h2 style={{ fontSize: 18 }}>{p.name}</h2>
                    {p.unread > 0 && <span className="badge badge-info"><MessageSquare size={12} /> {p.unread} new</span>}
                  </div>
                  {p.tagline && <p className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>{p.tagline}</p>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {p.overdue_tasks > 0 && <span className="badge badge-bad">{p.overdue_tasks} overdue</span>}
                  {p.members.length > 0 ? <span className="faint" style={{ fontSize: 12.5 }}>Managed by {p.members.map((m) => m.name).join(', ')}</span> : <span className="faint" style={{ fontSize: 12.5 }}>No manager assigned</span>}
                </div>
                <div className="prod-stats">
                  <div><b>{compact(p.followers)}</b><span>followers</span></div>
                  <div><b>{p.open_tasks}</b><span>to post</span></div>
                  <div><b>{p.posts_30d}</b><span>posts in 30 days</span></div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && <ProductForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); nav(`/products/${id}?add=account`); }} />}
    </>
  );
}

const PRODUCT_COLORS = ['#0b7a62', '#3346b0', '#c0562a', '#7a3fb0', '#b03a6b', '#1f8bb0', '#a86a12', '#4d6b1f', '#172133'];
/** Same name → same colour, so nobody has to pick one. */
export const colorFor = (name: string) => PRODUCT_COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PRODUCT_COLORS.length];

export function ProductForm({ product, onClose, onSaved }: {
  product?: { id: number; name: string; tagline: string | null; description: string | null; website_url: string | null; color: string | null; archived?: boolean; memberIds?: number[] };
  onClose: () => void; onSaved: (id: number) => void;
}) {
  const toast = useToast();
  const users = useData<(User & { active: boolean })[]>('/users');
  const team = (users.data || []).filter((u) => u.active && u.role !== 'admin');
  const [f, setF] = useState({
    name: product?.name || '', tagline: product?.tagline || '', description: product?.description || '',
    website_url: product?.website_url || '', color: product?.color || '', member_ids: product?.memberIds || ([] as number[]),
    archived: product?.archived || false,
  });
  const [picked, setPicked] = useState(Boolean(product));
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  // New product: put every manager on it by default (most teams have one)
  if (!product && !picked && team.length) { setPicked(true); setF((x) => ({ ...x, member_ids: team.map((u) => u.id) })); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const website = f.website_url.trim() && !/^https?:\/\//i.test(f.website_url.trim()) ? `https://${f.website_url.trim()}` : f.website_url.trim();
    const body = { ...f, website_url: website, color: f.color || colorFor(f.name) };
    try {
      const r = product ? await api.put<{ id: number }>(`/products/${product.id}`, body) : await api.post<{ id: number }>('/products', body);
      toast(product ? 'Product updated' : `${f.name} created — now add its social accounts`);
      onSaved(r.id);
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }
  const toggle = (id: number) => setF((x) => ({ ...x, member_ids: x.member_ids.includes(id) ? x.member_ids.filter((m) => m !== id) : [...x.member_ids, id] }));

  return (
    <Modal title={product ? `Edit ${product.name}` : 'New product'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="prod-form" disabled={busy || !f.name.trim()}>{busy ? 'Saving…' : product ? 'Save changes' : 'Create product'}</button></>}>
      <form id="prod-form" className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="pn">Product name</label><input id="pn" className="input" required autoFocus={!product} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. NET360" /></div>
        <div className="field"><label htmlFor="pw">Website <span className="faint">(optional)</span></label><input id="pw" className="input" value={f.website_url} onChange={(e) => setF({ ...f, website_url: e.target.value })} placeholder="example.com" /></div>
        <div className="field full"><label htmlFor="pt">What is it, in one line? <span className="faint">(optional)</span></label><input id="pt" className="input" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} placeholder="e.g. NUST entry test preparation app" /></div>
        {team.length > 0 && (
          <div className="field full">
            <label>Who manages it</label>
            <div className="chips-select">{team.map((u) => <button type="button" key={u.id} className={f.member_ids.includes(u.id) ? 'on' : ''} onClick={() => toggle(u.id)} aria-pressed={f.member_ids.includes(u.id)}>{u.name}</button>)}</div>
          </div>
        )}
        <div className="full">
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: -8 }} onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <ChevronDown size={15} style={{ transform: more ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} /> More options
          </button>
        </div>
        {more && (
          <>
            <div className="field full"><label htmlFor="pd">Description & tone of voice</label><textarea id="pd" className="input" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Who it's for, key selling points, how posts should sound. Helps your manager and the AI." /></div>
            <div className="field"><label htmlFor="pc">Colour</label><input id="pc" type="color" className="input" style={{ padding: 3 }} value={f.color || colorFor(f.name || 'x')} onChange={(e) => setF({ ...f, color: e.target.value })} /></div>
            {product && <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} /> Archive this product</label>}
          </>
        )}
      </form>
    </Modal>
  );
}
