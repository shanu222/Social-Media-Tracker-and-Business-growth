import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Download, Lightbulb, RefreshCw, ShieldAlert, Sparkles, TrendingDown, TrendingUp, Trophy } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, download } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, ROLE_LABEL, prettyDate, todayStr, shiftDate, type Role } from '../lib';
import { CHART } from '../brand';

interface Ind { assigned: number; completed: number; in_progress: number; not_started: number; overdue: number; completion_rate: number | null; on_time_rate: number | null; late: number; avg_progress: number | null; avg_completion_hours: number | null; hours: number }
interface TrendP { start: string; end: string; completed: number; on_time?: number; hours: number }
interface PersonR {
  mode: 'person'; user: { id: number; name: string; title: string | null; role: Role }; range: { from: string; to: string }; previousRange: { from: string; to: string };
  indicators: Ind; previous: Ind; management: { tasks_created: number; created_tasks_completed: number; messages_sent: number; announcements: number; comments: number };
  timeByProduct: { product_id: number; name: string; hours: number }[]; tasksByProduct: { product_id: number; name: string; assigned: number; completed: number }[];
  trend: { size: string; points: TrendP[] }; activity: { label: string; count: number }[];
  active: { id: number; title: string; product_id: number; product_name: string; status: string; progress: number; due_date: string | null; overdue: boolean }[];
  achievements: { id: number; title: string; product_id: number; product_name: string; completed_at: string; on_time: boolean }[];
  attention: { type: string; text: string; task_id: number; product_id: number }[];
  insights: { tone: string; text: string }[];
}
interface TeamR {
  mode: 'team'; range: { from: string; to: string }; previousRange: { from: string; to: string };
  team: { assigned: number; completed: number; overdue: number; hours: number; completion_rate: number | null };
  people: { id: number; name: string; title: string | null; role: Role; indicators: Ind; previous: Ind; timeByProduct: { name: string; hours: number }[] }[];
  trend: { size: string; points: TrendP[] }; timeByProduct: { product_id: number; name: string; hours: number }[];
  insights: { tone: string; text: string }[];
}
type R = PersonR | TeamR;
interface Ai { ok: boolean; summary?: string; highlights?: string[]; concerns?: string[]; recommendations?: string[]; providerLabel?: string; model?: string; reason?: string; insights?: { tone: string; text: string }[] }

const AXIS = { fontSize: 12, fill: '#6b778a' };
const TIP = { borderRadius: 10, border: '1px solid #dde2e8', fontSize: 13, boxShadow: '0 10px 30px rgba(10,26,61,.12)' };
const hrs = (h: number | null) => (h === null ? '—' : h < 1 ? '<1 h' : h >= 48 ? `${Math.round((h / 24) * 10) / 10} days` : `${h} h`);

function periodRange(p: string, from: string, to: string) {
  const t = todayStr();
  const d = new Date(t + 'T00:00:00Z');
  if (p === 'today') return [t, t];
  if (p === 'week') { const dow = (d.getUTCDay() + 6) % 7; return [shiftDate(t, -dow), t]; }
  if (p === 'month') return [`${t.slice(0, 7)}-01`, t];
  if (p === 'quarter') { const q = Math.floor(d.getUTCMonth() / 3) * 3; return [`${t.slice(0, 4)}-${String(q + 1).padStart(2, '0')}-01`, t]; }
  if (p === 'last30') return [shiftDate(t, -29), t];
  return [from || shiftDate(t, -29), to || t];
}

function Ring({ value, color, label, sub, delta }: { value: number | null; color: string; label: string; sub?: string; delta?: number | null }) {
  const r = 38, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="ring">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#e8edf4" strokeWidth="10" />
        {value !== null && v > 0 && <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 50 50)" className="ring-arc" />}
      </svg>
      <div className="ring-v num">{value === null ? '—' : `${value}%`}</div>
      <div className="ring-l">{label}</div>
      {sub && <div className="ring-s">{sub}</div>}
      {delta !== undefined && <Delta v={delta} suffix=" pts" />}
    </div>
  );
}

