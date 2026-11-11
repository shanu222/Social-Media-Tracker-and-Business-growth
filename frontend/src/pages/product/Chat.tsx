import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send, X } from 'lucide-react';
import { api } from '../../api';
import { useAuth, useToast, Loading, ROLE_LABEL, type Role } from '../../lib';

interface Msg { id: number; body: string; created_at: string; task_id: number | null; task_title?: string | null; user_id: number | null; user_name: string | null; user_role: Role | null }

export default function Chat({ productId, taskRef, clearTaskRef }: { productId: number; taskRef?: { id: number; title: string } | null; clearTaskRef: () => void }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);

  useEffect(() => {
    let live = true;
    lastId.current = 0;
    setMsgs(null);
    const load = async () => {
      try {
        const rows = await api.get<Msg[]>(`/products/${productId}/messages${lastId.current ? `?after=${lastId.current}` : ''}`);
        if (!live) return;
        if (rows.length) lastId.current = rows[rows.length - 1].id;
        setMsgs((m) => { const base = m || []; return [...base, ...rows.filter((r) => !base.some((x) => x.id === r.id))]; });
      } catch { /* keep polling */ }
    };
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 5000);
    return () => { live = false; clearInterval(t); };
  }, [productId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs?.length]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const m = await api.post<Msg>(`/products/${productId}/messages`, { body: text.trim(), task_id: taskRef?.id ?? null });
      lastId.current = Math.max(lastId.current, m.id);
      setMsgs((x) => [...(x || []), { ...m, task_title: taskRef?.title }]);
      setText('');
      clearTaskRef();
    } catch (err) { toast((err as Error).message, true); } finally { setSending(false); }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  if (!msgs) return <div className="panel"><Loading /></div>;
  let lastDay = '';

  return (
    <div className="panel chat">
      <div className="chat-list" ref={listRef} aria-live="polite">
        {msgs.length === 0 && <div className="empty" style={{ margin: 'auto' }}><h3>No messages yet</h3><p>Instructions, change requests and questions about this product go here.</p></div>}
        {msgs.map((m) => {
          const day = new Date(m.created_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
          const showDay = day !== lastDay;
          lastDay = day;
          const me = m.user_id === user?.id;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && <div className="chat-day">{day}</div>}
              <div className={`bubble ${me ? 'me' : ''}`}>
                {!me && <div className="who">{m.user_name || 'Removed user'} · {m.user_role ? ROLE_LABEL[m.user_role] : ''}</div>}
                {m.body}
                {m.task_title && <div className="ref">Re: {m.task_title}</div>}
                <div className="ref" style={{ textAlign: 'right' }}>{new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          );
        })}
      </div>
      {can('manager') ? (
        <form className="composer" onSubmit={send}>
          <div style={{ flex: 1 }}>
            {taskRef && <div className="badge badge-info" style={{ marginBottom: 6 }}>About: {taskRef.title} <button type="button" onClick={clearTaskRef} aria-label="Remove reference" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', display: 'inline-flex' }}><X size={12} /></button></div>}
            <textarea className="input" rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="Write a message… (Enter to send, Shift+Enter for a new line)" aria-label="Message" />
          </div>
          <button className="btn btn-primary" disabled={sending || !text.trim()} style={{ height: 42 }}><Send size={16} /> Send</button>
        </form>
      ) : <p className="faint" style={{ padding: 12 }}>Viewers can read the chat but not post.</p>}
    </div>
  );
}
