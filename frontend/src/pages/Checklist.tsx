import { useState, type FormEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, todayStr, shiftDate, prettyDate, prettyMonth } from '../lib';

interface Period { key: string; done: boolean; by?: string }
interface Task { id: number; title: string; scope: string | null; frequency: 'daily' | 'weekly' | 'monthly'; periods: Period[] }
interface Data { date: string; days: string[]; weekKey: string; monthKey: string; tasks: Task[] }

export default function Checklist() {
  const { can } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const { data, setData, error, loading, reload } = useData<Data>(`/checklist?date=${date}`);
  const [managing, setManaging] = useState(false);
  const today = todayStr();
  const editable = can('manager');

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;

  async function toggle(task: Task, p: Period) {
    if (!editable) return;
    const next = !p.done;
    setData((d) => d && { ...d, tasks: d.tasks.map((t) => t.id === task.id ? { ...t, periods: t.periods.map((x) => x.key === p.key ? { ...x, done: next } : x) } : t) });
    try {
      await api.post('/checklist/toggle', { task_id: task.id, period_key: p.key, done: next });
    } catch (e) {
      toast((e as Error).message, true);
      reload();
    }
  }

  const daily = data.tasks.filter((t) => t.frequency === 'daily');
  const weekly = data.tasks.filter((t) => t.frequency === 'weekly');
  const monthly = data.tasks.filter((t) => t.frequency === 'monthly');
  const dayDone = (d: string) => daily.filter((t) => t.periods.find((p) => p.key === d)?.done).length;

  const Tick = ({ task, p, label }: { task: Task; p: Period; label: string }) => (
    <button className={`tick ${p.done ? 'on' : ''}`} onClick={() => toggle(task, p)} disabled={!editable} aria-pressed={p.done} aria-label={label} title={p.done && p.by ? `Done by ${p.by}` : undefined}>
      {p.done && <Check strokeWidth={3} />}
    </button>
  );

  const List = ({ title, sub, tasks }: { title: string; sub: string; tasks: Task[] }) => (
    <div className="panel">
      <div className="panel-head"><div><h2>{title}</h2><p>{sub}</p></div><span className="badge">{tasks.filter((t) => t.periods[0]?.done).length}/{tasks.length} done</span></div>
      <div style={{ padding: '8px 20px 14px' }}>
        {tasks.map((t) => (
          <div key={t.id} className="insight" style={{ alignItems: 'center' }}>
            <Tick task={t} p={t.periods[0]} label={t.title} />
            <div style={{ flex: 1 }}>
              <div style={t.periods[0]?.done ? { color: 'var(--muted)', textDecoration: 'line-through' } : undefined}>{t.title}</div>
              {t.scope && <div className="faint" style={{ fontSize: 12.5 }}>{t.scope}</div>}
            </div>
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
          <p>The daily routine takes about 30–40 minutes. Tick each task as it is done; the team sees the same list.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-icon" onClick={() => setDate(shiftDate(date, -7))} aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="num" style={{ minWidth: 170, textAlign: 'center', fontWeight: 500 }}>Week of {prettyDate(data.days[0], { day: 'numeric', month: 'short' })}</span>
          <button className="btn btn-icon" onClick={() => setDate(shiftDate(date, 7))} disabled={data.days[6] >= today} aria-label="Next week"><ChevronRight size={18} /></button>
          {editable && <button className="btn" onClick={() => setManaging(true)}>Edit tasks</button>}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
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
              {daily.map((t) => (
                <tr key={t.id}>
                  <td style={{ minWidth: 240 }}>{t.title}{t.scope && <div className="faint" style={{ fontSize: 12.5 }}>{t.scope}</div>}</td>
                  {t.periods.map((p) => (
                    <td key={p.key} className={`c ${p.key === today ? 'is-today' : ''}`}>
                      {p.key <= today ? <Tick task={t} p={p} label={`${t.title} on ${prettyDate(p.key)}`} /> : <span className="faint">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid cols-2">
        <List title="This week" sub={data.weekKey.replace('-W', ', week ')} tasks={weekly} />
        <List title="This month" sub={prettyMonth(data.monthKey)} tasks={monthly} />
      </div>
      {managing && <ManageTasks tasks={data.tasks} onClose={() => { setManaging(false); reload(); }} />}
    </>
  );
}

function ManageTasks({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const toast = useToast();
  const [list, setList] = useState(tasks);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const t = await api.post<Task>('/checklist/tasks', { title, scope, frequency });
      setList((l) => [...l, { ...t, periods: [] }]);
      setTitle(''); setScope('');
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
        <div className="field" style={{ flex: 1, minWidth: 130 }}><label htmlFor="ts">Where</label><input id="ts" className="input" value={scope} onChange={(e) => setScope(e.target.value)} /></div>
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