function Delta({ v, suffix = '', invert = false }: { v: number | null | undefined; suffix?: string; invert?: boolean }) {
  if (v === null || v === undefined) return <span className="chg faint">no earlier data</span>;
  const good = invert ? v < 0 : v > 0;
  const Icon = v >= 0 ? TrendingUp : TrendingDown;
  return <span className={`chg ${v === 0 ? '' : good ? 'up' : 'down'}`}><Icon size={13} />{v > 0 ? '+' : ''}{Math.round(v * 10) / 10}{suffix} vs before</span>;
}
const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

export default function Performance() {
  const { user, can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const isAdmin = can('admin');
  const person = isAdmin ? params.get('user') || '' : String(user?.id || '');
  const product = params.get('product') || '';
  const period = params.get('period') || 'month';
  const [from, to] = periodRange(period, params.get('from') || '', params.get('to') || '');
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  const q = new URLSearchParams({ from, to, ...(person ? { user_id: person } : {}), ...(product ? { product_id: product } : {}) }).toString();
  const { data, error, loading, reload } = useData<R>(`/performance?${q}`);
  const users = useData<{ id: number; name: string; role: Role; active: boolean; title: string | null }[]>(isAdmin ? '/users' : null);
  const products = useData<{ id: number; name: string }[]>('/products');
  const [ai, setAi] = useState<Ai | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function runAi(refresh = false) {
    setAiBusy(true);
    try { setAi(await api.post<Ai>('/performance/summary', { from, to, ...(person ? { user_id: Number(person) } : {}), ...(product ? { product_id: Number(product) } : {}), refresh })); }
    catch (e) { toast((e as Error).message, true); } finally { setAiBusy(false); }
  }
  async function pdf() {
    setPdfBusy(true);
    try { await download(`/performance/pdf?${q}`, `performance-${data?.mode === 'person' ? data.user.name : 'team'}-${from}-to-${to}.pdf`); }
    catch (e) { toast((e as Error).message, true); } finally { setPdfBusy(false); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isAdmin ? 'Team performance' : 'My performance'}</h1>
          <p>Task outcomes and time logged on tasks, {prettyDate(from, { day: 'numeric', month: 'short' })} – {prettyDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}.</p>
        </div>
        <div className="page-actions">
          {isAdmin && <button className="btn" onClick={() => runAi()} disabled={aiBusy || !data}><Sparkles /> {aiBusy ? 'Analysing…' : 'AI summary'}</button>}
          <button className="btn btn-primary" onClick={pdf} disabled={pdfBusy || !data}><Download /> {pdfBusy ? 'Preparing…' : 'Download PDF'}</button>
        </div>
      </div>

      <div className="panel filters">
        {isAdmin && (
          <div className="field"><label htmlFor="fp">Person</label>
            <select id="fp" className="input" value={person} onChange={(e) => { set('user', e.target.value); setAi(null); }}>
              <option value="">Whole team</option>
              {(users.data || []).filter((u) => u.active && u.role !== 'viewer').map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === user?.id ? ' (you)' : ''}</option>)}
            </select>
          </div>
        )}
        <div className="field"><label htmlFor="fpr">Product</label>
          <select id="fpr" className="input" value={product} onChange={(e) => { set('product', e.target.value); setAi(null); }}>
            <option value="">All products</option>
            {(products.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field grow"><label>Period</label>
          <div className="seg wrap" role="group" aria-label="Period">
            {[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['last30', 'Last 30 days'], ['quarter', 'This quarter'], ['custom', 'Custom']].map(([k, l]) => (
              <button key={k} className={period === k ? 'on' : ''} onClick={() => { set('period', k); setAi(null); }}>{l}</button>
            ))}
          </div>
        </div>
        {period === 'custom' && (
          <>
            <div className="field"><label htmlFor="ff">From</label><input id="ff" type="date" className="input" value={from} max={to} onChange={(e) => set('from', e.target.value)} /></div>
            <div className="field"><label htmlFor="ft">To</label><input id="ft" type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => set('to', e.target.value)} /></div>
          </>
        )}
      </div>

      {ai && <AiPanel ai={ai} onRefresh={() => runAi(true)} busy={aiBusy} />}
      {loading && !data ? <Loading /> : error || !data ? <ErrorBox error={error || ''} retry={reload} /> :
        data.mode === 'team' ? <Team r={data} openPerson={(id) => { set('user', String(id)); setAi(null); }} /> : <Person r={data} back={isAdmin ? () => { set('user', ''); setAi(null); } : undefined} />}
    </>
  );
}

