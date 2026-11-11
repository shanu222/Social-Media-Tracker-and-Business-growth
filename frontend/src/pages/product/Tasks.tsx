import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarClock, Check, ChevronDown, HelpCircle, Link as LinkIcon, MessageSquare, Paperclip, Pencil, Play, Plus, RotateCcw, Send, Sparkles, Trash2, X,
} from 'lucide-react';
import { api } from '../../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, PlatformChip, PLATFORMS, prettyDate, todayStr, timeAgo, ROLE_LABEL, type Role } from '../../lib';
import TaskComposer from './TaskComposer';
import { Attachment, CopyBox, LINK_TYPES, PRIORITY, Progress, STATUS, uploadFile, type FileLite } from './shared';

export interface Task {
  id: number; product_id: number; product_name: string; product_color?: string | null; kind: 'post' | 'general';
  title: string; description: string | null; caption: string | null; hashtags: string | null; instructions: string | null;
  platforms: string[]; priority: string; start_date: string | null; due_date: string | null; status: string; progress: number;
  assigned_to: number | null; assigned_name: string | null; created_by_name: string | null; completed_by_name: string | null;
  completed_at: string | null; completion_note: string | null; created_at: string; seen_at: string | null;
  ai_generated: boolean; ai_reason: string | null;
  files: FileLite[]; links: { id: number; title: string; url: string; content_type: string }[];
  posts: { id: number; platform: string; url: string | null; posted_on: string }[];
  comment_count: number; clarification_count: number;
}
interface Comment { id: number; kind: string; body: string | null; progress: number | null; created_at: string; user_id: number | null; user_name: string | null; user_role: Role | null }
export interface Person { id: number; name: string; role?: string }

const isOpen = (t: Task) => t.status === 'todo' || t.status === 'in_progress';
export const isOverdue = (t: Task) => isOpen(t) && !!t.due_date && t.due_date < todayStr();

