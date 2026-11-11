import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Bell, Mail, RefreshCw, CalendarClock, CheckCheck, Clock, Flag, Megaphone, MapPin, Pencil, Plus, Send, Trash2, Users, Video, XCircle,
} from 'lucide-react';
import { api } from '../api';
import { useAuth, useToast, Loading, Modal, ROLE_LABEL, timeAgo, type Role } from '../lib';

interface Person { id: number; name: string; title: string | null; role: Role; removed?: boolean; unread: number; last_body: string | null; last_at: string | null; last_sender: number | null }
interface Dm { id: number; sender_id: number; recipient_id: number; body: string; important: boolean; read_at: string | null; created_at: string; email_status?: string | null; email_error?: string | null }
type Kind = 'announcement' | 'meeting' | 'reminder' | 'deadline';
interface Ann {
  id: number; kind: Kind; title: string; body: string | null; event_at: string | null; location: string | null; important: boolean;
  created_at: string; cancelled: boolean; created_by_name: string | null; my_ack: string | null;
  recipients?: number; read?: number; acknowledged?: number; people?: { id: number; name: string; read_at: string | null; acknowledged_at: string | null; email?: { status: string; error: string | null; to: string } | null }[]; to_me?: boolean;
}

const KINDS: Record<Kind, { label: string; icon: typeof Bell; cls: string; ack: string }> = {
  announcement: { label: 'Announcement', icon: Megaphone, cls: 'k-ann', ack: 'Got it' },
  meeting: { label: 'Meeting', icon: Video, cls: 'k-meet', ack: "I'll attend" },
  reminder: { label: 'Reminder', icon: Bell, cls: 'k-rem', ack: 'Got it' },
  deadline: { label: 'Deadline', icon: Flag, cls: 'k-dead', ack: 'Got it' },
};
const whenText = (d: string) => new Date(d).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const roleText = (p: { title: string | null; role: Role }) => p.title || ROLE_LABEL[p.role];
const until = (d: string) => {
  const m = Math.round((new Date(d).getTime() - Date.now()) / 60000);
  if (m < -60) return 'past';
  if (m < 0) return 'now';
  if (m < 60) return `in ${m} min`;
  if (m < 1440) return `in ${Math.round(m / 60)} h`;
  return `in ${Math.round(m / 1440)} d`;
};

export default function Messages() {
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const withId = Number(params.get('with')) || null;
  const tab = withId ? 'dm' : 'announcements';
  const mobileOpen = Boolean(withId || params.get('tab'));
  const [people, setPeople] = useState<Person[] | null>(null);
  const [unreadAnn, setUnreadAnn] = useState(0);

  const loadPeople = () => {
    api.get<Person[]>('/team/people').then(setPeople).catch(() => setPeople([]));
    api.get<{ dm: number; announcements: number }>('/team/unread').then((u) => setUnreadAnn(u.announcements)).catch(() => {});
  };
  useEffect(() => {
    loadPeople();
    const t = setInterval(() => document.visibilityState === 'visible' && loadPeople(), 15000);
    return () => clearInterval(t);
  }, []);

  const open = (id: number | null) => setParams(id ? { with: String(id) } : { tab: 'announcements' });

  return (
    <>
      <div className="page-head">
        <div><h1>Messages</h1><p>{can('admin') ? 'Talk to your team, share announcements and schedule meetings.' : 'Messages, announcements and meetings.'}</p></div>
      </div>
      <div className={`msg-shell ${mobileOpen ? 'has-open' : ''}`}>
        <aside className="msg-list panel" aria-label="Conversations">
          <button className={`msg-item ${tab === 'announcements' ? 'on' : ''}`} onClick={() => open(null)} aria-current={tab === 'announcements'}>
            <span className="avatar avatar-ann"><Megaphone size={18} /></span>
            <span className="meta"><b>Announcements & meetings</b><span className="faint">Team-wide updates</span></span>
            {unreadAnn > 0 && <span className="count">{unreadAnn}</span>}
          </button>
          <div className="msg-sep">Direct messages</div>
          {!people && <Loading />}
          {people?.length === 0 && <p className="muted" style={{ padding: '8px 14px' }}>No one to message yet.</p>}
          {people?.map((p) => (
            <button key={p.id} className={`msg-item ${withId === p.id ? 'on' : ''}`} onClick={() => open(p.id)}>
              <span className="avatar">{initials(p.name)}</span>
              <span className="meta">
                <b>{p.name}{p.removed && <span className="badge removed-tag">Removed</span>}</b>
                <span className="faint">{p.last_body ? `${p.last_sender === user?.id ? 'You: ' : ''}${p.last_body}` : roleText(p)}</span>
              </span>
              <span className="side">
                {p.last_at && <span className="faint small">{timeAgo(p.last_at)}</span>}
                {p.unread > 0 && <span className="count">{p.unread}</span>}
              </span>
            </button>
          ))}
        </aside>
        <section className="msg-main">
          {tab === 'announcements' ? <Announcements people={people || []} onBack={() => setParams({})} onRead={() => setUnreadAnn(0)} />
            : <Thread key={withId} peerId={withId!} onBack={() => setParams({})} onSent={loadPeople} />}
        </section>
      </div>
    </>
  );
}

