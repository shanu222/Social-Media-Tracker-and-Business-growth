import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarClock, Check, MessageSquare, Paperclip, Pencil, Play, Plus, RotateCcw, Trash2, Link as LinkIcon } from 'lucide-react';
import { api } from '../../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, PlatformChip, PLATFORMS, prettyDate, todayStr, timeAgo } from '../../lib';
import { Attachment, CopyBox, PRIORITY, STATUS, uploadFile, type FileLite } from './shared';

export interface Task {
  id: number; product_id: number; product_name: string; title: string; caption: string | null; hashtags: string | null; instructions: string | null;
  platforms: string[]; priority: string; due_date: string | null; status: string; assigned_to: number | null; assigned_name: string | null;
  created_by_name: string | null; completed_by_name: string | null; completed_at: string | null; completion_note: string | null;
  created_at: string; files: FileLite[]; posts: { id: number; platform: string; url: string | null; posted_on: string }[];
}
interface Member { id: number; name: string }
interface Acc { id: number; brand: string; platform: string }

export function TaskCard({ t, members, accounts, onChanged, onChat, showProduct, highlight }: {
  t: Task; members: Member[]; accounts: Acc[]; onChanged: () => void; onChat?: (t: Task) => void; showProduct?: boolean; highlight?: boolean;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const today = todayStr();
  const overdue = t.due_date && t.due_date < today && (t.status === 'todo' || t.status === 'in_progress');
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [highlight]);

  async function setStatus(status: string) {
    try { await api.patch(`/products/${t.product_id}/tasks/${t.id}/status`, { status }); onChanged(); } catch (e) { toast((e as Error).message, true); }
  }
  async function remove() {
    if (!window.confirm(`Delete "${t.title}"? Attached files stay in Files.`)) return;
    try { await api.del(`/products/${t.product_id}/tasks/${t.id}`); toast('Task deleted'); onChanged(); } catch (e) { toast((e as Error).message, true); }
  }

  return (
    <div ref={ref} className="panel task" style={{ ['--prio' as string]: PRIORITY[t.priority]?.color, outline: highlight ? '2px solid var(--signal)' : undefined }}>
      <div className="task-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          {showProduct && <div className="faint" style={{ fontSize: 12.5 }}>{t.product_name}</div>}
          <h3 style={{ fontSize: 16.5 }}>{t.title}</h3>
          <div className="task-meta">
            <span className={`badge ${STATUS[t.status].badge}`}>{STATUS[t.status].label}</span>
            {t.priority !== 'normal' && <span className={`badge ${PRIORITY[t.priority].badge}`}>{PRIORITY[t.priority].label}</span>}
            {t.due_date && <span className={`badge ${overdue ? 'badge-bad' : ''}`}><CalendarClock size={12} /> {overdue ? 'Overdue · ' : 'Due '}{prettyDate(t.due_date, { day: 'numeric', month: 'short' })}</span>}
            {t.platforms.map((p) => <PlatformChip key={p} id={p} small />)}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {can('manager') && t.status === 'todo' && <button className="btn btn-sm" onClick={() => setStatus('in_progress')}><Play size={14} /> Start</button>}
          {can('manager') && (t.status === 'todo' || t.status === 'in_progress') && <button className="btn btn-sm btn-primary" onClick={() => setCompleting(true)}><Check size={14} /> Mark as posted</button>}
          {can('manager') && t.status === 'done' && <button className="btn btn-sm btn-ghost" onClick={() => setStatus('todo')}><RotateCcw size={14} /> Reopen</button>}
          {onChat && <button className="btn btn-sm btn-ghost btn-icon" onClick={() => onChat(t)} aria-label="Discuss in chat" title="Discuss in chat"><MessageSquare size={15} /></button>}
          {can('admin') && <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setEditing(true)} aria-label="Edit task"><Pencil size={15} /></button>}
          {can('admin') && <button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={remove} aria-label="Delete task"><Trash2 size={15} /></button>}
        </div>
      </div>

      {t.instructions && <div className="task-section"><div className="lbl">Instructions</div><p style={{ whiteSpace: 'pre-wrap' }}>{t.instructions}</p></div>}
      {t.caption && <div className="task-section"><div className="lbl">Caption</div><CopyBox text={t.caption} label="Caption" /></div>}
      {t.hashtags && <div className="task-section"><div className="lbl">Hashtags</div><CopyBox text={t.hashtags} label="Hashtags" /></div>}
      {t.files.length > 0 && <div className="task-section"><div className="lbl">Media to post</div><div className="thumbs">{t.files.map((f) => <Attachment key={f.id} f={f} />)}</div></div>}
      {t.posts.length > 0 && (
        <div className="task-section">
          <div className="lbl">Published</div>
          <div className="row" style={{ gap: 8 }}>
            {t.posts.map((p) => p.url
              ? <a key={p.id} className="attach" href={p.url} target="_blank" rel="noreferrer noopener"><LinkIcon size={13} /> {PLATFORMS.find((x) => x.id === p.platform)?.label || p.platform}</a>
              : <span key={p.id} className="attach"><PlatformChip id={p.platform} small /></span>)}
          </div>
        </div>
      )}
      {t.completion_note && <div className="task-section"><div className="lbl">Manager's note</div><p>{t.completion_note}</p></div>}
      <div className="faint" style={{ fontSize: 12.5, marginTop: 12 }}>
        Shared by {t.created_by_name || 'admin'} {timeAgo(t.created_at)} · {t.assigned_name ? `Assigned to ${t.assigned_name}` : 'Anyone on this product'}
        {t.completed_at && ` · Posted by ${t.completed_by_name} ${timeAgo(t.completed_at)}`}
      </div>
      {editing && <TaskForm productId={t.product_id} task={t} members={members} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />}
      {completing && <CompleteTask t={t} accounts={accounts} onClose={() => setCompleting(false)} onDone={() => { setCompleting(false); onChanged(); }} />}
    </div>
  );
}