/* ---------------- Compact card ---------------- */
export function TaskCard({ t, onOpen, showProduct }: { t: Task; onOpen: (t: Task) => void; showProduct?: boolean }) {
  const { user } = useAuth();
  const overdue = isOverdue(t);
  const isNew = t.status === 'todo' && t.assigned_to === user?.id && !t.seen_at;
  return (
    <button className="panel task task-btn" style={{ ['--prio' as string]: PRIORITY[t.priority]?.color }} onClick={() => onOpen(t)}>
      <div className="task-head">
        <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          {showProduct && <div className="faint" style={{ fontSize: 12.5 }}>{t.product_name}</div>}
          <h3 style={{ fontSize: 16 }}>
            {isNew && <span className="badge badge-good" style={{ marginRight: 6 }}>New</span>}
            {t.ai_generated && t.status === 'draft' && <Sparkles size={14} style={{ color: 'var(--signal)', marginRight: 4, verticalAlign: -2 }} />}
            {t.title}
          </h3>
          <div className="task-meta">
            <span className={`badge ${STATUS[t.status].badge}`}>{STATUS[t.status].label}</span>
            {t.priority !== 'normal' && <span className={`badge ${PRIORITY[t.priority].badge}`}>{PRIORITY[t.priority].label}</span>}
            {t.due_date && <span className={`badge ${overdue ? 'badge-bad' : ''}`}><CalendarClock size={12} /> {overdue ? 'Overdue · ' : 'Due '}{prettyDate(t.due_date, { day: 'numeric', month: 'short' })}</span>}
            {t.kind === 'post' && t.platforms.slice(0, 4).map((p) => <PlatformChip key={p} id={p} small />)}
            {t.kind === 'general' && <span className="badge">Task</span>}
            {t.clarification_count > 0 && <span className="badge badge-warn"><HelpCircle size={12} /> Question</span>}
          </div>
        </div>
        <div style={{ minWidth: 150, textAlign: 'left' }}>
          {t.status !== 'draft' && <Progress value={t.progress} small />}
          <div className="faint" style={{ fontSize: 12.5, marginTop: 6, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <span>{t.assigned_name || 'Unassigned'}</span>
            {t.comment_count > 0 && <span><MessageSquare size={12} style={{ verticalAlign: -2 }} /> {t.comment_count}</span>}
            {(t.links.length + t.files.length) > 0 && <span><Paperclip size={12} style={{ verticalAlign: -2 }} /> {t.links.length + t.files.length}</span>}
          </div>
        </div>
      </div>
    </button>
  );
}

/* ---------------- Create / edit ---------------- */
export function TaskForm({ productId, task, preset, people, onClose, onSaved }: { productId: number; task?: Task; preset?: Partial<Task>; people: Person[]; onClose: () => void; onSaved: () => void }) {
  const src: Partial<Task> | undefined = task || preset;
  const toast = useToast();
  const [f, setF] = useState({
    kind: src?.kind || 'post' as 'post' | 'general', title: src?.title || '', description: src?.description || '',
    caption: src?.caption || '', hashtags: src?.hashtags || '', instructions: src?.instructions || '',
    platforms: src?.platforms || ([] as string[]), priority: src?.priority || 'normal',
    start_date: src?.start_date || todayStr(), due_date: src?.due_date || '',
    assigned_to: src?.assigned_to ? String(src!.assigned_to) : people.filter((p) => p.role !== 'admin').length === 1 ? String(people.find((p) => p.role !== 'admin')!.id) : '',
  });
  const [links, setLinks] = useState<{ title: string; url: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(Boolean(src && (src.instructions || (src.priority && src.priority !== 'normal'))));
  const isDraft = task?.status === 'draft';
  const togglePlatform = (p: string) => setF((x) => ({ ...x, platforms: x.platforms.includes(p) ? x.platforms.filter((y) => y !== p) : [...x.platforms, p] }));

  async function save(send: boolean) {
    const valid = links.filter((l) => l.url.trim());
    if (valid.some((l) => !/^https?:\/\//i.test(l.url.trim()))) return toast('Links must start with http:// or https://', true);
    setBusy('Saving…');
    try {
      const body = { ...f, assigned_to: f.assigned_to ? Number(f.assigned_to) : null, links: valid.map((l) => ({ title: l.title || undefined, url: l.url.trim() })) };
      let id: number;
      if (task) {
        await api.put(`/products/${productId}/tasks/${task.id}`, body);
        id = task.id;
        if (isDraft && send) await api.post(`/products/${productId}/tasks/${task.id}/send`);
      } else {
        id = (await api.post<{ id: number }>(`/products/${productId}/tasks`, { ...body, send })).id;
      }
      for (const [i, file] of files.entries()) {
        await uploadFile(file, { category: 'content', product_id: productId, task_id: id }, (p) => setBusy(`Uploading ${i + 1}/${files.length} · ${p}%`));
      }
      toast(send && (!task || isDraft) ? (f.assigned_to ? 'Task sent. They were notified by email.' : 'Task sent to everyone on this product.') : 'Saved');
      onSaved();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(null); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); save(true); };

  return (
    <Modal title={task ? (isDraft ? 'Review draft' : 'Edit task') : 'New task'} onClose={onClose} wide
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        {(!task || isDraft) && <button className="btn" onClick={() => save(false)} disabled={!!busy || !f.title}>Save as draft</button>}
        <button className="btn btn-primary" form="task-form" disabled={!!busy}><Send size={15} /> {busy || (task && !isDraft ? 'Save changes' : 'Assign & send')}</button>
      </>}>
      <form id="task-form" className="form-grid" onSubmit={submit}>
        {src?.ai_reason && <div className="notice info full"><Sparkles /><span><b>Suggested by AI:</b> {src.ai_reason} Edit anything before sending.</span></div>}
        <div className="field full">
          <div className="seg" role="group" aria-label="Task type">
            <button type="button" className={f.kind === 'post' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'post' })}>Social media post</button>
            <button type="button" className={f.kind === 'general' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'general' })}>General task</button>
          </div>
        </div>
        <div className="field full"><label htmlFor="tt">Title</label><input id="tt" className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.kind === 'post' ? 'e.g. Launch reel for the new physics course' : 'e.g. Update all bios with the new website link'} /></div>
        <div className="field full"><label htmlFor="tdsc">Description</label><textarea id="tdsc" className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What needs to happen and why" /></div>
        {f.kind === 'post' && (
          <>
            <div className="field full">
              <label>Post on</label>
              <div className="chips-select">{PLATFORMS.filter((p) => p.id !== 'other').map((p) => <button type="button" key={p.id} className={f.platforms.includes(p.id) ? 'on' : ''} onClick={() => togglePlatform(p.id)} aria-pressed={f.platforms.includes(p.id)}>{p.label}</button>)}</div>
            </div>
            <div className="field full"><label htmlFor="tc">Caption</label><textarea id="tc" className="input" rows={3} value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} placeholder="The exact text to publish" /></div>
            <div className="field full"><label htmlFor="th">Hashtags</label><input id="th" className="input" value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} /></div>
          </>
        )}
        <div className="field"><label htmlFor="ta">Assign to</label>
          <select id="ta" className="input" value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}>
            <option value="">Anyone on this product</option>{people.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role === 'admin' ? ' (admin)' : ''}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="td">Due date</label><input id="td" type="date" className="input" min={f.start_date || undefined} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
        <div className="field full">
          <label>Links to content (Google Drive, YouTube, reels, docs…)</label>
          {task?.links.map((l) => <div key={l.id} className="faint" style={{ fontSize: 13 }}><LinkIcon size={12} /> {l.title}</div>)}
          {links.map((l, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input" style={{ flex: 2 }} type="url" placeholder="https://drive.google.com/…" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} aria-label="Link URL" />
              <input className="input" style={{ flex: 1 }} placeholder="Label (optional)" value={l.title} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} aria-label="Link label" />
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label="Remove link"><X size={15} /></button>
            </div>
          ))}
          <div><button type="button" className="btn btn-sm" onClick={() => setLinks([...links, { title: '', url: '' }])}><Plus size={14} /> Add link</button></div>
        </div>
        <div className="field full">
          <label htmlFor="tf"><Paperclip size={13} style={{ verticalAlign: -2 }} /> Upload images, videos, reels or documents</label>
          <input id="tf" type="file" multiple onChange={(e) => setFiles([...(e.target.files || [])])} />
          <span className="hint">Large videos upload straight to Cloudflare storage (up to 5 GB each). Everything is also saved in the product library.</span>
        </div>
        <div className="full">
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: -8 }} onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <ChevronDown size={15} style={{ transform: more ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} /> More options: priority, start date, instructions
          </button>
        </div>
        {more && (
          <>
        <div className="field"><label htmlFor="tp">Priority</label>
          <select id="tp" className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
        </div>
        <div className="field"><label htmlFor="tsd">Start date</label><input id="tsd" type="date" className="input" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></div>
        <div className="field full"><label htmlFor="ti">Instructions & notes</label><textarea id="ti" className="input" rows={3} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="Steps, timing, tone, tagging…" /></div>
          </>
        )}
      </form>
    </Modal>
  );
}

