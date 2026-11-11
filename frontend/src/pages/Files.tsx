import { useRef, useState } from 'react';
import { Download, FileText, Film, Image as ImageIcon, Trash2, UploadCloud, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, bytes, type Account } from '../lib';

interface FileRow { id: number; name: string; mime: string; size: number; category: string; note: string | null; created_at: string; brand: string | null; uploaded_by_name: string | null }
const CATS = [['insights', 'Insights screenshots'], ['content', 'Content (videos, graphics)'], ['report', 'Reports'], ['invoice', 'Invoices & payments'], ['backup', 'Backups'], ['other', 'Other']] as const;

export default function Files() {
  const { can } = useAuth();
  const toast = useToast();
  const [cat, setCat] = useState('');
  const { data, error, loading, reload } = useData<{ storageEnabled: boolean; maxUploadMb: number; files: FileRow[] }>(`/files${cat ? `?category=${cat}` : ''}`);
  const accounts = useData<Account[]>('/accounts');
  const [form, setForm] = useState({ category: 'insights', account_id: '', note: '' });
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;

  async function upload(file: File) {
    if (file.size > data!.maxUploadMb * 1048576) return toast(`File is larger than ${data!.maxUploadMb} MB.`, true);
    setBusy(true);
    const fd = new FormData();
    fd.append('category', form.category);
    if (form.account_id) fd.append('account_id', form.account_id);
    if (form.note) fd.append('note', form.note);
    fd.append('file', file);
    try {
      await api.upload('/files', fd);
      toast(`Uploaded ${file.name}`);
      setForm((f) => ({ ...f, note: '' }));
      reload();
    } catch (e) { toast((e as Error).message, true); } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function get(f: FileRow) {
    try {
      const { url } = await api.get<{ url: string }>(`/files/${f.id}/download`);
      window.location.href = url;
    } catch (e) { toast((e as Error).message, true); }
  }
  async function remove(f: FileRow) {
    if (!window.confirm(`Delete ${f.name}?`)) return;
    try { await api.del(`/files/${f.id}`); reload(); } catch (e) { toast((e as Error).message, true); }
  }
  const Icon = (m: string) => (m.startsWith('image/') ? ImageIcon : m.startsWith('video/') ? Film : FileText);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Files</h1>
          <p>Private, encrypted file storage.</p>
        </div>
      </div>

      {!data.storageEnabled && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <AlertTriangle />
          <span>Cloud storage isn't connected yet. Add <b>R2_ACCOUNT_ID</b>, <b>R2_ACCESS_KEY_ID</b>, <b>R2_SECRET_ACCESS_KEY</b> and <b>R2_BUCKET</b> to the backend variables on Railway, then redeploy.</span>
        </div>
      )}

      {can('manager') && data.storageEnabled && (
        <div className="panel panel-pad" style={{ marginBottom: 16 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field"><label htmlFor="fc">Type</label>
              <select id="fc" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="fa">Account</label>
              <select id="fa" className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
                <option value="">None</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.brand}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 180 }}><label htmlFor="fn">Note</label><input id="fn" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. October insights" /></div>
            <input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}><UploadCloud /> {busy ? 'Uploading…' : 'Upload file'}</button>
          </div>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>Images, videos, PDF, CSV and Office files up to {data.maxUploadMb} MB.</p>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>Stored files</h2>
          <select className="input" style={{ width: 220 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {data.files.length === 0 ? (
          <div className="empty"><h3>No files yet</h3><p>Upload weekly insights screenshots here so they're never lost.</p></div>
        ) : (
          <div className="table-wrap" style={{ padding: 8 }}>
            <table className="t">
              <thead><tr><th>File</th><th>Type</th><th>Account</th><th className="r">Size</th><th>Uploaded</th><th /></tr></thead>
              <tbody>{data.files.map((f) => {
                const I = Icon(f.mime);
                return (
                  <tr key={f.id}>
                    <td><div className="row" style={{ flexWrap: 'nowrap' }}><I size={18} className="muted" /><div><div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{f.name}</div>{f.note && <div className="faint" style={{ fontSize: 12.5 }}>{f.note}</div>}</div></div></td>
                    <td className="muted">{CATS.find(([k]) => k === f.category)?.[1]}</td>
                    <td>{f.brand || '—'}</td>
                    <td className="r num">{bytes(f.size)}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(f.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{f.uploaded_by_name && ` · ${f.uploaded_by_name}`}</td>
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-icon" onClick={() => get(f)} aria-label={`Download ${f.name}`}><Download size={16} /></button>
                      {can('manager') && <button className="btn btn-ghost btn-icon btn-danger" onClick={() => remove(f)} aria-label={`Delete ${f.name}`}><Trash2 size={16} /></button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
