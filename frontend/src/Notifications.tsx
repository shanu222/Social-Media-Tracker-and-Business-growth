import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from './api';
import { timeAgo } from './lib';

interface Item { id: number; kind: string; title: string; body: string | null; link: string | null; product_name: string | null; read_at: string | null; created_at: string }

/** Bell with unread count. Polls every 30 s while the tab is visible. */
export default function Notifications({ dark }: { dark?: boolean }) {
  const nav = useNavigate();
  const [data, setData] = useState<{ unread: number; items: Item[] }>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const load = () => api.get<{ unread: number; items: Item[] }>('/notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest('.notif-panel') && !el.closest('.bell')) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  function toggle() {
    const r = btn.current!.getBoundingClientRect();
    const w = Math.min(380, window.innerWidth - 24);
    setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) });
    setOpen((o) => !o);
    if (!open) load();
  }
  async function go(i: Item) {
    setOpen(false);
    if (!i.read_at) await api.post('/notifications/read', { id: i.id }).catch(() => {});
    load();
    if (i.link) nav(i.link);
  }
  async function readAll() {
    await api.post('/notifications/read', {}).catch(() => {});
    load();
  }

  return (
    <>
      <button ref={btn} className="bell btn btn-ghost btn-icon" onClick={toggle} aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open}
        style={dark ? { color: '#c9d1dd' } : undefined}>
        <Bell size={19} />
        {data.unread > 0 && <span className="dot-alert">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label="Notifications">
          <div className="row" style={{ justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--line-2)' }}>
            <h3>Notifications</h3>
            {data.unread > 0 && <button className="btn btn-sm btn-ghost" onClick={readAll}><CheckCheck size={14} /> Mark all read</button>}
          </div>
          {data.items.length === 0 && <p className="muted" style={{ padding: 20 }}>You're all caught up.</p>}
          {data.items.map((i) => (
            <button key={i.id} className={`notif-item ${i.read_at ? '' : 'unread'}`} onClick={() => go(i)}>
              <span className="mark" style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 7, flex: 'none', background: i.read_at ? 'transparent' : 'var(--growth)' }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 500, color: 'var(--ink)' }}>{i.title}</span>
                {i.body && <span className="muted" style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{i.body}</span>}
                <span className="faint" style={{ fontSize: 12 }}>{timeAgo(i.created_at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