/* ---------------- Detail: progress, comments, links, completion ---------------- */
export function TaskDetail({ productId, taskId, people, onClose, onChanged }: { productId: number; taskId: number; people: Person[]; onClose: () => void; onChanged: () => void }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const { data: t, reload } = useData<Task & { comments: Comment[] }>(`/products/${productId}/tasks/${taskId}`);
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [link, setLink] = useState({ url: '', title: '' });
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (t) setProgress(t.progress); }, [t?.progress]);

  if (!t) return <Modal title="Task" onClose={onClose}><Loading /></Modal>;
  const mine = can('admin') || (can('manager') && (t.assigned_to === user?.id || t.assigned_to === null));
  const refresh = () => { reload(); onChanged(); };
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); refresh(); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };

  return (
    <Modal title={t.product_name} onClose={onClose} wide footer={
      <>
        {can('admin') && <button className="btn btn-ghost btn-danger" style={{ marginRight: 'auto' }} onClick={() => window.confirm(`Delete "${t.title}"? Files and links stay in the library.`) && run(async () => { await api.del(`/products/${productId}/tasks/${t.id}`); onClose(); }, 'Task deleted')}><Trash2 size={15} /> Delete</button>}
        {can('admin') && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} /> {t.status === 'draft' ? 'Review & send' : 'Edit'}</button>}
        {mine && t.status === 'todo' && <button className="btn" disabled={busy} onClick={() => run(() => api.patch(`/products/${productId}/tasks/${t.id}/status`, { status: 'in_progress' }), 'Started')}><Play size={15} /> Start</button>}
        {mine && isOpen(t) && <button className="btn btn-primary" disabled={busy} onClick={() => setCompleting(true)}><Check size={15} /> Mark completed</button>}
        {mine && t.status === 'done' && <button className="btn" disabled={busy} onClick={() => run(() => api.patch(`/products/${productId}/tasks/${t.id}/status`, { status: 'todo' }), 'Reopened')}><RotateCcw size={15} /> Reopen</button>}
      </>
    }>
      <div className="stack" style={{ gap: 14 }}>
        <div>
          <h2 style={{ fontSize: 21 }}>{t.title}</h2>
          <div className="task-meta">
            <span className={`badge ${STATUS[t.status].badge}`}>{STATUS[t.status].label}</span>
            <span className={`badge ${PRIORITY[t.priority].badge}`}>{PRIORITY[t.priority].label} priority</span>
            {t.start_date && <span className="badge">Starts {prettyDate(t.start_date, { day: 'numeric', month: 'short' })}</span>}
            {t.due_date && <span className={`badge ${isOverdue(t) ? 'badge-bad' : ''}`}><CalendarClock size={12} /> Due {prettyDate(t.due_date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
            {t.kind === 'post' && t.platforms.map((p) => <PlatformChip key={p} id={p} small />)}
          </div>
          <p className="faint" style={{ fontSize: 13, marginTop: 6 }}>
            {t.assigned_name ? `Assigned to ${t.assigned_name}` : 'Anyone on this product'} · created by {t.created_by_name} {timeAgo(t.created_at)}{t.ai_generated ? ' · AI suggested' : ''}
          </p>
        </div>
        {t.status === 'draft' && <div className="notice info"><Sparkles /><span>This is a draft. Nobody can see it until you review it and press <b>Assign & send</b>.{t.ai_reason && <> AI reason: {t.ai_reason}</>}</span></div>}

        {t.status !== 'draft' && (
          <div className="panel-pad" style={{ background: '#f6f8fa', borderRadius: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}><b>Completion</b>{t.completed_at && <span className="faint" style={{ fontSize: 13 }}>Completed by {t.completed_by_name} {timeAgo(t.completed_at)}</span>}</div>
            <Progress value={t.progress} />
            {mine && isOpen(t) && progress !== null && (
              <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="pr">Update progress: <b className="num">{progress}%</b></label>
                  <input id="pr" type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} />
                </div>
                <input className="input" style={{ flex: 2, minWidth: 180 }} placeholder="What's done so far? (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Progress note" />
                <button className="btn" disabled={busy || progress === t.progress} onClick={() => run(async () => { await api.patch(`/products/${productId}/tasks/${t.id}/progress`, { progress, note: note || null }); setNote(''); }, 'Progress saved — the admin was notified')}>Save progress</button>
              </div>
            )}
          </div>
        )}

        {t.description && <div><div className="lbl muted" style={{ fontSize: 12.5, fontWeight: 500 }}>Description</div><p style={{ whiteSpace: 'pre-wrap' }}>{t.description}</p></div>}
        {t.instructions && <div><div className="lbl muted" style={{ fontSize: 12.5, fontWeight: 500 }}>Instructions</div><p style={{ whiteSpace: 'pre-wrap' }}>{t.instructions}</p></div>}
        {t.caption && <div><div className="lbl muted" style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4 }}>Caption</div><CopyBox text={t.caption} label="Caption" /></div>}
        {t.hashtags && <div><div className="lbl muted" style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4 }}>Hashtags</div><CopyBox text={t.hashtags} label="Hashtags" /></div>}

        {(t.links.length > 0 || t.files.length > 0 || mine) && (
          <div>
            <div className="lbl muted" style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>Content & links</div>
            <div className="thumbs" style={{ marginBottom: 8 }}>
              {t.files.map((f) => <Attachment key={f.id} f={f} />)}
              {t.links.map((l) => <a key={l.id} className="attach" href={l.url} target="_blank" rel="noreferrer noopener" title={l.url}><LinkIcon size={13} /> {l.title} <span className="faint">{LINK_TYPES[l.content_type] || ''}</span></a>)}
            </div>
            {mine && t.status !== 'draft' && (
              <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (!link.url) return; run(async () => { await api.post(`/products/${productId}/tasks/${t.id}/links`, { url: link.url, title: link.title || undefined }); setLink({ url: '', title: '' }); }, 'Link added'); }}>
                <input className="input" type="url" style={{ flex: 2 }} placeholder="Add a link (post, Drive file, video…)" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} aria-label="Link URL" />
                <input className="input" style={{ flex: 1 }} placeholder="Label" value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} aria-label="Link label" />
                <button className="btn" disabled={!link.url || busy}><Plus size={14} /> Add</button>
              </form>
            )}
          </div>
        )}
        {t.posts.length > 0 && (
          <div><div className="lbl muted" style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>Published</div>
            <div className="row">{t.posts.map((p) => p.url ? <a key={p.id} className="attach" href={p.url} target="_blank" rel="noreferrer noopener"><LinkIcon size={13} /> {PLATFORMS.find((x) => x.id === p.platform)?.label}</a> : <PlatformChip key={p.id} id={p.platform} small />)}</div></div>
        )}

        <div>
          <div className="lbl muted" style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>Updates & comments</div>
          <div className="timeline" style={{ marginBottom: 10 }}>
            {t.comments.length === 0 && <p className="faint">No updates yet.</p>}
            {t.comments.map((c) => (
              <div key={c.id} className="tl-item" style={{ ['--tl' as string]: c.kind === 'clarification' ? 'var(--amber)' : c.kind === 'progress' ? 'var(--growth)' : c.kind === 'system' ? 'var(--faint)' : 'var(--signal)' }}>
                <div>
                  <b>{c.user_name || 'System'}</b>{c.user_role && <span className="faint"> · {ROLE_LABEL[c.user_role]}</span>}
                  {c.kind === 'clarification' && <span className="badge badge-warn" style={{ marginLeft: 6 }}>Needs clarification</span>}
                  {c.kind === 'progress' && <span className="badge badge-good" style={{ marginLeft: 6 }}>{c.progress}%</span>}
                </div>
                {c.body && <div style={{ whiteSpace: 'pre-wrap', color: c.kind === 'system' ? 'var(--muted)' : undefined }}>{c.body}</div>}
                <div className="faint" style={{ fontSize: 12 }}>{timeAgo(c.created_at)}</div>
              </div>
            ))}
          </div>
          {mine && t.status !== 'draft' && (
            <form onSubmit={(e) => { e.preventDefault(); if (!comment.trim()) return; run(async () => { await api.post(`/products/${productId}/tasks/${t.id}/comments`, { body: comment, kind: 'comment' }); setComment(''); }, 'Comment added'); }}>
              <textarea className="input" rows={2} placeholder="Write an update or reply…" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                {!can('admin') && <button type="button" className="btn" disabled={!comment.trim() || busy} onClick={() => run(async () => { await api.post(`/products/${productId}/tasks/${t.id}/comments`, { body: comment, kind: 'clarification' }); setComment(''); }, 'Question sent to the admin by email')}><HelpCircle size={15} /> Ask admin for clarification</button>}
                <button className="btn btn-dark" disabled={!comment.trim() || busy}><MessageSquare size={15} /> Post comment</button>
              </div>
            </form>
          )}
        </div>
      </div>
      {editing && <TaskForm productId={productId} task={t} people={people} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />}
      {completing && <CompleteTask t={t} onClose={() => setCompleting(false)} onDone={() => { setCompleting(false); refresh(); }} />}
    </Modal>
  );
}

