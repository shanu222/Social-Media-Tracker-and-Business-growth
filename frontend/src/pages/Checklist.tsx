import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Check, ChevronLeft, ChevronRight, ListPlus, Plus, Settings2, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, todayStr, shiftDate, prettyDate, prettyMonth } from '../lib';

interface Period { key: string; done: boolean; by?: string }
interface Task { id: number; title: string; scope: string | null; frequency: 'daily' | 'weekly' | 'monthly'; periods: Period[] }
interface Data { date: string; days: string[]; weekKey: string; monthKey: string; tasks: Task[] }
interface Scope { id: number | 'company'; name: string; color?: string | null; typeLabel: string; daily: number; daily_done: number; other: number; other_done: number }
interface Suggestion { key: string; title: string; frequency: string; group: string; added: boolean; removed: boolean }

const groupBy = (tasks: Task[]) => {
  const m = new Map<string, Task[]>();
  for (const t of tasks) { const g = t.scope || 'Other'; m.set(g, [...(m.get(g) || []), t]); }
  return [...m.entries()];
};

export default function Checklist() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') || 'company';
  const [date, setDate] = useState(todayStr());
  const scopes = useData<Scope[]>('/checklist/scopes');
  const { data, setData, error, loading, reload } = useData<Data>(`/checklist?date=${date}&scope=${scope}`);
  const [managing, setManaging] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const today = todayStr();
  const editable = can('manager');
  const current = scopes.data?.find((s) => String(s.id) === scope);

  const daily = useMemo(() => (data?.tasks || []).filter((t) => t.frequency === 'daily'), [data]);
  const weekly = (data?.tasks || []).filter((t) => t.frequency === 'weekly');
  const monthly = (data?.tasks || []).filter((t) => t.frequency === 'monthly');

  async function toggle(task: Task, p: Period) {
    if (!editable) return;
    const next = !p.done;
    setData((d) => d && { ...d, tasks: d.tasks.map((t) => t.id === task.id ? { ...t, periods: t.periods.map((x) => x.key === p.key ? { ...x, done: next } : x) } : t) });
    try {
      await api.post('/checklist/toggle', { task_id: task.id, period_key: p.key, done: next });
      scopes.reload();
    } catch (e) {
      toast((e as Error).message, true);
      reload();
    }
  }

  const dayDone = (d: string) => daily.filter((t) => t.periods.find((p) => p.key === d)?.done).length;

  const Tick = ({ task, p, label }: { task: Task; p: Period; label: string }) => (
    <button className={`tick ${p.done ? 'on' : ''}`} onClick={() => toggle(task, p)} disabled={!editable} aria-pressed={p.done} aria-label={label} title={p.done && p.by ? `Done by ${p.by}` : undefined}>
      {p.done && <Check strokeWidth={3} />}
    </button>
  );

  const List = ({ title, sub, tasks }: { title: string; sub: string; tasks: Task[] }) => (
    <div className="panel">
      <div className="panel-head"><div><h2>{title}</h2><p>{sub}</p></div><span className={`badge ${tasks.length && tasks.every((t) => t.periods[0]?.done) ? 'badge-good' : ''}`}>{tasks.filter((t) => t.periods[0]?.done).length}/{tasks.length} done</span></div>
      <div style={{ padding: '4px 20px 14px' }}>
        {tasks.length === 0 && <p className="muted" style={{ padding: '10px 0' }}>Nothing scheduled.</p>}
        {groupBy(tasks).map(([g, list]) => (
          <div key={g}>
            <div className="cl-group">{g}</div>
            {list.map((t) => (
              <div key={t.id} className="insight" style={{ alignItems: 'center' }}>
                <Tick task={t} p={t.periods[0]} label={t.title} />
                <div style={{ flex: 1 }}>
                  <div style={t.periods[0]?.done ? { color: 'var(--muted)', textDecoration: 'line-through' } : undefined}>{t.title}</div>
                  {t.periods[0]?.done && t.periods[0].by && <div className="faint" style={{ fontSize: 12 }}>Done by {t.periods[0].by}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Checklist</h1>
          <p>Each product's routine, built for its type and the platforms it uses.</p>
        </div>
        <div className="page-actions">
          <div className="month-nav">
            <button className="btn btn-icon" onClick={() => setDate(shiftDate(date, -7))} aria-label="Previous week"><ChevronLeft size={18} /></button>
            <span className="num">Week of {data ? prettyDate(data.days[0], { day: 'numeric', month: 'short' }) : '…'}</span>
            <button className="btn btn-icon" onClick={() => setDate(shiftDate(date, 7))} disabled={!data || data.days[6] >= today} aria-label="Next week"><ChevronRight size={18} /></button>
          </div>
        </div>
      </div>

      <div className="scope-strip" role="tablist" aria-label="Product">
        {(scopes.data || []).map((s) => {
          const pct = s.daily ? Math.round((s.daily_done / s.daily) * 100) : 0;
          return (
            <button key={s.id} role="tab" aria-selected={String(s.id) === scope} className={`scope-card ${String(s.id) === scope ? 'on' : ''}`}
              style={{ ['--sc' as string]: s.id === 'company' ? '#0a1a3d' : s.color || '#1a5fe0' }}
              onClick={() => setParams(s.id === 'company' ? {} : { scope: String(s.id) })}>
              <span className="sc-dot">{s.id === 'company' ? <Building2 size={14} /> : s.name.slice(0, 1)}</span>
              <span className="sc-t"><b>{s.name}</b><span>{s.typeLabel}</span></span>
              <span className="sc-n" title="Daily tasks done today">{s.daily ? `${s.daily_done}/${s.daily}` : '—'}<small>{s.daily ? (pct === 100 ? 'all done' : 'today') : 'no daily'}</small></span>
            </button>
          );
        })}
      </div>

      {loading && !data ? <Loading /> : error || !data ? <ErrorBox error={error || ''} retry={reload} /> : (
        <>
          <div className="kpi-bar">
            <div className="kpi-bar-l">
              <h2>{current?.name || 'Company-wide'}</h2>
              <span className="badge badge-info">{current?.typeLabel}</span>
            </div>
            {can('admin') && (
              <div className="row" style={{ gap: 8 }}>
                {scope !== 'company' && <button className="btn btn-sm" onClick={() => setSuggest(true)}><ListPlus size={14} /> Suggested routine</button>}
                <button className="btn btn-sm" onClick={() => setManaging(true)}><Settings2 size={14} /> Edit tasks</button>
              </div>
            )}
          </div>

          {daily.length > 0 && data.days.includes(today) && (
            <div className="panel cl-today" style={{ marginBottom: 16 }}>
              <div className="panel-head"><div><h2>Today</h2><p>{prettyDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div><span className="badge">{dayDone(today)}/{daily.length} done</span></div>
              <div style={{ padding: '4px 20px 14px' }}>
                {groupBy(daily).map(([g, list]) => (
                  <div key={g}>
                    <div className="cl-group">{g}</div>
                    {list.map((t) => {
                      const p = t.periods.find((x) => x.key === today)!;
                      return (
                        <div key={t.id} className="insight" style={{ alignItems: 'center' }}>
                          <Tick task={t} p={p} label={t.title} />
                          <div style={{ flex: 1, ...(p.done ? { color: 'var(--muted)', textDecoration: 'line-through' } : {}) }}>{t.title}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
          {daily.length > 0 && (
            <div className="panel cl-week" style={{ marginBottom: 16 }}>
              <div className="table-wrap" style={{ padding: 8 }}>
                <table className="t cl-grid">
                  <thead>
                    <tr>
                      <th>Daily task</th>
                      {data.days.map((d) => (
                        <th key={d} className={`c ${d === today ? 'is-today' : ''}`} style={{ textAlign: 'center' }}>
                          {prettyDate(d, { weekday: 'short' })}<div className="faint num" style={{ fontSize: 11.5 }}>{dayDone(d)}/{daily.length}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupBy(daily).map(([g, list]) => [
                      <tr key={`g-${g}`} className="cl-group-row"><td colSpan={8}>{g}</td></tr>,
                      ...list.map((t) => (
                        <tr key={t.id}>
                          <td style={{ minWidth: 260 }}>{t.title}</td>
                          {t.periods.map((p) => (
                            <td key={p.key} className={`c ${p.key === today ? 'is-today' : ''}`}>
                              {p.key <= today ? <Tick task={t} p={p} label={`${t.title} on ${prettyDate(p.key)}`} /> : <span className="faint">·</span>}
                            </td>
                          ))}
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid cols-2">
            <List title="This week" sub={data.weekKey.replace('-W', ', week ')} tasks={weekly} />
            <List title="This month" sub={prettyMonth(data.monthKey)} tasks={monthly} />
          </div>
        </>
      )}
      {managing && data && <ManageTasks scope={scope} tasks={data.tasks} onClose={() => { setManaging(false); reload(); scopes.reload(); }} />}
      {suggest && current && current.id !== 'company' && <SuggestedRoutine product={current} onClose={() => setSuggest(false)} onDone={() => { setSuggest(false); reload(); scopes.reload(); }} />}
    </>
  );
}

function SuggestedRoutine({ product, onClose, onDone }: { product: Scope; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data } = useData<Suggestion[]>(`/checklist/suggestions?scope=${product.id}`);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await api.post<{ added: number }>(`/checklist/setup?scope=${product.id}`, { scope: product.id, keys: picked });
      toast(`Added ${picked.length} task${picked.length === 1 ? '' : 's'}${r.added ? '' : ''}`);
      onDone();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  const byFreq = ['daily', 'weekly', 'monthly'].map((f) => [f, (data || []).filter((s) => s.frequency === f)] as const);
  return (
    <Modal title={`${product.name} — suggested routine`} onClose={onClose} wide footer={
      <><button className="btn" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={busy || !picked.length} onClick={save}>{busy ? 'Adding…' : `Add ${picked.length || ''} task${picked.length === 1 ? '' : 's'}`}</button></>
    }>
      {!data ? <Loading /> : (
        <div className="stack" style={{ gap: 14 }}>
          <p className="muted">Based on <b>{product.typeLabel}</b> and the platforms {product.name} has accounts on. Ticked items are already in the checklist.</p>
          {byFreq.map(([f, list]) => list.length > 0 && (
            <div key={f}>
              <div className="cl-group" style={{ paddingTop: 0 }}>{f === 'daily' ? 'Every day' : f === 'weekly' ? 'Every week' : 'Every month'}</div>
              <div className="pick-kpis">
                {list.map((s) => (
                  <label key={s.key} className={`check ${s.added ? 'faint' : ''}`}>
                    <input type="checkbox" disabled={s.added} checked={s.added || picked.includes(s.key)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.key] : p.filter((k) => k !== s.key)))} />
                    <span>{s.title}<span className="faint small"> · {s.group}{s.removed ? ' · removed earlier' : ''}</span></span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ManageTasks({ scope, tasks, onClose }: { scope: string; tasks: Task[]; onClose: () => void }) {
  const toast = useToast();
  const [list, setList] = useState(tasks);
  const [title, setTitle] = useState('');
  const [group, setGroup] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const t = await api.post<Task>(`/checklist/tasks?scope=${scope}`, { title, scope: group, frequency });
      setList((l) => [...l, { ...t, periods: [] }]);
      setTitle(''); setGroup('');
      toast('Task added');
    } catch (err) { toast((err as Error).message, true); }
  }
  async function remove(t: Task) {
    if (!window.confirm(`Remove "${t.title}"? Past ticks are kept.`)) return;
    await api.del(`/checklist/tasks/${t.id}`).catch((e) => toast(e.message, true));
    setList((l) => l.filter((x) => x.id !== t.id));
  }

  return (
    <Modal title="Edit checklist tasks" onClose={onClose} wide footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <form onSubmit={add} className="row" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 2, minWidth: 200 }}><label htmlFor="tt">New task</label><input id="tt" className="input" required value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field" style={{ flex: 1, minWidth: 130 }}><label htmlFor="ts">Group</label><input id="ts" className="input" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. Content" /></div>
        <div className="field"><label htmlFor="tf">How often</label>
          <select id="tf" className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
        </div>
        <button className="btn btn-primary"><Plus /> Add task</button>
      </form>
      <table className="t">
        <tbody>
          {list.map((t) => (
            <tr key={t.id}>
              <td>{t.title}<div className="faint" style={{ fontSize: 12.5 }}>{t.scope}</div></td>
              <td><span className="badge">{t.frequency}</span></td>
              <td className="r"><button className="btn btn-ghost btn-icon btn-danger" onClick={() => remove(t)} aria-label={`Remove ${t.title}`}><Trash2 size={16} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
