import { useState, type FormEvent } from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, PlatformChip, PLATFORMS, prettyDate, todayStr } from '../../lib';
import { uploadFile } from './shared';

interface Post { id: number; platform: string; url: string | null; note: string | null; posted_on: string; created_by: number | null; created_by_name: string | null; account_brand: string | null; task_title: string | null }
interface Acc { id: number; brand: string; platform: string; username: string }

export default function Published({ productId, accounts }: { productId: number; accounts: Acc[] }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useData<Post[]>(`/products/${productId}/posts`);
  const [adding, setAdding] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;

  async function remove(p: Post) {
    if (!window.confirm('Remove this post from the log?')) return;
    try { await api.del(`/products/${productId}/posts/${p.id}`); reload(); } catch (e) { toast((e as Error).message, true); }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <p className="muted">Everything that went live for this product, including posts the manager made on their own.</p>
        {can('manager') && <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus /> Record a post</button>}
      </div>
      <div className="panel">
        {data.length === 0 ? <div className="empty"><h3>No posts recorded yet</h3><p>When content is published, add its link here so there's a full history.</p></div> : (
          <div className="table-wrap" style={{ padding: 8 }}>
            <table className="t">
              <thead><tr><th>Date</th><th>Platform</th><th>What</th><th>By</th><th /></tr></thead>
              <tbody>{data.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{prettyDate(p.posted_on, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td><PlatformChip id={p.platform} small />{p.account_brand && <div className="faint" style={{ fontSize: 12 }}>{p.account_brand}</div>}</td>
                  <td style={{ minWidth: 220 }}>
                    {p.task_title && <div style={{ fontWeight: 500 }}>{p.task_title}</div>}
                    {p.note && <div className="muted" style={{ fontSize: 13.5 }}>{p.note}</div>}
                    {!p.task_title && !p.note && <span className="faint">Independent post</span>}
                  </td>
                  <td className="muted">{p.created_by_name}</td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>
                    {p.url && <a className="btn btn-sm" href={p.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> Open</a>}
                    {(can('admin') || p.created_by === user?.id) && <button className="btn btn-ghost btn-icon btn-danger" onClick={() => remove(p)} aria-label="Remove post"><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <RecordPost productId={productId} accounts={accounts} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

function RecordPost({ productId, accounts, onClose, onSaved }: { productId: number; accounts: Acc[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const first = accounts[0];
  const [f, setF] = useState({ platform: first?.platform || 'instagram', account_id: first ? String(first.id) : '', url: '', note: '', posted_on: todayStr() });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const accs = accounts.filter((a) => a.platform === f.platform);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/products/${productId}/posts`, { ...f, account_id: f.account_id ? Number(f.account_id) : null, url: f.url || null });
      if (file) await uploadFile(file, { category: 'published', product_id: productId, note: f.note || `${f.platform} post ${f.posted_on}` });
      toast('Post recorded');
      onSaved();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <Modal title="Record a published post" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="post-form" disabled={busy}>{busy ? 'Saving…' : 'Record post'}</button></>}>
      <form id="post-form" className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="pp">Platform</label>
          <select id="pp" className="input" value={f.platform} onChange={(e) => { const pl = e.target.value; const a = accounts.find((x) => x.platform === pl); setF({ ...f, platform: pl, account_id: a ? String(a.id) : '' }); }}>
            {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="pa">Account</label>
          <select id="pa" className="input" value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}>
            <option value="">Not listed</option>{accs.map((a) => <option key={a.id} value={a.id}>{a.brand} (@{a.username})</option>)}
          </select>
        </div>
        <div className="field full"><label htmlFor="pu">Link to the post</label><input id="pu" type="url" className="input" placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></div>
        <div className="field"><label htmlFor="pd">Posted on</label><input id="pd" type="date" className="input" max={todayStr()} value={f.posted_on} onChange={(e) => setF({ ...f, posted_on: e.target.value })} /></div>
        <div className="field"><label htmlFor="pf">Screenshot or media (optional)</label><input id="pf" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
        <div className="field full"><label htmlFor="pn">What was posted</label><textarea id="pn" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Reel answering a student question" /></div>
      </form>
    </Modal>
  );
}