function CompleteTask({ t, onClose, onDone }: { t: Task; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const platforms = t.kind === 'post' ? t.platforms : [];
  const [links, setLinks] = useState<Record<string, string>>(Object.fromEntries(platforms.map((p) => [p, ''])));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const already = new Set(t.posts.map((p) => p.platform));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      for (const p of platforms) {
        if (!links[p] && already.has(p)) continue;
        if (!links[p] && !platforms.length) continue;
        await api.post(`/products/${t.product_id}/posts`, { platform: p, task_id: t.id, url: links[p] || null, note: note || null });
      }
      await api.patch(`/products/${t.product_id}/tasks/${t.id}/status`, { status: 'done', completion_note: note || null });
      toast('Completed. The admin has been notified.');
      onDone();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <Modal title="Mark task as completed" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="done-form" disabled={busy}>{busy ? 'Saving…' : 'Mark completed'}</button></>}>
      <form id="done-form" className="stack" style={{ gap: 12 }} onSubmit={submit}>
        {platforms.length > 0 && <p className="muted">Paste the link to each published post so the admin can check it.</p>}
        {platforms.map((p) => (
          <div className="field" key={p}>
            <label htmlFor={`l-${p}`}><PlatformChip id={p} small /> {already.has(p) && <span className="faint">(already recorded)</span>}</label>
            <input id={`l-${p}`} className="input" type="url" placeholder="https://" value={links[p]} onChange={(e) => setLinks({ ...links, [p]: e.target.value })} />
          </div>
        ))}
        <div className="field"><label htmlFor="cn">Summary for the admin</label><textarea id="cn" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was delivered, anything to know…" /></div>
      </form>
    </Modal>
  );
}

