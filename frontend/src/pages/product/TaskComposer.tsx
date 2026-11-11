import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, Copy, PenLine, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../api';
import { useData, useToast, Modal, PlatformChip, prettyDate } from '../../lib';
import { PRIORITY } from './shared';
import { TaskForm, type Person, type Task } from './Tasks';

export interface Suggestion {
  kind: 'post' | 'general'; title: string; description: string; instructions: string; caption: string; hashtags: string;
  platforms: string[]; priority: string; start_date: string; due_date: string; reason: string;
}
interface Ok { ok: true; summary: string | null; gaps: string[]; tasks: Suggestion[]; provider: string; providerLabel: string; model: string; cached: boolean }
interface Failed {
  ok: false; reason: string; brief: string; gaps: string[];
  failures: { provider: string; label: string; models: string[]; state: string; stateText: string; message: string }[];
}

/**
 * "New task": pick the product → AI suggests tasks from that product's data → pick one (or write your own)
 * → edit in the task form → Assign & send. If AI isn't available, show why plus a full product brief.
 */
export default function TaskComposer({ productId: fixed, people, onClose, onSaved }: { productId?: number; people: Person[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const products = useData<{ id: number; name: string; tagline: string | null; color: string | null; account_count: number; open_tasks: number }[]>(fixed ? null : '/products');
  const [productId, setProductId] = useState<number | null>(fixed ?? null);
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<'plan' | 'followup'>('plan');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Ok | Failed | null>(null);
  const [form, setForm] = useState<{ preset?: Partial<Task> } | null>(null);
  const productName = fixed ? undefined : products.data?.find((p) => p.id === productId)?.name;

  async function suggest(refresh = false) {
    if (!productId) return;
    setBusy(true);
    try {
      setRes(await api.post<Ok | Failed>(`/products/${productId}/ai/suggest`, { goal: goal || undefined, mode, refresh, count: 5 }));
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  useEffect(() => { if (productId) { setRes(null); suggest(); } }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (form && productId) {
    return <TaskForm productId={productId} people={people} preset={form.preset} onClose={() => setForm(null)} onSaved={() => { setForm(null); onSaved(); }} />;
  }

  /* Step 1: choose product */
  if (!productId) {
    return (
      <Modal title="New task — which product?" onClose={onClose}>
        {!products.data ? <p className="muted">Loading…</p> : products.data.length === 0 ? <p className="muted">Create a product first.</p> : (
          <div className="stack" style={{ gap: 8 }}>
            {products.data.map((p) => (
              <button key={p.id} className="panel panel-pad task-btn row" style={{ justifyContent: 'space-between', borderLeft: `4px solid ${p.color || '#172133'}` }} onClick={() => setProductId(p.id)}>
                <span style={{ textAlign: 'left' }}><b>{p.name}</b>{p.tagline && <span className="muted" style={{ display: 'block', fontSize: 13 }}>{p.tagline}</span>}</span>
                <span className="row" style={{ gap: 6 }}>
                  {p.account_count === 0 && <span className="badge badge-warn">No accounts yet</span>}
                  <span className="badge">{p.open_tasks} open</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    );
  }

  /* Step 2: suggestions */
  const title = `New task${productName ? ` — ${productName}` : ''}`;
  return (
    <Modal title={title} onClose={onClose} wide footer={
      <>
        {!fixed && <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={() => { setProductId(null); setRes(null); }}>Change product</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => setForm({})}><PenLine size={15} /> Write my own task</button>
      </>
    }>
      <div className="stack" style={{ gap: 14 }}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); suggest(true); }} style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="cg">Goal for the AI (optional)</label>
            <input id="cg" className="input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. More YouTube subscribers before exam season" />
          </div>
          <div className="seg" role="group" aria-label="Focus">
            <button type="button" className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>Next 2 weeks</button>
            <button type="button" className={mode === 'followup' ? 'on' : ''} onClick={() => setMode('followup')}>Follow-ups</button>
          </div>
          <button className="btn" disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''} /> {res ? 'Suggest again' : 'Suggest'}</button>
        </form>

        {busy && !res && (
          <div className="panel-pad" style={{ background: '#f6f8fa', borderRadius: 10, textAlign: 'center' }}>
            <span className="spinner" /><p className="muted" style={{ marginTop: 8 }}>Reading this product's accounts, tasks and posts and preparing suggestions…</p>
          </div>
        )}

        {res && res.ok && (
          <>
            <div className="notice info"><Sparkles /><span>{res.summary || 'Suggestions based on this product\'s data.'} <span className="faint">({res.providerLabel}{res.cached ? ', saved from earlier' : ''})</span></span></div>
            {res.gaps.length > 0 && (
              <details><summary className="muted" style={{ cursor: 'pointer' }}>{res.gaps.length} gaps found in the data</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{res.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></details>
            )}
            <div className="stack" style={{ gap: 10, opacity: busy ? 0.5 : 1 }}>
              {res.tasks.map((s, i) => (
                <div key={i} className="panel task" style={{ ['--prio' as string]: PRIORITY[s.priority]?.color, boxShadow: 'none', border: '1px solid var(--line)' }}>
                  <div className="task-head">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ fontSize: 15.5 }}>{s.title}</h3>
                      <div className="task-meta">
                        <span className="badge">{s.kind === 'post' ? 'Social post' : 'Task'}</span>
                        {s.priority !== 'normal' && <span className={`badge ${PRIORITY[s.priority].badge}`}>{PRIORITY[s.priority].label}</span>}
                        <span className="badge"><CalendarClock size={12} /> Due {prettyDate(s.due_date, { day: 'numeric', month: 'short' })}</span>
                        {s.platforms.map((p) => <PlatformChip key={p} id={p} small />)}
                      </div>
                      {s.description && <p style={{ marginTop: 6 }}>{s.description}</p>}
                      {s.reason && <p className="faint" style={{ fontSize: 13, marginTop: 4 }}>Why: {s.reason}</p>}
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => setForm({ preset: { ...s, ai_generated: true, ai_reason: s.reason } as Partial<Task> })}>Use this</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {res && !res.ok && <Unavailable r={res} onWrite={() => setForm({})} />}
      </div>
    </Modal>
  );
}

function Unavailable({ r, onWrite }: { r: Failed; onWrite: () => void }) {
  const toast = useToast();
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="notice">
        <AlertTriangle />
        <div>
          <b>AI suggestions aren't available right now.</b> {r.reason}
          {r.failures.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {r.failures.map((f) => <li key={f.provider}><b>{f.label}</b>: {f.stateText}{f.message ? ` — ${f.message}` : ''}</li>)}
            </ul>
          )}
          <div style={{ marginTop: 6 }}>Check or replace the keys in <Link to="/settings">Settings → AI providers</Link>. Meanwhile, here is everything known about this product so you can plan the task yourself.</div>
        </div>
      </div>
      <div>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <b>Product brief</b>
          <div className="row">
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(r.brief).then(() => toast('Brief copied — paste it into any AI chat or a document'), () => toast('Select the text and copy it instead', true))}><Copy size={14} /> Copy brief</button>
            <button className="btn btn-sm btn-primary" onClick={onWrite}><PenLine size={14} /> Write task</button>
          </div>
        </div>
        <textarea className="input" readOnly value={r.brief} rows={16} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, lineHeight: 1.5 }} aria-label="Product brief" />
      </div>
    </div>
  );
}