function AiPanel({ ai, onRefresh, busy }: { ai: Ai; onRefresh: () => void; busy: boolean }) {
  if (!ai.ok) {
    return (
      <div className="panel ai-panel off">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2><Sparkles size={17} className="h-ico" /> Summary</h2><span className="faint small">{ai.reason} Showing findings from the data instead.</span></div>
        <ul className="ai-list">{(ai.insights || []).map((i, k) => <li key={k} className={i.tone}>{i.text}</li>)}</ul>
      </div>
    );
  }
  return (
    <div className="panel ai-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2><Sparkles size={17} className="h-ico" /> AI summary</h2>
        <span className="row" style={{ gap: 8 }}><span className="faint small">{ai.providerLabel}{ai.model ? ` · ${ai.model}` : ''} · based only on platform data</span><button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={busy}><RefreshCw size={13} /> Regenerate</button></span>
      </div>
      <p className="ai-sum">{ai.summary}</p>
      <div className="ai-cols">
        {[['Highlights', ai.highlights, 'good', Trophy], ['Concerns', ai.concerns, 'warn', AlertTriangle], ['Recommendations', ai.recommendations, 'info', Lightbulb]].map(([t, list, tone, Icon]) => {
          const L = list as string[] | undefined; const I = Icon as typeof Trophy;
          return L && L.length ? <div key={t as string} className={`ai-col ${tone}`}><b><I size={15} /> {t as string}</b><ul>{L.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null;
        })}
      </div>
    </div>
  );
}

function Insights({ items }: { items: { tone: string; text: string }[] }) {
  if (!items.length) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Findings</h2></div>
      <div className="panel-pad attention">
        {items.map((i, k) => <div key={k} className={`att ${i.tone}`}>{i.tone === 'good' ? <CheckCircle2 /> : i.tone === 'risk' ? <ShieldAlert /> : i.tone === 'warn' ? <AlertTriangle /> : <Lightbulb />}<span>{i.text}</span></div>)}
      </div>
    </section>
  );
}