/* ---------------- Product Tasks tab ---------------- */
export default function ProductTasks({ productId, members }: { productId: number; members: Person[] }) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const openId = Number(params.get('task')) || null;
  const [filter, setFilter] = useState<'open' | 'drafts' | 'done' | 'all'>('open');
  const { data, error, loading, reload } = useData<Task[]>(`/products/${productId}/tasks`);
  const people = useData<(Person & { active: boolean })[]>(can('admin') ? '/users' : null);
  const [creating, setCreating] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;

  const assignable: Person[] = can('admin') ? (people.data || []).filter((u) => u.active && u.role !== 'viewer') : members;
  const drafts = data.filter((t) => t.status === 'draft');
  const list = data.filter((t) => filter === 'all' ? t.status !== 'draft' : filter === 'drafts' ? t.status === 'draft' : filter === 'done' ? t.status === 'done' || t.status === 'cancelled' : isOpen(t));
  const openCount = data.filter(isOpen).length;
  const setOpen = (id: number | null) => { const p = new URLSearchParams(params); if (id) p.set('task', String(id)); else p.delete('task'); setParams(p, { replace: true }); };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="seg" role="group" aria-label="Filter">
          <button className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>Open ({openCount})</button>
          {can('admin') && <button className={filter === 'drafts' ? 'on' : ''} onClick={() => setFilter('drafts')}>Drafts ({drafts.length})</button>}
          <button className={filter === 'done' ? 'on' : ''} onClick={() => setFilter('done')}>Completed</button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        </div>
        {can('admin') && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus /> New task <Sparkles size={14} style={{ opacity: 0.8 }} /></button>
        )}
      </div>
      {can('admin') && drafts.length > 0 && filter === 'open' && (
        <button className="notice info" style={{ width: '100%', marginBottom: 12, border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setFilter('drafts')}>
          <Sparkles /><span><b>{drafts.length} draft{drafts.length > 1 ? 's' : ''}</b> waiting for your review. Nobody sees drafts until you send them.</span>
        </button>
      )}
      {list.length === 0 ? (
        <div className="panel empty">
          <h3>{filter === 'open' ? 'No open tasks' : filter === 'drafts' ? 'No drafts' : 'Nothing here yet'}</h3>
          <p>{can('admin') ? 'Press New task — AI suggests tasks from this product\'s data, or write your own.' : 'New tasks from the admin appear here, and you get an email.'}</p>
        </div>
      ) : list.map((t) => <TaskCard key={t.id} t={t} onOpen={(x) => setOpen(x.id)} />)}
      {openId && <TaskDetail productId={productId} taskId={openId} people={assignable} onClose={() => setOpen(null)} onChanged={reload} />}
      {creating && <TaskComposer productId={productId} people={assignable} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
    </>
  );
}
