import { useEffect, useState } from 'react';
import { Copy, Download, FileText, Film, Image as ImageIcon } from 'lucide-react';
import { api, ApiError } from '../../api';
import { useToast, bytes } from '../../lib';

export interface FileLite { id: number; name: string; mime: string; size: number }

const SMALL_LIMIT = 20 * 1024 * 1024;

/**
 * Uploads a file. Small files go through the API; large ones (videos, reels) are sent straight to
 * Cloudflare R2 with a signed link so nothing big passes through the server.
 */
export async function uploadFile(
  file: File,
  meta: Record<string, string | number | null | undefined>,
  onProgress?: (pct: number) => void
) {
  if (file.size <= SMALL_LIMIT) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(meta)) if (v !== null && v !== undefined && v !== '') fd.append(k, String(v));
    fd.append('file', file);
    const r = await api.upload<{ id: number }>('/files', fd);
    onProgress?.(100);
    return r;
  }
  const body = {
    name: file.name, mime: file.type || 'application/octet-stream', size: file.size,
    category: meta.category || 'content', product_id: meta.product_id ? Number(meta.product_id) : null,
    task_id: meta.task_id ? Number(meta.task_id) : null, note: meta.note || null,
  };
  const p = await api.post<{ key: string; uploadUrl: string; headers: Record<string, string> }>('/files/presign', body);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', p.uploadUrl);
    for (const [k, v] of Object.entries(p.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 99));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new ApiError(`Upload to cloud storage failed (${xhr.status}).`, xhr.status)));
    xhr.onerror = () => reject(new ApiError('Upload to cloud storage was blocked. Add the CORS rule to the R2 bucket (see README).', 0));
    xhr.send(file);
  });
  const r = await api.post<{ id: number }>('/files/complete', { ...body, key: p.key });
  onProgress?.(100);
  return r;
}

export async function openFile(id: number) {
  const { url } = await api.get<{ url: string }>(`/files/${id}/download`);
  window.location.href = url;
}

export function CopyBox({ text, label }: { text: string; label: string }) {
  const toast = useToast();
  return (
    <div className="copybox">
      {text}
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        aria-label={`Copy ${label}`}
        onClick={() => navigator.clipboard?.writeText(text).then(() => toast(`${label} copied`), () => toast('Copy failed — select the text instead', true))}
      >
        <Copy size={15} />
      </button>
    </div>
  );
}

/** Images get a thumbnail (loaded through a short-lived signed link); others a download chip. */
export function Attachment({ f }: { f: FileLite }) {
  const toast = useToast();
  const [src, setSrc] = useState<string | null>(null);
  const isImg = f.mime.startsWith('image/');
  useEffect(() => {
    if (!isImg) return;
    let live = true;
    api.get<{ url: string }>(`/files/${f.id}/view`).then((r) => live && setSrc(r.url)).catch(() => {});
    return () => { live = false; };
  }, [f.id, isImg]);
  const open = () => openFile(f.id).catch((e) => toast(e.message, true));
  if (isImg && src) return <img src={src} alt={f.name} title={`${f.name} — click to download`} onClick={open} />;
  const Icon = f.mime.startsWith('video/') ? Film : isImg ? ImageIcon : FileText;
  return (
    <button type="button" className="attach" onClick={open} title="Download">
      <Icon size={15} /> <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
      <span className="faint">{bytes(f.size)}</span> <Download size={13} />
    </button>
  );
}

export const PRIORITY: Record<string, { label: string; color: string; badge: string }> = {
  urgent: { label: 'Urgent', color: '#b8322a', badge: 'badge-bad' },
  high: { label: 'High', color: '#a86a12', badge: 'badge-warn' },
  normal: { label: 'Normal', color: '#3346b0', badge: 'badge-info' },
  low: { label: 'Low', color: '#c6ced8', badge: '' },
};

export const STATUS: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Draft', badge: '' },
  todo: { label: 'Not started', badge: 'badge-info' },
  in_progress: { label: 'In progress', badge: 'badge-warn' },
  done: { label: 'Completed', badge: 'badge-good' },
  cancelled: { label: 'Cancelled', badge: '' },
};

export const LINK_TYPES: Record<string, string> = {
  drive: 'Drive / cloud folder', video: 'Video', reel: 'Reel / short', image: 'Image', document: 'Document',
  social: 'Social post', link: 'Web link', other: 'Other',
};

export function Progress({ value, small }: { value: number; small?: boolean }) {
  const color = value >= 100 ? 'var(--growth)' : value >= 50 ? '#2fa585' : value > 0 ? 'var(--signal)' : 'var(--line)';
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: small ? 90 : 140 }} aria-label={`${value}% complete`}>
      <div style={{ flex: 1, height: small ? 5 : 7, background: 'var(--line-2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .3s ease' }} />
      </div>
      <span className="num" style={{ fontSize: small ? 12 : 13, fontWeight: 600, minWidth: 34, textAlign: 'right' }}>{value}%</span>
    </div>
  );
}