function TrendChart({ points, size }: { points: TrendP[]; size: string }) {
  const fmtX = (d: string) => prettyDate(d, size === 'month' ? { month: 'short' } : { day: 'numeric', month: 'short' });
  const any = points.some((p) => p.completed || p.hours);
  if (!any) return <p className="muted panel-pad">No completed tasks or logged time in this period yet.</p>;
  return (
    <div className="chart-box" style={{ height: 250 }}>
      <ResponsiveContainer>
        <ComposedChart data={points} margin={{ left: 4, right: 4, top: 10 }}>
          <defs><linearGradient id="gHrs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#16b97a" stopOpacity={0.85} /><stop offset="1" stopColor="#12b5e8" stopOpacity={0.55} /></linearGradient></defs>
          <CartesianGrid stroke="#e9eef5" vertical={false} />
          <XAxis dataKey="start" tickFormatter={fmtX} tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis yAxisId="h" tick={AXIS} tickLine={false} axisLine={false} width={36} tickFormatter={(v) => `${v}h`} />
          <YAxis yAxisId="c" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
          <Tooltip labelFormatter={(d) => (size === 'day' ? prettyDate(String(d)) : `${size === 'week' ? 'Week of' : ''} ${prettyDate(String(d), { day: 'numeric', month: 'short' })}`)} formatter={(v: number, n) => [n === 'hours' ? `${v} h` : v, n === 'hours' ? 'Hours logged' : n === 'on_time' ? 'On time' : 'Tasks completed']} contentStyle={TIP} />
          <Legend formatter={(v) => (v === 'hours' ? 'Hours logged' : v === 'on_time' ? 'Completed on time' : 'Tasks completed')} iconType="circle" wrapperStyle={{ fontSize: 12.5 }} />
          <Bar yAxisId="h" dataKey="hours" fill="url(#gHrs)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Line yAxisId="c" dataKey="completed" stroke="#1a5fe0" strokeWidth={2.4} dot={{ r: 3 }} />
          {points.some((p) => p.on_time !== undefined) && <Line yAxisId="c" dataKey="on_time" stroke="#0a1a3d" strokeWidth={1.6} strokeDasharray="4 4" dot={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Donut({ data, unit }: { data: { name: string; value: number }[]; unit: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="donut">
      <div className="donut-chart">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
              {data.map((d, i) => <Cell key={d.name} fill={CHART[i % CHART.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number) => `${v}${unit}`} contentStyle={TIP} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center"><b className="num">{Math.round(total * 10) / 10}{unit}</b><span>total</span></div>
      </div>
      <ul className="donut-legend simple">
        {data.map((d, i) => <li key={d.name}><i style={{ background: CHART[i % CHART.length] }} /><span className="name">{d.name}</span><span className="num">{d.value}{unit}</span><span className="num faint">{total ? Math.round((d.value / total) * 100) : 0}%</span></li>)}
      </ul>
    </div>
  );
}

function Team({ r, openPerson }: { r: TeamR; openPerson: (id: number) => void }) {
  const people = r.people;
  const rates = people.filter((p) => p.indicators.assigned > 0).map((p) => ({ name: p.name.split(' ')[0], completion: p.indicators.completion_rate ?? 0, onTime: p.indicators.on_time_rate ?? 0 }));
  const load = people.map((p) => ({ name: p.name.split(' ')[0], done: p.indicators.completed, progress: p.indicators.in_progress, todo: Math.max(0, p.indicators.not_started - 0), overdue: p.indicators.overdue }));
  const doneAll = people.reduce((s, p) => s + p.indicators.completed, 0);
  const onTimeAll = people.reduce((s, p) => s + Math.round(((p.indicators.on_time_rate ?? 0) / 100) * p.indicators.completed), 0);
  const active = people.reduce((s, p) => s + p.indicators.in_progress + p.indicators.not_started, 0);
  const prog = people.reduce((s, p) => s + (p.indicators.avg_progress ?? 0) * (p.indicators.in_progress + p.indicators.not_started), 0);
  return (
    <div className="dash">
      <div className="dash-grid wide-left">
        <section className="panel">
          <div className="panel-head"><h2>Team at a glance</h2><span className="faint small">vs {prettyDate(r.previousRange.from, { day: 'numeric', month: 'short' })} – {prettyDate(r.previousRange.to, { day: 'numeric', month: 'short' })}</span></div>
          <div className="rings">
            <Ring value={r.team.completion_rate} color="#1a5fe0" label="Task completion" sub={`${r.team.completed} of ${r.team.assigned} tasks`} />
            <Ring value={doneAll ? Math.round((onTimeAll / doneAll) * 100) : null} color="#16b97a" label="On-time completion" sub={`${doneAll} completed`} />
            <Ring value={active ? Math.round(prog / active) : null} color="#12b5e8" label="Work progress" sub={`${active} active tasks`} />
            <div className="ring stat"><div className="big num">{r.team.hours} h</div><div className="ring-l">Time on tasks</div><div className={`ring-s ${r.team.overdue ? 'down' : ''}`}>{r.team.overdue} overdue</div></div>
          </div>
          <div className="panel-head" style={{ paddingTop: 4 }}><h2 className="sub">Team trend</h2></div>
          <TrendChart points={r.trend.points} size={r.trend.size} />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Time by product</h2></div>
          {r.timeByProduct.length ? <Donut data={r.timeByProduct.map((p) => ({ name: p.name, value: p.hours }))} unit=" h" /> : <p className="muted panel-pad">No time logged yet. Team members can start a timer on any task.</p>}
        </section>
      </div>

      <div className="dash-grid halves">
        <section className="panel">
          <div className="panel-head"><h2>Completion & deadlines by person</h2></div>
          {rates.length ? (
            <div className="chart-box" style={{ height: Math.max(170, rates.length * 56 + 50) }}>
              <ResponsiveContainer>
                <BarChart data={rates} layout="vertical" margin={{ left: 8, right: 24, top: 4 }}>
                  <CartesianGrid stroke="#e9eef5" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ ...AXIS, fill: '#1b2433' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number, n) => [`${v}%`, n === 'completion' ? 'Task completion' : 'On time']} contentStyle={TIP} cursor={{ fill: '#f1f5fb' }} />
                  <Legend formatter={(v) => (v === 'completion' ? 'Task completion' : 'On-time completion')} iconType="circle" wrapperStyle={{ fontSize: 12.5 }} />
                  <Bar dataKey="completion" fill="#1a5fe0" radius={[0, 5, 5, 0]} maxBarSize={14} />
                  <Bar dataKey="onTime" fill="#16b97a" radius={[0, 5, 5, 0]} maxBarSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="muted panel-pad">No tasks assigned in this period.</p>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Workload balance</h2></div>
          <div className="chart-box" style={{ height: Math.max(170, load.length * 56 + 50) }}>
            <ResponsiveContainer>
              <BarChart data={load} layout="vertical" margin={{ left: 8, right: 24, top: 4 }}>
                <CartesianGrid stroke="#e9eef5" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={80} tick={{ ...AXIS, fill: '#1b2433' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TIP} cursor={{ fill: '#f1f5fb' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12.5 }} />
                <Bar dataKey="done" name="Completed" stackId="a" fill="#16b97a" maxBarSize={22} />
                <Bar dataKey="progress" name="In progress" stackId="a" fill="#12b5e8" maxBarSize={22} />
                <Bar dataKey="todo" name="Not started" stackId="a" fill="#c9d3e1" maxBarSize={22} />
                <Bar dataKey="overdue" name="Overdue (of open)" fill="#c2372f" maxBarSize={8} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head"><h2>People</h2><span className="faint small">Select a person for their full report</span></div>
        <div className="people-rows">
          {people.map((p) => (
            <button key={p.id} className="person-row" onClick={() => openPerson(p.id)}>
              <span className="avatar">{p.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span>
              <span className="who"><b>{p.name}</b><span className="faint">{p.title || ROLE_LABEL[p.role]}</span></span>
              <span className="mini"><span className="lbl">Completion</span><span className="mbar"><i style={{ width: `${p.indicators.completion_rate ?? 0}%`, background: '#1a5fe0' }} /></span><span className="num">{p.indicators.completion_rate ?? '—'}{p.indicators.completion_rate !== null && '%'}</span></span>
              <span className="mini"><span className="lbl">On time</span><span className="mbar"><i style={{ width: `${p.indicators.on_time_rate ?? 0}%`, background: '#16b97a' }} /></span><span className="num">{p.indicators.on_time_rate ?? '—'}{p.indicators.on_time_rate !== null && '%'}</span></span>
              <span className="facts"><span><Clock size={13} /> {p.indicators.hours} h</span>{p.indicators.overdue > 0 && <span className="down"><AlertTriangle size={13} /> {p.indicators.overdue} overdue</span>}<Delta v={diff(p.indicators.completion_rate, p.previous.completion_rate)} suffix=" pts" /></span>
            </button>
          ))}
        </div>
      </section>
      <Insights items={r.insights} />
    </div>
  );
}

function Person({ r, back }: { r: PersonR; back?: () => void }) {
  const i = r.indicators, p = r.previous;
  const deadline = [
    { name: 'On time', value: i.completed - i.late },
    { name: 'Late', value: i.late },
    { name: 'Overdue (open)', value: i.overdue },
  ].filter((d) => d.value > 0);
  const mgmt = useMemo(() => [
    { k: 'Tasks created', v: r.management.tasks_created }, { k: 'Created tasks completed', v: r.management.created_tasks_completed },
    { k: 'Messages sent', v: r.management.messages_sent }, { k: 'Announcements', v: r.management.announcements }, { k: 'Task comments', v: r.management.comments },
  ], [r.management]);
  const showMgmt = r.user.role === 'admin' || r.management.tasks_created > 0;
  const maxAct = Math.max(1, ...r.activity.map((a) => a.count));
  const maxM = Math.max(1, ...mgmt.map((m) => m.v));

  return (
    <div className="dash">
      <section className="panel person-head">
        {back && <button className="btn btn-ghost btn-icon" onClick={back} aria-label="Back to team"><ArrowLeft size={18} /></button>}
        <span className="avatar lg">{r.user.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span>
        <div><h2>{r.user.name}</h2><div className="muted">{r.user.title || ROLE_LABEL[r.user.role]}</div></div>
        <div className="person-facts">
          <span><b className="num">{i.assigned}</b> assigned</span><span><b className="num">{i.completed}</b> completed</span>
          <span><b className="num">{i.in_progress}</b> in progress</span><span className={i.overdue ? 'down' : ''}><b className="num">{i.overdue}</b> overdue</span>
        </div>
      </section>

      <div className="dash-grid wide-left">
        <section className="panel">
          <div className="panel-head"><h2>Performance indicators</h2><span className="faint small">vs {prettyDate(r.previousRange.from, { day: 'numeric', month: 'short' })} – {prettyDate(r.previousRange.to, { day: 'numeric', month: 'short' })}</span></div>
          <div className="rings">
            <Ring value={i.completion_rate} color="#1a5fe0" label="Task completion" sub={`${i.completed} of ${i.assigned} tasks`} delta={diff(i.completion_rate, p.completion_rate)} />
            <Ring value={i.on_time_rate} color="#16b97a" label="On-time completion" sub={`${i.late} late`} delta={diff(i.on_time_rate, p.on_time_rate)} />
            <Ring value={i.avg_progress} color="#12b5e8" label="Work progress" sub={`${i.in_progress + i.not_started} active tasks`} />
            <div className="ring stat">
              <div className="big num">{i.hours} h</div><div className="ring-l">Time on tasks</div>
              <div className="ring-s">avg {hrs(i.avg_completion_hours)} to complete</div>
              <Delta v={diff(i.hours, p.hours)} suffix=" h" />
            </div>
          </div>
          <div className="panel-head" style={{ paddingTop: 4 }}><h2 className="sub">Productivity trend</h2></div>
          <TrendChart points={r.trend.points} size={r.trend.size} />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Time by product</h2></div>
          {r.timeByProduct.length ? <Donut data={r.timeByProduct.map((x) => ({ name: x.name, value: x.hours }))} unit=" h" />
            : r.tasksByProduct.length ? <><p className="faint small" style={{ padding: '6px 20px 0' }}>No time logged yet — showing tasks per product.</p><Donut data={r.tasksByProduct.map((x) => ({ name: x.name, value: x.assigned }))} unit="" /></>
            : <p className="muted panel-pad">No tasks or time in this period.</p>}
        </section>
      </div>

      <div className="dash-grid halves">
        <section className="panel">
          <div className="panel-head"><h2>Deadline performance</h2></div>
          {deadline.length ? (
            <div className="donut">
              <div className="donut-chart">
                <ResponsiveContainer><PieChart><Pie data={deadline} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
                  {deadline.map((d) => <Cell key={d.name} fill={d.name === 'On time' ? '#16b97a' : d.name === 'Late' ? '#e0812a' : '#c2372f'} />)}
                </Pie><Tooltip contentStyle={TIP} /></PieChart></ResponsiveContainer>
                <div className="donut-center"><b className="num">{i.on_time_rate ?? '—'}{i.on_time_rate !== null && '%'}</b><span>on time</span></div>
              </div>
              <ul className="donut-legend simple">{deadline.map((d) => <li key={d.name}><i style={{ background: d.name === 'On time' ? '#16b97a' : d.name === 'Late' ? '#e0812a' : '#c2372f' }} /><span className="name">{d.name}</span><span className="num">{d.value}</span><span /></li>)}</ul>
            </div>
          ) : <p className="muted panel-pad">No deadlines met or missed in this period.</p>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>{showMgmt ? 'Management activity' : 'Work activity'}</h2></div>
          <div className="hbars">
            {(showMgmt ? mgmt.map((m) => ({ label: m.k, count: m.v, max: maxM })) : r.activity.map((a) => ({ ...a, max: maxAct }))).map((a, k) => (
              <div key={a.label} className="hbar"><span className="name">{a.label}</span><span className="track"><i style={{ width: `${Math.max(a.count ? 3 : 0, (a.count / a.max) * 100)}%`, background: CHART[k % CHART.length] }} /></span><span className="num">{a.count}</span></div>
            ))}
            {!showMgmt && r.activity.length === 0 && <p className="muted">No recorded activity in this period.</p>}
          </div>
          {showMgmt && r.activity.length > 0 && (
            <>
              <div className="panel-head" style={{ paddingTop: 0 }}><h2 className="sub">All work activity</h2></div>
              <div className="hbars">{r.activity.map((a, k) => <div key={a.label} className="hbar"><span className="name">{a.label}</span><span className="track"><i style={{ width: `${(a.count / maxAct) * 100}%`, background: CHART[(k + 2) % CHART.length] }} /></span><span className="num">{a.count}</span></div>)}</div>
            </>
          )}
        </section>
      </div>

      <div className="dash-grid halves">
        <section className="panel">
          <div className="panel-head"><h2>Ongoing work</h2></div>
          <div className="work-list">
            {r.active.length === 0 && <p className="muted">Nothing in progress.</p>}
            {r.active.map((t) => (
              <Link key={t.id} to={`/products/${t.product_id}?tab=tasks&task=${t.id}`} className="work-item">
                <span className="who"><b>{t.title}</b><span className="faint">{t.product_name}{t.due_date && ` · due ${prettyDate(t.due_date, { day: 'numeric', month: 'short' })}`}</span></span>
                <span className="mbar"><i style={{ width: `${t.progress}%`, background: t.overdue ? '#c2372f' : '#1a5fe0' }} /></span>
                <span className={`num ${t.overdue ? 'down' : ''}`}>{t.overdue ? 'Overdue' : `${t.progress}%`}</span>
              </Link>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Completed work</h2></div>
          <div className="work-list">
            {r.achievements.length === 0 && <p className="muted">No tasks completed in this period.</p>}
            {r.achievements.map((t) => (
              <Link key={t.id} to={`/products/${t.product_id}?tab=tasks&task=${t.id}`} className="work-item done">
                <CheckCircle2 size={17} className={t.on_time ? 'up' : 'warn-ico'} />
                <span className="who"><b>{t.title}</b><span className="faint">{t.product_name} · {prettyDate(t.completed_at.slice(0, 10), { day: 'numeric', month: 'short' })}</span></span>
                <span className={`badge ${t.on_time ? 'badge-good' : 'badge-warn'}`}>{t.on_time ? 'On time' : 'Late'}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {r.attention.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h2>Needs follow-up</h2></div>
          <div className="panel-pad attention">
            {r.attention.map((a, k) => <Link key={k} to={`/products/${a.product_id}?tab=tasks&task=${a.task_id}`} className={`att ${a.type === 'overdue' ? 'risk' : 'warn'}`}><AlertTriangle /><span>{a.text}</span></Link>)}
          </div>
        </section>
      )}
      <Insights items={r.insights} />
    </div>
  );
}
