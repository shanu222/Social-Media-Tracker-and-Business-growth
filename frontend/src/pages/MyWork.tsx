import { UpcomingStrip } from './Messages';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { useAuth, useData, Loading, ErrorBox, todayStr, shiftDate, prettyDate } from '../lib';
import type { ProductRow } from './Products';
import { TaskCard, isOverdue, type Task } from './product/Tasks';

/** Personal workspace: new, in progress, upcoming, overdue and completed — or grouped by product. */
export default function MyWork() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [view, setView] = useState<'status' | 'product'>('status');
  const products = useData<ProductRow[]>('/products');
  const tasks = useData<Task[]>('/tasks/mine');
  if ((products.loading && !products.data) || (tasks.loading && !tasks.data)) return <Loading />;
  if (products.error || tasks.error) return <ErrorBox error={products.error || tasks.error || ''} retry={() => { products.reload(); tasks.reload(); }} />;

  const today = todayStr();
  const week = shiftDate(today, 7);
  const list = tasks.data || [];
  const open = list.filter((t) => t.status === 'todo' || t.status === 'in_progress');
  const used = new Set<number>();
  const take = (fn: (t: Task) => boolean) => open.filter((t) => !used.has(t.id) && fn(t)).map((t) => (used.add(t.id), t));
  const statusGroups = [
    { key: 'overdue', title: 'Overdue', tone: 'badge-bad', items: take(isOverdue) },
    { key: 'new', title: 'New', tone: 'badge-good', items: take((t) => t.status === 'todo' && t.assigned_to === user?.id && !t.seen_at) },
    { key: 'upcoming', title: 'Due in the next 7 days', tone: 'badge-warn', items: take((t) => !!t.due_date && t.due_date <= week) },
    { key: 'progress', title: 'In progress', tone: 'badge-info', items: take((t) => t.status === 'in_progress') },
    { key: 'later', title: 'Not started', tone: '', items: take(() => true) },
    { key: 'done', title: 'Completed (last 30 days)', tone: 'badge-good', items: list.filter((t) => t.status === 'done') },
  ].filter((g) => g.items.length);
  const productGroups = (products.data || []).map((p) => ({ key: String(p.id), title: p.name, tone: '', items: list.filter((t) => t.product_id === p.id) })).filter((g) => g.items.length);
  const groups = view === 'status' ? statusGroups : productGroups;
  const unread = (products.data || []).reduce((s, p) => s + p.unread, 0);
  const openTask = (t: Task) => nav(`/products/${t.product_id}?tab=tasks&task=${t.id}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hi {user?.name.split(' ')[0]}, here's your work</h1>
          <p>{prettyDate(today, { weekday: 'long', day: 'numeric', month: 'long' })} · {open.length} open task{open.length === 1 ? '' : 's'}{statusGroups.find((g) => g.key === 'overdue') ? `, ${statusGroups.find((g) => g.key === 'overdue')!.items.length} overdue` : ''}{unread ? ` · ${unread} unread message${unread === 1 ? '' : 's'}` : ''}</p>
        </div>
        <div className="seg" role="group" aria-label="Group by">
          <button className={view === 'status' ? 'on' : ''} onClick={() => setView('status')}>By status</button>
          <button className={view === 'product' ? 'on' : ''} onClick={() => setView('product')}>By product</button>
        </div>
      </div>
      <UpcomingStrip />

      <div className="prod-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginBottom: 22 }}>
        {(products.data || []).map((p) => (
          <Link key={p.id} to={`/products/${p.id}`} className="panel panel-pad" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 6, borderTop: `4px solid ${p.color || '#0a1a3d'}` }}>
            <h3>{p.name}</h3>
            <div className="row" style={{ gap: 6 }}>
              <span className="badge badge-info">{p.open_tasks} open</span>
              {p.account_count === 0 && <span className="badge badge-warn" title="The admin hasn't added this product's social accounts yet">No accounts yet</span>}
              {p.overdue_tasks > 0 && <span className="badge badge-bad">{p.overdue_tasks} overdue</span>}
              {p.unread > 0 && <span className="badge badge-warn" onClick={(e) => { e.preventDefault(); nav(`/products/${p.id}?tab=chat`); }}><MessageSquare size={12} /> {p.unread}</span>}
            </div>
          </Link>
        ))}
        {(products.data || []).length === 0 && <div className="panel empty" style={{ gridColumn: '1 / -1' }}><h3>No products assigned yet</h3><p>Your admin will add you to the products you work on.</p></div>}
      </div>

      {groups.length === 0 ? (
        <div className="panel empty"><h3>All caught up</h3><p>No tasks right now. You'll get an email when something new is assigned.</p></div>
      ) : groups.map((g) => (
        <section key={g.key} className="queue-group">
          <h3>{g.title} <span className={`badge ${g.tone}`}>{g.items.length}</span></h3>
          {g.items.map((t) => <TaskCard key={t.id} t={t} showProduct={view === 'status'} onOpen={openTask} />)}
        </section>
      ))}
    </>
  );
}