function Thread({ peerId, onBack, onSent }: { peerId: number; onBack: () => void; onSent: () => void }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const [peer, setPeer] = useState<{ id: number; name: string; title: string | null; role: Role; removed?: boolean } | null>(null);
  const [msgs, setMsgs] = useState<Dm[] | null>(null);
  const [text, setText] = useState('');
  const [important, setImportant] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const last = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    last.current = 0;
    const load = async () => {
      try {
        const r = await api.get<{ peer: typeof peer; messages: Dm[] }>(`/team/dm/${peerId}${last.current ? `?after=${last.current}` : ''}`);
        if (!live) return;
        setPeer(r.peer);
        if (r.messages.length) last.current = r.messages[r.messages.length - 1].id;
        setMsgs((m) => { const base = m || []; return [...base, ...r.messages.filter((x) => !base.some((y) => y.id === x.id))]; });
      } catch (e) { if (live) setError((e as Error).message); }
    };
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 5000);
    return () => { live = false; clearInterval(t); };
  }, [peerId]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs?.length]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const m = await api.post<Dm>(`/team/dm/${peerId}`, { body: text.trim(), important });
      last.current = Math.max(last.current, m.id);
      setMsgs((x) => [...(x || []), m]);
      setText(''); setImportant(false); onSent();
    } catch (err) { toast((err as Error).message, true); } finally { setSending(false); }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  if (error) return <div className="panel empty"><h3>Conversation not available</h3><button className="btn" onClick={onBack}>Back</button></div>;
  let lastDay = '';
  return (
    <div className="panel chat dm">
      <header className="dm-head">
        <button className="btn btn-ghost btn-icon only-mobile" onClick={onBack} aria-label="Back"><ArrowLeft size={18} /></button>
        {peer && <><span className="avatar">{initials(peer.name)}</span><div><b>{peer.name}</b><div className="faint small">{peer.removed ? 'Removed from the team · read-only history' : roleText(peer)}</div></div></>}
      </header>
      <div className="chat-list" ref={listRef} aria-live="polite">
        {!msgs && <Loading />}
        {msgs?.length === 0 && <div className="empty" style={{ margin: 'auto' }}><h3>Start the conversation</h3><p>Messages are private between you two.</p></div>}
        {msgs?.map((m) => {
          const d = new Date(m.created_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
          const head = d !== lastDay; lastDay = d;
          const me = m.sender_id === user?.id;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {head && <div className="chat-day">{d}</div>}
              <div className={`bubble ${me ? 'me' : ''} ${m.important ? 'imp' : ''}`}>
                {m.important && <div className="imp-tag"><AlertCircle size={12} /> Important</div>}
                {m.body}
                <div className="stamp">{new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}{me && <EmailMark m={m} />}{me && m.read_at && <> · <CheckCheck size={12} /> Seen</>}</div>
              </div>
            </div>
          );
        })}
      </div>
      {peer?.removed ? <div className="chat-form faint small" style={{ textAlign: 'center' }}>This person was removed from the team. Their messages are kept for your records.</div> : (
      <form className="chat-form" onSubmit={send}>
        <textarea className="input" rows={2} placeholder={`Message ${peer?.name.split(' ')[0] || ''}…`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="Message" />
        <div className="chat-actions">
          {can('admin') && <label className="check small"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Important (email now)</label>}
          <button className="btn btn-primary" disabled={sending || !text.trim()}><Send size={15} /> Send</button>
        </div>
      </form>
      )}
    </div>
  );
}

