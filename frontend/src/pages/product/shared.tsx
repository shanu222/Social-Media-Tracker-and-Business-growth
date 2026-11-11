import { useEffect, useState } from 'react';
import { Copy, Download, FileText, Film, Image as ImageIcon } from 'lucide-react';
import { api } from '../../api';
import { useToast, bytes } from '../../lib';

export interface FileLite { id: number; name: string; mime: string; size: number }

export async function uploadFile(file: File, meta: Record<string, string | number | null | undefined>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(meta)) if (v !== null && v !== undefined && v !== '') fd.append(k, String(v));
  fd.append('file', file);
  return api.upload<{ id: number }>('/files', fd);
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
  todo: { label: 'To post', badge: 'badge-info' },
  in_progress: { label: 'In progress', badge: 'badge-warn' },
  done: { label: 'Posted', badge: 'badge-good' },
  cancelled: { label: 'Cancelled', badge: '' },
};