export function TaskForm({ productId, task, members, onClose, onSaved }: { productId: number; task?: Task; members: Member[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    title: task?.title || '', caption: task?.caption || '', hashtags: task?.hashtags || '', instructions: task?.instructions || '',
    platforms: task?.platforms || ([] as string[]), priority: task?.priority || 'normal', due_date: task?.due_date || '',
    assigned_to: task?.assigned_to ? String(task.assigned_to) : members.length === 1 ? String(members[0].id) : '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const togglePlatform = (p: string) => setF((x) => ({ ...x, platforms: x.platforms.includes(p) ? x.platforms.filter((y) => y !== p) : [...x.platforms, p] }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f, assigned_to: f.assigned_to ? Number(f.assigned_to) : null };
      const t = task ? await api.put<{ id: number }>(`/products/${productId}/tasks/${task.id}`, body) : await api.post<{ id: number }>(`/products/${productId}/tasks`, body);
      for (const file of files) await uploadFile(file, { category: 'content', product_id: productId, task_id: t.id });
      toast(task ? 'Task updated' : 'Content shared with your manager');
      onSaved();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <Modal title={task ? 'Edit content task' : 'Share content to post'} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="task-form" disabled={busy}>{busy ? 'Saving…' : task ? 'Save changes' : 'Share with manager'}</button></>}>
      <form id="task-form" className="form-grid" onSubmit={submit}>
        <div className="field full"><label htmlFor="tt">What should be posted?</label><input id="tt" className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Launch reel for the new physics course" /></div>
        <div className="field full">
          <label>Post on</label>
          <div className="chips-select">{PLATFORMS.filter((p) => p.id !== 'other').map((p) => <button type="button" key={p.id} className={f.platforms.includes(p.id) ? 'on' : ''} onClick={() => togglePlatform(p.id)} aria-pressed={f.platforms.includes(p.id)}>{p.label}</button>)}</div>
        </div>
        <div className="field full"><label htmlFor="tc">Caption</label><textarea id="tc" className="input" rows={4} value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} placeholder="The exact text to publish" /></div>
        <div className="field full"><label htmlFor="th">Hashtags</label><input id="th" className="input" value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} placeholder="#NUST #EntryTest" /></div>
        <div className="field full"><label htmlFor="ti">Instructions for the manager</label><textarea id="ti" className="input" rows={3} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="Timing, music, tagging, pinned comment…" /></div>
        <div className="field"><label htmlFor="tp">Priority</label>
          <select id="tp" className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
        </div>
        <div className="field"><label htmlFor="td">Post by</label><input id="td" type="date" className="input" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
        <div className="field"><label htmlFor="ta">Assign to</label>
          <select id="ta" className="input" value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}>
            <option value="">Anyone on this product</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tf"><Paperclip size={13} style={{ verticalAlign: -2 }} /> Images, videos or documents</label>
          <input id="tf" type="file" multiple onChange={(e) => setFiles([...(e.target.files || [])])} />
          {files.length > 0 && <span className="hint">{files.length} file{files.length > 1 ? 's' : ''} will be attached</span>}
        </div>
      </form>
    </Modal>
  );
}

