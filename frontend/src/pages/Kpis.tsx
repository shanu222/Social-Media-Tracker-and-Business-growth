import { useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, fmt, todayStr, shiftMonth, prettyMonth } from '../lib';

interface Kpi { id: number; name: string; category: string; unit: string | null; aggregation: string; higher_is_better: boolean; value: number | null; previous: number | null; target: number | null; comment: string | null; status: 'on' | 'off' | null }

export default function Kpis() {
  const { can } = useAuth();
  const toast = useToast();
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const { data, error, loading, reload } = useData<{ month: string; rows: Kpi[] }>(`/metrics/month?month=${month}`);
  const [edit, setEdit] = useState<Record<number, { target: string; comment: string }>>({});
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);
  const editable = can('admin');
  const cur = todayStr().slice(0, 7);

  useEffect(() => {
    if (data) setEdit(Object.fromEntries(data.rows.map((r) => [r.id, { target: r.target === null ? '' : String(r.target), comment: r.comment || '' }])));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;

  async function save() {
    setSaving(true);
    try {
      await api.put('/metrics/targets', {
        month,
        targets: data!.rows.map((r) => ({ metric_id: r.id, target: edit[r.id]?.target === '' ? null : Number(edit[r.id]?.target), comment: edit[r.id]?.comment || null })),
      });
      toast('Targets saved');
      reload();
    } catch (e) { toast((e as Error).message, true); } finally { setSaving(false); }
  }

  const onTrack = data.rows.filter((r) => r.status === 'on').length;
  const withTarget = data.rows.filter((r) => r.status !== null).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Targets & KPIs</h1>
          <p>Monthly targets. Actuals fill in from daily updates.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
          <span style={{ minWidth: 130, textAlign: 'center', fontWeight: 500 }}>{prettyMonth(month)}</span>
          <button className="btn btn-icon" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= cur} aria-label="Next month"><ChevronRight size={18} /></button>
          {editable && <button className="btn" onClick={() => setManaging(true)}>Edit metrics</button>}
          {editable && <button className="btn btn-primary" onClick={save} disabled={saving}><Save /> {saving ? 'Saving…' : 'Save targets'}</button>}
        </div>
      </div>
      {withTarget > 0 && (
        <div className="notice info" style={{ marginBottom: 16 }}>
          <span><b>{onTrack} of {withTarget}</b> metrics with a target are on track for {prettyMonth(month)}.</span>
        </div>
      )}
      <div className="panel">
        <div className="table-wrap" style={{ padding: 8 }}>
          <table className="t">
            <thead><tr><th>Metric</th><th className="r">Target</th><th className="r">Actual</th><th className="r">Last month</th><th>Status</th><th>Comment</th></tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const pctOf = r.target ? Math.min(100, ((r.value ?? 0) / r.target) * 100) : null;
                return (
                  <tr key={r.id}>
                    <td style={{ minWidth: 200 }}>{r.name}<div className="faint" style={{ fontSize: 12.5 }}>{r.category}{r.unit ? ` · ${r.unit}` : ''}{!r.higher_is_better ? ' · lower is better' : ''}</div></td>
                    <td className="r" style={{ width: 120 }}>
                      <input className="input input-num" inputMode="decimal" aria-label={`${r.name} target`} disabled={!editable} value={edit[r.id]?.target ?? ''} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setEdit((x) => ({ ...x, [r.id]: { ...x[r.id], target: e.target.value } }))} />
                    </td>
                    <td className="r num" style={{ minWidth: 110 }}>
                      <b>{fmt(r.value, 1)}</b>
                      {pctOf !== null && r.higher_is_better && <div style={{ height: 4, background: 'var(--line-2)', borderRadius: 3, marginTop: 5 }}><div style={{ width: `${pctOf}%`, height: '100%', borderRadius: 3, background: r.status === 'on' ? 'var(--growth)' : 'var(--amber)' }} /></div>}
                    </td>
                    <td className="r num muted">{fmt(r.previous, 1)}</td>
                    <td>{r.status === 'on' ? <span className="badge badge-good">On track</span> : r.status === 'off' ? <span className="badge badge-warn">Off track</span> : <span className="faint">—</span>}</td>
                    <td style={{ minWidth: 200 }}><input className="input" aria-label={`${r.name} comment`} disabled={!editable} value={edit[r.id]?.comment ?? ''} onChange={(e) => setEdit((x) => ({ ...x, [r.id]: { ...x[r.id], comment: e.target.value } }))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {managing && <ManageMetrics rows={data.rows} onClose={() => { setManaging(false); reload(); }} />}
    </>
  );
}

function ManageMetrics({ rows, onClose }: { rows: Kpi[]; onClose: () => void }) {
  const toast = useToast();
  const [list, setList] = useState(rows);
  const [f, setF] = useState({ name: '', category: 'Business', unit: '', aggregation: 'sum', higher_is_better: true });

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const m = await api.post<Kpi>('/metrics', f);
      setList((l) => [...l, m]);
      setF({ ...f, name: '', unit: '' });
      toast('Metric added');
    } catch (err) { toast((err as Error).message, true); }
  }
  async function remove(m: Kpi) {
    if (!window.confirm(`Remove "${m.name}"? Logged values are kept.`)) return;
    await api.del(`/metrics/${m.id}`).catch((e) => toast(e.message, true));
    setList((l) => l.filter((x) => x.id !== m.id));
  }

  return (
    <Modal title="Edit metrics" onClose={onClose} wide footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <form onSubmit={add} className="form-grid" style={{ marginBottom: 18 }}>
        <div className="field"><label htmlFor="mn">Name</label><input id="mn" className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Fiverr orders" /></div>
        <div className="field"><label htmlFor="mc">Group</label><input id="mc" className="input" required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
        <div className="field"><label htmlFor="mu">Unit (optional)</label><input id="mu" className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="PKR, USD, hours…" /></div>
        <div className="field"><label htmlFor="ma">Monthly value is</label>
          <select id="ma" className="input" value={f.aggregation} onChange={(e) => setF({ ...f, aggregation: e.target.value })}>
            <option value="sum">Sum of daily entries</option><option value="last">Latest entry (running total)</option><option value="avg">Average of entries</option>
          </select>
        </div>
        <label className="check"><input type="checkbox" checked={!f.higher_is_better} onChange={(e) => setF({ ...f, higher_is_better: !e.target.checked })} /> Lower is better (costs, issues)</label>
        <div style={{ textAlign: 'right' }}><button className="btn btn-primary"><Plus /> Add metric</button></div>
      </form>
      <table className="t"><tbody>
        {list.map((m) => (
          <tr key={m.id}>
            <td>{m.name}<div className="faint" style={{ fontSize: 12.5 }}>{m.category}{m.unit ? ` · ${m.unit}` : ''}</div></td>
            <td className="muted">{m.aggregation === 'sum' ? 'Sum' : m.aggregation === 'last' ? 'Latest' : 'Average'}</td>
            <td className="r"><button className="btn btn-ghost btn-icon btn-danger" onClick={() => remove(m)} aria-label={`Remove ${m.name}`}><Trash2 size={16} /></button></td>
          </tr>
        ))}
      </tbody></table>
    </Modal>
  );
}
