import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { useAuth, useData, Loading, ErrorBox, todayStr, shiftDate, prettyDate } from '../lib';
import type { ProductRow } from './Products';
import { TaskCard, type Task } from './product/Content';

export default function MyWork() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const products = useData<ProductRow[]>('/products');
  const tasks = useData<Task[]>('/tasks/mine');
  if ((products.loading && !products.data) || (tasks.loading && !tasks.data)) return <Loading />;
  if (products.error || tasks.error) return <ErrorBox error={products.error || tasks.error || ''} retry={() => { products.reload(); tasks.reload(); }} />;

  const today = todayStr();
  const soon = shiftDate(today, 3);
  const list = tasks.data || [];
  const groups = [
    { key: 'overdue', title: 'Overdue', items: list.filter((t) => t.due_date && t.due_date < today) },
    { key: 'today', title: 'Due today', items: list.filter((t) => t.due_date === today) },
    { key: 'soon', title: 'Next 3 days', items: list.filter((t) => t.due_date && t.due_date > today && t.due_date <= soon) },
    { key: 'later', title: 'Later or no deadline', items: list.filter((t) => !t.due_date || t.due_date > soon) },
  ].filter((g) => g.items.length);
  const unread = (products.data || []).reduce((s, p) => s + p.unread, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{can('admin') ? 'Content queue' : `Hi ${user?.name.split(' ')[0]}, here's your work`}</h1>
          <p>{prettyDate(today, { weekday: 'long', day: 'numeric', month: 'long' })} · {list.length} {list.length === 1 ? 'item' : 'items'} waiting to be posted{unread ? ` · ${unread} unread ${unread === 1 ? 'message' : 'messages'}` : ''}</p>
        </div>
      </div>

      <div className="prod-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginBottom: 22 }}>
        {(products.data || []).map((p) => (
          <Link key={p.id} to={`/products/${p.id}`} className="panel panel-pad" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 6, borderTop: `4px solid ${p.color || '#172133'}` }}>
            <h3>{p.name}</h3>
            <div className="row" style={{ gap: 6 }}>
              <span className="badge badge-info">{p.open_tasks} to post</span>
              {p.overdue_tasks > 0 && <span className="badge badge-bad">{p.overdue_tasks} overdue</span>}
              {p.unread > 0 && <span className="badge badge-warn" onClick={(e) => { e.preventDefault(); nav(`/products/${p.id}?tab=chat`); }}><MessageSquare size={12} /> {p.unread}</span>}
            </div>
          </Link>
        ))}
        {(products.data || []).length === 0 && <div className="panel empty" style={{ gridColumn: '1 / -1' }}><h3>No products assigned yet</h3><p>Your admin will add you to the products you manage.</p></div>}
      </div>

      {groups.length === 0 ? (
        <div className="panel empty"><h3>All caught up</h3><p>Nothing is waiting to be posted. Record anything you posted on your own under a product's Published tab.</p></div>
      ) : groups.map((g) => (
        <section key={g.key} className="queue-group">
          <h3>{g.title} <span className={`badge ${g.key === 'overdue' ? 'badge-bad' : ''}`}>{g.items.length}</span></h3>
          {g.items.map((t) => (
            <TaskCard key={t.id} t={t} members={[]} accounts={[]} showProduct onChanged={tasks.reload}
              onChat={(x) => nav(`/products/${x.product_id}?tab=chat`)} />
          ))}
        </section>
      ))}
    </>
  );
}