function CompleteTask({ t, accounts, onClose, onDone }: { t: Task; accounts: Acc[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const platforms = t.platforms;
  const [links, setLinks] = useState<Record<string, string>>(Object.fromEntries(platforms.map((p) => [p, ''])));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const already = new Set(t.posts.map((p) => p.platform));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      for (const p of platforms) {
        if (already.has(p) && !links[p]) continue;
        const acc = accounts.find((a) => a.platform === p);
        await api.post(`/products/${t.product_id}/posts`, { platform: p, task_id: t.id, account_id: acc?.id ?? null, url: links[p] || null, note: note || null });
      }
      await api.patch(`/products/${t.product_id}/tasks/${t.id}/status`, { status: 'done', completion_note: note || null });
      toast('Marked as posted. The admin has been notified.');
      onDone();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <Modal title="Mark as posted" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="done-form" disabled={busy}>{busy ? 'Saving…' : 'Mark as posted'}</button></>}>
      <form id="done-form" className="stack" style={{ gap: 12 }} onSubmit={submit}>
        <p className="muted">{platforms.length ? 'Paste the link to each published post so the admin can check it. Links are optional.' : 'No platforms were specified. You can add post links later under Published.'}</p>
        {platforms.map((p) => (
          <div className="field" key={p}>
            <label htmlFor={`l-${p}`}><PlatformChip id={p} small /> {already.has(p) && <span className="faint">(already recorded)</span>}</label>
            <input id={`l-${p}`} className="input" type="url" placeholder="https://" value={links[p]} onChange={(e) => setLinks({ ...links, [p]: e.target.value })} />
          </div>
        ))}
        <div className="field"><label htmlFor="cn">Note for the admin (optional)</label><textarea id="cn" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything changed, early results…" /></div>
      </form>
    </Modal>
  );
}

export default function Content({ productId, members, accounts, focusTask, onChat }: { productId: number; members: Member[]; accounts: Acc[]; focusTask?: number; onChat: (t: Task) => void }) {
  const { can } = useAuth();
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const { data, error, loading, reload } = useData<Task[]>(`/products/${productId}/tasks`);
  const [creating, setCreating] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;
  const list = data.filter((t) => (filter === 'all' ? true : filter === 'done' ? t.status === 'done' || t.status === 'cancelled' : t.status === 'todo' || t.status === 'in_progress'));
  const openCount = data.filter((t) => t.status === 'todo' || t.status === 'in_progress').length;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="seg" role="group" aria-label="Filter">
          <button className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>To post ({openCount})</button>
          <button className={filter === 'done' ? 'on' : ''} onClick={() => setFilter('done')}>Done</button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        </div>
        {can('admin') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus /> Share content</button>}
      </div>
      {list.length === 0 ? (
        <div className="panel empty">
          <h3>{filter === 'open' ? 'Nothing waiting to be posted' : 'Nothing here yet'}</h3>
          <p>{can('admin') ? 'Share a caption, media and instructions; your manager is notified straight away.' : 'New content from the admin will appear here.'}</p>
          {can('admin') && filter === 'open' && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus /> Share content</button>}
        </div>
      ) : list.map((t) => <TaskCard key={t.id} t={t} members={members} accounts={accounts} onChanged={reload} onChat={onChat} highlight={t.id === focusTask} />)}
      {creating && <TaskForm productId={productId} members={members} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
    </>
  );
}
