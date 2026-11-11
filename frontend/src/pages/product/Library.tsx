import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Download, ExternalLink, FileText, Film, FolderOpen, Image as ImageIcon, Link as LinkIcon, Plus, Search, Trash2, UploadCloud, Clapperboard } from 'lucide-react';
import { api } from '../../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, bytes, prettyDate } from '../../lib';
import { LINK_TYPES, openFile, uploadFile } from './shared';

interface Item {
  source: 'file' | 'link'; id: number; title: string; url: string | null; mime: string | null; size: number | null; content_type: string;
  note: string | null; task_id: number | null; task_title: string | null; created_by: number | null; created_by_name: string | null; created_at: string;
}
const ICON: Record<string, typeof FileText> = { video: Film, reel: Clapperboard, image: ImageIcon, document: FileText, drive: FolderOpen };

export default function Library({ productId }: { productId: number }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const [, setParams] = useSearchParams();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useData<Item[]>(`/products/${productId}/library?${new URLSearchParams({ ...(type && { type }), ...(query && { q: query }) })}`);
  const status = useData<{ storageEnabled: boolean }>('/system/status');
  const [adding, setAdding] = useState(false);
  const [upload, setUpload] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function doUpload(files: FileList) {
    try {
      for (const [i, f] of Array.from(files).entries()) {
        await uploadFile(f, { category: 'content', product_id: productId }, (p) => setUpload(`Uploading ${i + 1}/${files.length} · ${p}%`));
      }
      toast('Saved to the library');
      reload();
    } catch (e) { toast((e as Error).message, true); } finally { setUpload(null); if (input.current) input.current.value = ''; }
  }
  async function remove(it: Item) {
    if (!window.confirm(`Remove "${it.title}" from the library?`)) return;
    try {
      await api.del(it.source === 'file' ? `/files/${it.id}` : `/products/${productId}/library/links/${it.id}`);
      reload();
    } catch (e) { toast((e as Error).message, true); }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <select className="input" style={{ width: 190 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <option value="">All content</option>{Object.entries(LINK_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--faint)' }} />
            <input className="input" style={{ paddingLeft: 32, width: 220 }} placeholder="Search the library" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setQuery(q.trim())} aria-label="Search" />
          </div>
        </form>
        {can('manager') && (
          <div className="row">
            <button className="btn" onClick={() => setAdding(true)}><LinkIcon size={15} /> Add link</button>
            {status.data?.storageEnabled && <>
              <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files?.length && doUpload(e.target.files)} />
              <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={!!upload}><UploadCloud /> {upload || 'Upload'}</button>
            </>}
          </div>
        )}
      </div>
      {status.data && !status.data.storageEnabled && <div className="notice" style={{ marginBottom: 12 }}><AlertTriangle />Uploads are off until Cloudflare R2 is connected. You can still save links.</div>}
      <div className="panel">
        {loading && !data ? <Loading /> : error || !data ? <ErrorBox error={error || ''} retry={reload} /> : data.length === 0 ? (
          <div className="empty"><h3>{query || type ? 'Nothing matches' : 'The library is empty'}</h3><p>Every file and link shared for this product is kept here permanently — including those attached to tasks.</p></div>
        ) : (
          <div className="table-wrap" style={{ padding: 8 }}>
            <table className="t">
              <thead><tr><th>Content</th><th>Type</th><th>Related task</th><th>Shared</th><th /></tr></thead>
              <tbody>{data.map((it) => {
                const Icon = ICON[it.content_type] || (it.source === 'link' ? LinkIcon : FileText);
                return (
                  <tr key={`${it.source}-${it.id}`}>
                    <td style={{ minWidth: 240 }}>
                      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                        <Icon size={18} className="muted" style={{ flex: 'none', marginTop: 2 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{it.title}</div>
                          <div className="faint" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{it.source === 'link' ? it.url : bytes(it.size || 0)}{it.note ? ` · ${it.note}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="badge">{LINK_TYPES[it.content_type] || it.content_type}</span></td>
                    <td>{it.task_id ? <button className="btn btn-ghost btn-sm" onClick={() => setParams({ tab: 'tasks', task: String(it.task_id) })}>{it.task_title}</button> : <span className="faint">—</span>}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{it.created_by_name}<div className="faint" style={{ fontSize: 12 }}>{prettyDate(it.created_at.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}</div></td>
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>
                      {it.source === 'link'
                        ? <a className="btn btn-ghost btn-icon" href={it.url!} target="_blank" rel="noreferrer noopener" aria-label="Open link"><ExternalLink size={16} /></a>
                        : <button className="btn btn-ghost btn-icon" onClick={() => openFile(it.id).catch((e) => toast(e.message, true))} aria-label="Download"><Download size={16} /></button>}
                      {(can('admin') || it.created_by === user?.id) && <button className="btn btn-ghost btn-icon btn-danger" onClick={() => remove(it)} aria-label="Remove"><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <AddLink productId={productId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

function AddLink({ productId, onClose, onSaved }: { productId: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ url: '', title: '', note: '', content_type: '' });
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/products/${productId}/library/links`, { url: f.url.trim(), title: f.title || undefined, note: f.note || null, content_type: f.content_type || undefined });
      toast('Link saved to the library');
      onSaved();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <Modal title="Add a link to the library" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="link-form" disabled={busy}><Plus size={15} /> Save link</button></>}>
      <form id="link-form" className="form-grid" onSubmit={submit}>
        <div className="field full"><label htmlFor="lu">Link</label><input id="lu" className="input" type="url" required placeholder="https://drive.google.com/…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /><span className="hint">Google Drive, Dropbox, YouTube, Instagram reels, Canva, any web page. Make sure sharing permissions let your team open it.</span></div>
        <div className="field"><label htmlFor="lt">Name</label><input id="lt" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. November reels folder" /></div>
        <div className="field"><label htmlFor="lc">Type</label><select id="lc" className="input" value={f.content_type} onChange={(e) => setF({ ...f, content_type: e.target.value })}><option value="">Detect automatically</option>{Object.entries(LINK_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field full"><label htmlFor="ln">Note</label><input id="ln" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      </form>
    </Modal>
  );
}