function Announcements({ people, onBack, onRead }: { people: Person[]; onBack: () => void; onRead: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const focus = Number(params.get('open')) || null;
  const [items, setItems] = useState<Ann[] | null>(null);
  const [editing, setEditing] = useState<Ann | 'new' | null>(null);
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const load = () => api.get<Ann[]>('/team/announcements').then((r) => { setItems(r); onRead(); }).catch((e) => toast((e as Error).message, true));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (focus && items) document.getElementById(`ann-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [focus, items]);

  const upcoming = useMemo(() => (items || []).filter((a) => a.event_at && !a.cancelled && new Date(a.event_at).getTime() > Date.now() - 3600000).sort((a, b) => a.event_at!.localeCompare(b.event_at!)).slice(0, 4), [items]);
  const shown = (items || []).filter((a) => filter === 'all' || a.kind === filter);

  async function ack(a: Ann) {
    try { await api.post(`/team/announcements/${a.id}/ack`, {}); toast('Confirmed'); load(); } catch (e) { toast((e as Error).message, true); }
  }
  async function resend(a: Ann, onlyFailed = true) {
    if (!onlyFailed && !window.confirm(`Send "${a.title}" by email to everyone again?`)) return;
    try {
      const r = await api.post<{ attempted: number; sent: number; failed: string[] }>(`/team/announcements/${a.id}/resend`, { onlyFailed });
      toast(r.failed.length ? `Sent ${r.sent} of ${r.attempted}. ${r.failed[0]}` : `Email sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`, r.failed.length > 0);
      load();
    } catch (e) { toast((e as Error).message, true); }
  }
  async function cancel(a: Ann) {
    if (!window.confirm(`Cancel "${a.title}"? Everyone who received it is notified.`)) return;
    try { await api.put(`/team/announcements/${a.id}`, { ...a, body: a.body || '', location: a.location || '', event_at: a.event_at || '', cancelled: true }); toast('Cancelled'); load(); } catch (e) { toast((e as Error).message, true); }
  }
  async function remove(a: Ann) {
    if (!window.confirm(`Delete "${a.title}" for everyone?`)) return;
    try { await api.del(`/team/announcements/${a.id}`); load(); } catch (e) { toast((e as Error).message, true); }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-icon only-mobile" onClick={onBack} aria-label="Back"><ArrowLeft size={18} /></button>
          <div className="seg" role="group" aria-label="Filter">
            {(['all', 'meeting', 'announcement', 'reminder', 'deadline'] as const).map((k) => (
              <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : KINDS[k].label + 's'}</button>
            ))}
          </div>
        </div>
        {can('admin') && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus /> New</button>}
      </div>

      {upcoming.length > 0 && (
        <div className="upcoming">
          {upcoming.map((a) => {
            const K = KINDS[a.kind];
            return (
              <a key={a.id} href={`#ann-${a.id}`} className={`up-card ${K.cls}`}>
                <K.icon size={16} />
                <span className="t">{a.title}</span>
                <span className="w">{whenText(a.event_at!)}</span>
                <span className="u">{until(a.event_at!)}</span>
              </a>
            );
          })}
        </div>
      )}

      {!items && <Loading />}
      {items && shown.length === 0 && (
        <div className="panel empty"><h3>Nothing here yet</h3><p>{can('admin') ? 'Share an update or schedule a meeting with the team.' : 'Announcements and meetings from the admin appear here.'}</p>
          {can('admin') && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus /> New announcement</button>}</div>
      )}
      {shown.map((a) => {
        const K = KINDS[a.kind];
        return (
          <article key={a.id} id={`ann-${a.id}`} className={`panel ann ${K.cls} ${a.cancelled ? 'cancelled' : ''} ${focus === a.id ? 'focus' : ''}`}>
            <div className="ann-ico"><K.icon size={18} /></div>
            <div className="ann-body">
              <div className="row" style={{ gap: 8 }}>
                <span className="kind">{K.label}</span>
                {a.important && <span className="badge badge-bad">Important</span>}
                {a.cancelled && <span className="badge">Cancelled</span>}
                <span className="faint small" style={{ marginLeft: 'auto' }}>{a.created_by_name} · {timeAgo(a.created_at)}</span>
              </div>
              <h3>{a.title}</h3>
              {(a.event_at || a.location) && (
                <div className="ann-when">
                  {a.event_at && <span><CalendarClock size={14} /> {whenText(a.event_at)} <span className="faint">({until(a.event_at)})</span></span>}
                  {a.location && <span><MapPin size={14} /> {/^https?:\/\//.test(a.location) ? <a href={a.location} target="_blank" rel="noreferrer noopener">{a.location}</a> : a.location}</span>}
                </div>
              )}
              {a.body && <p className="ann-text">{a.body}</p>}
              <div className="row ann-foot">
                {can('admin') && a.recipients !== undefined ? (
                  <>
                    <div className="ann-people">
                      <span className="faint small"><Users size={13} style={{ verticalAlign: -2 }} /> {a.recipients} {a.recipients === 1 ? 'person' : 'people'} · seen {a.read} · confirmed {a.acknowledged}</span>
                      <ul>
                        {(a.people || []).map((p) => (
                          <li key={p.id}>
                            <b>{p.name}</b>
                            <span className={`em ${p.email?.status || 'pending'}`} title={p.email?.error || p.email?.to || ''}>
                              <Mail size={12} /> {!p.email ? 'Sending…' : p.email.status === 'sent' ? `Emailed to ${p.email.to}` : p.email.status === 'failed' ? `Email failed: ${p.email.error}` : `Not emailed: ${p.email.error}`}
                            </span>
                            <span className="faint">{p.acknowledged_at ? 'Confirmed' : p.read_at ? 'Seen' : 'Not opened yet'}</span>
                          </li>
                        ))}
                      </ul>
                      {(a.people || []).some((p) => p.email && p.email.status !== 'sent') && <button className="btn btn-sm" onClick={() => resend(a)}><RefreshCw size={13} /> Resend email</button>}
                      {!a.cancelled && <button className="btn btn-sm" onClick={() => resend(a, false)}><RefreshCw size={13} /> Send again to everyone</button>}
                    </div>
                    <span style={{ marginLeft: 'auto' }} className="row">
                      {!a.cancelled && <button className="btn btn-sm" onClick={() => setEditing(a)}><Pencil size={13} /> Edit</button>}
                      {!a.cancelled && a.event_at && <button className="btn btn-sm" onClick={() => cancel(a)}><XCircle size={13} /> Cancel</button>}
                      <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(a)} aria-label="Delete"><Trash2 size={14} /></button>
                    </span>
                  </>
                ) : !a.cancelled && (
                  a.my_ack ? <span className="badge badge-good"><CheckCheck size={13} /> Confirmed</span>
                    : <button className="btn btn-sm btn-primary" onClick={() => ack(a)}><CheckCheck size={14} /> {K.ack}</button>
                )}
              </div>
            </div>
          </article>
        );
      })}
      {editing && <AnnouncementForm item={editing === 'new' ? null : editing} people={people} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function AnnouncementForm({ item, people, onClose, onSaved }: { item: Ann | null; people: Person[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    kind: (item?.kind || 'announcement') as Kind, title: item?.title || '', body: item?.body || '',
    when: toLocalInput(item?.event_at || null), location: item?.location || '', important: item?.important || false,
  });
  const [everyone, setEveryone] = useState(true);
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const needsTime = f.kind !== 'announcement';

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { kind: f.kind, title: f.title, body: f.body, location: f.location, important: f.important, event_at: f.when ? new Date(f.when).toISOString() : '' };
    try {
      if (item) await api.put(`/team/announcements/${item.id}`, body);
      else await api.post('/team/announcements', { ...body, recipients: everyone ? 'all' : chosen });
      toast(item ? 'Saved' : 'Sent to the team');
      onSaved();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <Modal title={item ? 'Edit' : 'New announcement or meeting'} onClose={onClose} footer={
      <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="annf" disabled={busy || !f.title.trim() || (needsTime && !f.when) || (!item && !everyone && !chosen.length)}>{busy ? 'Sending…' : item ? 'Save' : 'Send'}</button></>
    }>
      <form id="annf" className="stack" style={{ gap: 14 }} onSubmit={save}>
        <div className="kind-pick" role="radiogroup" aria-label="Type">
          {(Object.keys(KINDS) as Kind[]).map((k) => {
            const K = KINDS[k];
            return <button type="button" key={k} role="radio" aria-checked={f.kind === k} className={`${K.cls} ${f.kind === k ? 'on' : ''}`} onClick={() => setF({ ...f, kind: k })}><K.icon size={16} /> {K.label}</button>;
          })}
        </div>
        <div className="field"><label htmlFor="at">Title</label><input id="at" className="input" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.kind === 'meeting' ? 'Weekly growth review' : f.kind === 'deadline' ? 'Submit October reports' : 'Office closed on Friday'} /></div>
        {needsTime && (
          <div className="form-grid">
            <div className="field"><label htmlFor="aw">{f.kind === 'meeting' ? 'Date and time' : f.kind === 'deadline' ? 'Due' : 'Remind at'}</label><input id="aw" className="input" type="datetime-local" required value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></div>
            <div className="field"><label htmlFor="al">{f.kind === 'meeting' ? 'Place or meeting link' : 'Details or link'}</label><input id="al" className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder={f.kind === 'meeting' ? 'https://meet.google.com/…' : 'Optional'} /></div>
          </div>
        )}
        <div className="field"><label htmlFor="ab">Message</label><textarea id="ab" className="input" rows={4} maxLength={6000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Optional details" /></div>
        {!item && (
          <div className="field">
            <label>Send to</label>
            <div className="row">
              <label className="check"><input type="radio" checked={everyone} onChange={() => setEveryone(true)} /> Everyone</label>
              <label className="check"><input type="radio" checked={!everyone} onChange={() => setEveryone(false)} /> Choose people</label>
            </div>
            {!everyone && (
              <div className="pick-people">
                {people.map((p) => (
                  <label key={p.id} className="check"><input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} /> {p.name} <span className="faint small">{roleText(p)}</span></label>
                ))}
              </div>
            )}
          </div>
        )}
        <label className="check"><input type="checkbox" checked={f.important} onChange={(e) => setF({ ...f, important: e.target.checked })} /> Mark as important</label>
        <p className="faint small"><Clock size={12} style={{ verticalAlign: -2 }} /> Everyone gets an email now.{f.kind === 'meeting' || f.kind === 'deadline' ? ' Reminders go out a day before and an hour before.' : f.kind === 'reminder' ? ' A reminder email goes out at the chosen time.' : ''}</p>
      </form>
    </Modal>
  );
}

export function UpcomingStrip() {
  const [items, setItems] = useState<{ id: number; kind: Kind; title: string; event_at: string; location: string | null }[]>([]);
  useEffect(() => { api.get<typeof items>('/team/upcoming').then(setItems).catch(() => {}); }, []);
  if (!items.length) return null;
  return (
    <div className="upcoming" style={{ marginBottom: 16 }}>
      {items.slice(0, 3).map((a) => {
        const K = KINDS[a.kind];
        return (
          <Link key={a.id} to={`/messages?tab=announcements&open=${a.id}`} className={`up-card ${K.cls}`}>
            <K.icon size={16} /><span className="t">{a.title}</span><span className="w">{whenText(a.event_at)}</span><span className="u">{until(a.event_at)}</span>
          </Link>
        );
      })}
    </div>
  );
}

/** Under a sent message: did the email go out? */
function EmailMark({ m }: { m: Dm }) {
  if (!m.email_status) return null;
  if (m.email_status === 'sent') return <> · <Mail size={11} /> Emailed</>;
  if (m.email_status === 'grouped') return <span title="An email about this conversation went out recently and hasn't been read yet, so this message is grouped with it."> · <Mail size={11} /> Grouped</span>;
  return <span className="em-warn" title={m.email_error || ''}> · <AlertCircle size={11} /> {m.email_status === 'failed' ? 'Email failed' : 'Not emailed'}{m.email_error ? `: ${m.email_error}` : ''}</span>;
}
