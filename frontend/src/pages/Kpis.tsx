import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, ChevronLeft, ChevronRight, Plus, RefreshCw, Save, Settings2, Trash2, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal, fmt, todayStr, shiftMonth, prettyMonth } from '../lib';

interface Kpi {
  id: number; name: string; category: string; unit: string | null; aggregation: string; higher_is_better: boolean; source: string; auto?: boolean;
  value: number | null; previous: number | null; target: number | null; comment: string | null; status: 'on' | 'off' | null;
}
interface Scope { id: number | 'company'; name: string; color?: string | null; category: string | null; typeLabel: string; metrics: number; targets: number }
interface PType { id: string; label: string; hint: string; metrics: { name: string; category: string; unit: string | null; aggregation: string; higher_is_better: boolean }[] }

const unitText = (u: string | null, v: string) => (!u ? v : u === '%' ? `${v}%` : u === 'PKR' || u === 'USD' ? `${u} ${v}` : `${v} ${u}`);

export default function Kpis() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const scopes = useData<Scope[]>('/metrics/scopes');
  const scope = params.get('scope') || 'company';
  const { data, error, loading, reload } = useData<{ month: string; rows: Kpi[] }>(`/metrics/month?month=${month}&scope=${scope}`);
  const [edit, setEdit] = useState<Record<number, { target: string; comment: string }>>({});
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);
  const [setup, setSetup] = useState(false);
  const editable = can('admin');
  const cur = todayStr().slice(0, 7);
  const current = scopes.data?.find((s) => String(s.id) === scope);

  useEffect(() => {
    if (data) setEdit(Object.fromEntries(data.rows.map((r) => [r.id, { target: r.target === null ? '' : String(r.target), comment: r.comment || '' }])));
  }, [data]);

  const groups = useMemo(() => {
    const rows = data?.rows || [];
    const order = [...new Set(rows.map((r) => r.category))].sort((a, b) => (a === 'Social media' ? 1 : b === 'Social media' ? -1 : 0));
    return order.map((g) => ({ name: g, rows: rows.filter((r) => r.category === g) }));
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      await api.put('/metrics/targets', {
        month,
        targets: data!.rows.map((r) => ({ metric_id: r.id, target: edit[r.id]?.target === '' ? null : Number(edit[r.id]?.target), comment: edit[r.id]?.comment || null })),
      });
      toast('Targets saved');
      reload(); scopes.reload();
    } catch (e) { toast((e as Error).message, true); } finally { setSaving(false); }
  }
  const dirty = data?.rows.some((r) => (edit[r.id]?.target ?? '') !== (r.target === null ? '' : String(r.target)) || (edit[r.id]?.comment ?? '') !== (r.comment || ''));
  const withTarget = data?.rows.filter((r) => r.status !== null) || [];
  const onTrack = withTarget.filter((r) => r.status === 'on').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Targets & KPIs</h1>
          <p>Each product has its own KPIs. Social numbers fill in from its accounts.</p>
        </div>
        <div className="page-actions">
          <div className="month-nav">
            <button className="btn btn-icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
            <span>{prettyMonth(month)}</span>
            <button className="btn btn-icon" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= cur} aria-label="Next month"><ChevronRight size={18} /></button>
          </div>
          {editable && <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}><Save /> {saving ? 'Saving…' : 'Save targets'}</button>}
        </div>
      </div>

      <div className="scope-strip" role="tablist" aria-label="Product">
        {(scopes.data || []).map((s) => (
          <button key={s.id} role="tab" aria-selected={String(s.id) === scope} className={`scope-card ${String(s.id) === scope ? 'on' : ''}`}
            style={{ ['--sc' as string]: s.id === 'company' ? '#0a1a3d' : s.color || '#1a5fe0' }}
            onClick={() => setParams(s.id === 'company' ? {} : { scope: String(s.id) })}>
            <span className="sc-dot">{s.id === 'company' ? <Building2 size={14} /> : s.name.slice(0, 1)}</span>
            <span className="sc-t"><b>{s.name}</b><span>{s.typeLabel}</span></span>
            <span className="sc-n">{s.targets}/{s.metrics}<small>targets</small></span>
          </button>
        ))}
      </div>

      {loading && !data ? <Loading /> : error || !data ? <ErrorBox error={error || ''} retry={reload} /> : (
        <>
          <div className="kpi-bar">
            <div className="kpi-bar-l">
              <h2>{current?.name || 'Company-wide'}</h2>
              <span className="badge badge-info">{current?.typeLabel}</span>
              {withTarget.length > 0 && (
                <span className="track-sum">
                  <span className="mbar" style={{ width: 120 }}><i style={{ width: `${(onTrack / withTarget.length) * 100}%`, background: '#16b97a' }} /></span>
                  <b>{onTrack} of {withTarget.length}</b> on track
                </span>
              )}
            </div>
            {editable && (
              <div className="row" style={{ gap: 8 }}>
                {scope !== 'company' && <button className="btn btn-sm" onClick={() => setSetup(true)}><RefreshCw size={14} /> Product type & suggested KPIs</button>}
                <button className="btn btn-sm" onClick={() => setManaging(true)}><Settings2 size={14} /> Edit metrics</button>
              </div>
            )}
          </div>

          {data.rows.length === 0 ? (
            <div className="panel empty">
              <h3>No KPIs for this product yet</h3>
              <p>Pick the type of product and choose from the suggested KPIs.</p>
              {editable && <button className="btn btn-primary" onClick={() => setSetup(true)}><Plus /> Set up KPIs</button>}
            </div>
          ) : (
            <div className="kpi-groups">
              {[groups.filter((g) => g.name !== 'Social media'), groups.filter((g) => g.name === 'Social media')].filter((set) => set.length).map((set, si) => (
                <section key={si} className="panel kpi-group">
                  <div className="kpi-group-h">
                    <h3>{set[0].name === 'Social media' ? 'Social media' : 'Business KPIs'}</h3>
                    {set[0].name === 'Social media' ? <span className="auto-tag"><Zap size={12} /> Automatic from {current?.id === 'company' ? 'accounts' : `${current?.name}'s accounts`}</span> : <span className="faint small">Entered in Daily update</span>}
                  </div>
                  <div className="kpi-head" aria-hidden="true"><span>Metric</span><span>Target</span><span>Actual</span><span>Last month</span><span>Note</span></div>
                  {set.map((g) => (
                  <div key={g.name}>
                  {set[0].name !== 'Social media' && <div className="kpi-sub">{g.name}</div>}
                  {g.rows.map((r) => {
                    const t = r.target;
                    const pct = t ? (r.higher_is_better ? ((r.value ?? 0) / t) * 100 : r.value === null ? 0 : r.value <= t ? 100 : (t / r.value) * 100) : null;
                    const d = r.value !== null && r.previous !== null ? r.value - r.previous : null;
                    const good = d === null || d === 0 ? '' : (d > 0) === r.higher_is_better ? 'up' : 'down';
                    return (
                      <div key={r.id} className="kpi-row">
                        <div className="k-name">
                          <b>{r.name}</b>
                          <span className="faint">{r.auto ? 'From accounts' : r.aggregation === 'last' ? 'Latest value' : r.aggregation === 'avg' ? 'Monthly average' : 'Monthly total'}{r.unit ? ` · ${r.unit}` : ''}{!r.higher_is_better ? ' · lower is better' : ''}</span>
                        </div>
                        <div className="k-target">
                          <label className="sr-only" htmlFor={`t${r.id}`}>{r.name} target</label>
                          <input id={`t${r.id}`} className="input input-num" inputMode="decimal" placeholder="Set" disabled={!editable} value={edit[r.id]?.target ?? ''} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setEdit((x) => ({ ...x, [r.id]: { ...x[r.id], target: e.target.value } }))} />
                        </div>
                        <div className="k-actual">
                          <span className="v num">{r.value === null ? '—' : unitText(r.unit, fmt(r.value, 1))}</span>
                          {pct !== null && (
                            <>
                              <span className={`gbar ${r.status === 'on' ? 'done' : ''}`}><i style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} /></span>
                              <span className={`small ${r.status === 'on' ? 'up' : 'faint'}`}>{r.status === 'on' ? 'On track' : `${Math.round(pct)}% of target`}</span>
                            </>
                          )}
                        </div>
                        <div className="k-prev">
                          <span className="num muted">{r.previous === null ? '—' : unitText(r.unit, fmt(r.previous, 1))}</span>
                          {d !== null && d !== 0 && <span className={`chg ${good}`}>{d > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{d > 0 ? '+' : ''}{fmt(Math.round(d * 10) / 10, 1)}</span>}
                        </div>
                        <div className="k-note">
                          <label className="sr-only" htmlFor={`c${r.id}`}>{r.name} note</label>
                          <input id={`c${r.id}`} className="input" placeholder={editable ? 'Add a note' : ''} disabled={!editable} value={edit[r.id]?.comment ?? ''} onChange={(e) => setEdit((x) => ({ ...x, [r.id]: { ...x[r.id], comment: e.target.value } }))} />
                        </div>
                      </div>
                    );
                  })}
                  </div>
                  ))}
                </section>
              ))}
              <p className="faint small">Numbers entered by hand come from <Link to={`/update?tab=business${scope !== 'company' ? `&bscope=${scope}` : ''}`}>Daily update → Business numbers</Link>.</p>
            </div>
          )}
        </>
      )}
      {managing && data && <ManageMetrics scope={scope} rows={data.rows} onClose={() => { setManaging(false); reload(); scopes.reload(); }} />}
      {setup && current && current.id !== 'company' && <SetupKpis product={current} existing={data?.rows || []} onClose={() => setSetup(false)} onDone={() => { setSetup(false); reload(); scopes.reload(); }} />}
    </>
  );
}

