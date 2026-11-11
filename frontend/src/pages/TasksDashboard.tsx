import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useData, Loading, ErrorBox } from '../lib';
import type { ProductRow } from './Products';
import { TaskCard, type Task } from './product/Tasks';
import { Progress } from './product/shared';

interface Data {
  stats: { pending: number; in_progress: number; overdue: number; due_soon: number; done_month: number; drafts: number };
  team: { id: number; name: string; role: string; open: number; in_progress: number; overdue: number; done_30d: number; avg_progress: number; on_time_30d: number }[];
  tasks: Task[];
}

/** Admin control centre: all tasks across all products and every person's progress. */
export default function TasksDashboard() {
  const nav = useNavigate();
  const [status, setStatus] = useState('open');
  const [product, setProduct] = useState('');
  const [person, setPerson] = useState('');
  const qs = new URLSearchParams({ ...(status !== 'open' && { status }), ...(product && { product_id: product }), ...(person && { assigned_to: person }) });
  const { data, error, loading, reload } = useData<Data>(`/tasks/all?${qs}`);
  const products = useData<ProductRow[]>('/products');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;
  const s = data.stats;
  const tasks = status === 'open' ? data.tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress') : data.tasks;
  const tile = (key: string, label: string, value: number, tone = '') => (
    <button className={`panel kpi ${status === key ? 'kpi-on' : ''}`} style={{ textAlign: 'left', border: 0, cursor: 'pointer' }} onClick={() => setStatus(status === key ? 'open' : key)} aria-pressed={status === key}>
      <div className="k">{label}</div><div className={`v ${tone}`}>{value}</div>
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div><h1>Tasks</h1><p>Every task across all products. Select a tile to filter; open a task to see its full history.</p></div>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        {tile('todo', 'Not started', s.pending)}
        {tile('in_progress', 'In progress', s.in_progress)}
        {tile('overdue', 'Overdue', s.overdue, s.overdue ? 'down' : '')}
        {tile('done', 'Completed this month', s.done_month, 'up')}
        {tile('draft', 'Drafts to review', s.drafts)}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head"><div><h2>Team progress</h2><p>Open work, average completion and on-time delivery in the last 30 days.</p></div></div>
        <div className="table-wrap" style={{ padding: 8 }}>
          <table className="t">
            <thead><tr><th>Person</th><th className="r">Open</th><th className="r">In progress</th><th className="r">Overdue</th><th>Avg. completion</th><th className="r">Done (30 d)</th><th className="r">On time</th></tr></thead>
            <tbody>{data.team.map((m) => (
              <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setPerson(person === String(m.id) ? '' : String(m.id))}>
                <td><b>{m.name}</b>{person === String(m.id) && <span className="badge badge-info" style={{ marginLeft: 6 }}>Filtered</span>}<div className="faint" style={{ fontSize: 12 }}>{m.role === 'admin' ? 'Admin' : 'Social media manager'}</div></td>
                <td className="r num">{m.open}</td>
                <td className="r num">{m.in_progress}</td>
                <td className={`r num ${m.overdue ? 'down' : ''}`}>{m.overdue}</td>
                <td style={{ minWidth: 150 }}>{m.open ? <Progress value={Number(m.avg_progress)} small /> : <span className="faint">—</span>}</td>
                <td className="r num">{m.done_30d}</td>
                <td className="r num">{m.done_30d ? `${Math.round((m.on_time_30d / m.done_30d) * 100)}%` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <div className="row">
          <select className="input" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="open">Open</option><option value="todo">Not started</option><option value="in_progress">In progress</option><option value="overdue">Overdue</option>
            <option value="done">Completed</option><option value="draft">Drafts</option><option value="all">Everything</option>
          </select>
          <select className="input" style={{ width: 180 }} value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Product">
            <option value="">All products</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input" style={{ width: 180 }} value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
            <option value="">Everyone</option><option value="none">Unassigned</option>{data.team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <span className="muted">{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
      </div>
      {s.drafts > 0 && status !== 'draft' && (
        <button className="notice info" style={{ width: '100%', marginBottom: 12, border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setStatus('draft')}>
          <Sparkles /><span><b>{s.drafts} draft{s.drafts > 1 ? 's' : ''}</b> waiting for review.</span>
        </button>
      )}
      {tasks.length === 0 ? <div className="panel empty"><h3>No tasks match</h3><p>Create tasks from a product's Tasks tab, or let AI suggest some.</p></div>
        : tasks.map((t) => <TaskCard key={t.id} t={t} showProduct onOpen={(x) => nav(`/products/${x.product_id}?tab=tasks&task=${x.id}`)} />)}
    </>
  );
}
