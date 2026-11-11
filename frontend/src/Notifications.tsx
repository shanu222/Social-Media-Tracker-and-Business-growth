import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, CheckCircle2, Clock, Edit3, HelpCircle, Megaphone, MessageSquare, TrendingUp, TriangleAlert, UserPlus } from 'lucide-react';
import { api } from './api';
import { timeAgo, useAuth } from './lib';

interface Activity { id: number; at: string; kind: string; text: string; link: string | null; product_name: string | null; mine: boolean; unseen: boolean }
const ACT_ICON: Record<string, [typeof Bell, string]> = {
  assigned: [UserPlus, '#1a5fe0'], progress: [TrendingUp, '#12b5e8'], done: [CheckCircle2, '#16b97a'], question: [HelpCircle, '#e0812a'],
  comment: [MessageSquare, '#7a3fb0'], edit: [Edit3, '#5e6a7c'], warn: [TriangleAlert, '#c2372f'], time: [Clock, '#0b7f66'], announce: [Megaphone, '#7a3fb0'],
};
interface Item { id: number; kind: string; title: string; body: string | null; link: string | null; product_name: string | null; read_at: string | null; created_at: string }

/** Bell with unread count. Polls every 30 s while the tab is visible. */
export default function Notifications({ dark }: { dark?: boolean }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const isAdmin = can('admin');
  const [data, setData] = useState<{ unread: number; items: Item[]; activityUnread?: number }>({ unread: 0, items: [] });
  const [tab, setTab] = useState<'mine' | 'team'>('mine');
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const load = () => api.get<{ unread: number; items: Item[]; activityUnread?: number }>('/notifications').then(setData).catch(() => {});
  async function openTeam() {
    setTab('team');
    try { setActivity(await api.get<Activity[]>('/notifications/activity')); await api.post('/notifications/activity/seen', {}); load(); } catch { setActivity([]); }
  }
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
        {(data.unread + (data.activityUnread || 0)) > 0 && <span className="dot-alert">{data.unread + (data.activityUnread || 0) > 99 ? '99+' : data.unread + (data.activityUnread || 0)}</span>}
      </button>
      {open && createPortal(
        <div className="notif-panel" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label="Notifications">
          <div className="row" style={{ justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--line-2)' }}>
            <h3>Notifications</h3>
            {tab === 'mine' && data.unread > 0 && <button className="btn btn-sm btn-ghost" onClick={readAll}><CheckCheck size={14} /> Mark all read</button>}
          </div>
          {isAdmin && (
            <div className="notif-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>For you{data.unread > 0 && <span className="count">{data.unread}</span>}</button>
              <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'on' : ''} onClick={openTeam}>Team activity{(data.activityUnread || 0) > 0 && <span className="count">{data.activityUnread}</span>}</button>
            </div>
          )}
          {tab === 'team' && isAdmin ? (
            <>
              {!activity && <p className="muted" style={{ padding: 20 }}>Loading…</p>}
              {activity?.length === 0 && <p className="muted" style={{ padding: 20 }}>No team activity yet.</p>}
              {activity?.map((a) => {
                const [Icon, color] = ACT_ICON[a.kind] || ACT_ICON.edit;
                return (
                  <button key={a.id} className={`notif-item ${a.unseen ? 'unread' : ''}`} onClick={() => { setOpen(false); if (a.link) nav(a.link); }}>
                    <span className="act-ico" style={{ color, background: `${color}1a` }}><Icon size={15} /></span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', color: 'var(--ink)', fontSize: 13.5 }}>{a.text}</span>
                      <span className="faint" style={{ fontSize: 12 }}>{a.product_name ? `${a.product_name} · ` : ''}{timeAgo(a.at)}</span>
                    </span>
                  </button>
                );
              })}
            </>
          ) : (<>
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
          </>)}
        </div>,
        document.body
      )}
    </>
  );
}