function SetupKpis({ product, existing, onClose, onDone }: { product: Scope; existing: Kpi[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const types = useData<PType[]>('/metrics/types');
  const [type, setType] = useState(product.category || 'other');
  const t = types.data?.find((x) => x.id === type);
  const have = new Set(existing.map((m) => m.name.toLowerCase()));
  const [picked, setPicked] = useState<string[] | null>(null);
  useEffect(() => { if (t) setPicked(t.metrics.filter((m) => !have.has(m.name.toLowerCase())).map((m) => m.name)); }, [type, types.data]);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await api.post<{ count: number }>('/metrics/setup', { product_id: product.id, type, names: picked || [] });
      toast(`${product.name}: KPIs updated (${r.count})`);
      onDone();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <Modal title={`${product.name} — product type & KPIs`} onClose={onClose} wide footer={
      <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy || !t}>{busy ? 'Saving…' : picked?.length ? `Add ${picked.length} KPI${picked.length === 1 ? '' : 's'}` : 'Save type'}</button></>
    }>
      {!types.data ? <Loading /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="type-grid" role="radiogroup" aria-label="Product type">
            {types.data.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={type === x.id} className={type === x.id ? 'on' : ''} onClick={() => setType(x.id)}>
                <b>{x.label}</b><span>{x.hint}</span>
              </button>
            ))}
          </div>
          {t && (
            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><b>Suggested KPIs for {t.label.toLowerCase()}</b><span className="faint small">Social media KPIs are always included</span></div>
              <div className="pick-kpis">
                {t.metrics.map((m) => {
                  const exists = have.has(m.name.toLowerCase());
                  return (
                    <label key={m.name} className={`check ${exists ? 'faint' : ''}`}>
                      <input type="checkbox" disabled={exists} checked={exists || (picked || []).includes(m.name)} onChange={(e) => setPicked((p) => (e.target.checked ? [...(p || []), m.name] : (p || []).filter((n) => n !== m.name)))} />
                      <span>{m.name}<span className="faint small"> · {m.category}{m.unit ? ` · ${m.unit}` : ''}{exists ? ' · already added' : ''}</span></span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ManageMetrics({ scope, rows, onClose }: { scope: string; rows: Kpi[]; onClose: () => void }) {
  const toast = useToast();
  const [list, setList] = useState(rows);
  const [f, setF] = useState({ name: '', category: 'Business', unit: '', aggregation: 'sum', higher_is_better: true });

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const m = await api.post<Kpi>('/metrics', { ...f, scope });
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
        <div className="field"><label htmlFor="mu">Unit (optional)</label><input id="mu" className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="PKR, USD, %, hours…" /></div>
        <div className="field"><label htmlFor="ma">Monthly value is</label>
          <select id="ma" className="input" value={f.aggregation} onChange={(e) => setF({ ...f, aggregation: e.target.value })}>
            <option value="sum">Total of daily entries</option><option value="last">Latest entry (running total)</option><option value="avg">Average of entries</option>
          </select>
        </div>
        <label className="check"><input type="checkbox" checked={!f.higher_is_better} onChange={(e) => setF({ ...f, higher_is_better: !e.target.checked })} /> Lower is better (costs, issues)</label>
        <div style={{ textAlign: 'right' }}><button className="btn btn-primary"><Plus /> Add metric</button></div>
      </form>
      <table className="t"><tbody>
        {list.map((m) => (
          <tr key={m.id}>
            <td>{m.name}<div className="faint" style={{ fontSize: 12.5 }}>{m.category}{m.unit ? ` · ${m.unit}` : ''}</div></td>
            <td className="muted">{m.source && m.source !== 'manual' ? 'Automatic' : m.aggregation === 'sum' ? 'Total' : m.aggregation === 'last' ? 'Latest' : 'Average'}</td>
            <td className="r"><button className="btn btn-ghost btn-icon btn-danger" onClick={() => remove(m)} aria-label={`Remove ${m.name}`}><Trash2 size={16} /></button></td>
          </tr>
        ))}
      </tbody></table>
    </Modal>
  );
}
