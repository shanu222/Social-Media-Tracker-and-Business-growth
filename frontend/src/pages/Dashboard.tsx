import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Flame, ShieldAlert, TrendingDown, TrendingUp, Lightbulb, Target, Plus } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useData, Loading, ErrorBox, fmt, signed, prettyDate, prettyMonth, compact, useAuth, platformOf, accountColor } from '../lib';
import { CHART } from '../brand';
import { UpcomingStrip } from './Messages';

interface Acc {
  id: number; brand: string; username: string; platform: string; color: string | null; start_followers: number | null; end_followers: number | null;
  net_change: number | null; growth_pct: number | null; posts_added: number | null; reach: number; engagement_rate: number | null; days_logged: number;
}
interface Totals { end_followers: number; net_change: number; growth_pct: number | null; posts_added: number; reach: number; engagement_rate: number | null; response_rate: number | null; accounts: number }
interface Group { followers: number; net: number; growth_pct: number | null; accounts: number }
interface Dash {
  range: { start: string; end: string; days: number };
  totals: Totals; previousTotals: Totals; accounts: Acc[]; series: Record<string, number | string | null>[];
  trajectory: { date: string; total: number | null; previous: number | null; reach: number; engagements: number }[];
  products: (Group & { id: number; name: string })[];
  platforms: (Group & { platform: string })[];
  businessTrend: { id: number; name: string; unit: string | null; higher_is_better: boolean; points: { month: string; value: number | null }[] }[];
  goals: { id: number; name: string; unit: string | null; value: number | null; target: number; higher_is_better: boolean }[];
  checklist: { pct: number | null };
  today: { date: string; accountsLogged: number; checklistDone: number; checklistTotal: number };
  streak: number; actions: { id: number; title: string; brand: string | null; deadline: string | null }[];
  insights: { tone: string; text: string }[];
}

const AXIS = { fontSize: 12, fill: '#6b778a' };
const TIP = { borderRadius: 10, border: '1px solid #dde2e8', fontSize: 13, boxShadow: '0 10px 30px rgba(10,26,61,.12)' };
const short = (d: string) => prettyDate(d, { day: 'numeric', month: 'short' });

function Change({ value, pct, suffix = '' }: { value: number | null | undefined; pct?: number | null; suffix?: string }) {
  if (value === null || value === undefined) return <span className="chg">—</span>;
  const cls = value > 0 ? 'chg up' : value < 0 ? 'chg down' : 'chg';
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  return <span className={cls}><Icon size={13} />{signed(Math.round(value * 10) / 10)}{suffix}{pct !== null && pct !== undefined ? ` (${pct}%)` : ''}</span>;
}

function Spark({ data, color }: { data: (number | null)[]; color: string }) {
  const pts = data.map((v, i) => ({ i, v }));
  if (pts.filter((p) => p.v !== null).length < 2) return <span className="spark-empty" />;
  return (
    <div className="spark" aria-hidden="true">
      <ResponsiveContainer>
        <AreaChart data={pts} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <defs><linearGradient id={`sp${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.3} /><stop offset="1" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area dataKey="v" stroke={color} strokeWidth={1.8} fill={`url(#sp${color.slice(1)})`} dot={false} connectNulls isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useData<Dash>(`/dashboard?days=${days}`);
  const products = useData<{ id: number; name: string; account_count: number }[]>('/products');
  const { user, can } = useAuth();
  const [metricId, setMetricId] = useState<number | null>(null);

  // Trim leading days with no data so short histories still fill the chart
  const trajectory = useMemo(() => {
    if (!data) return [];
    const first = data.trajectory.findIndex((d) => d.total !== null);
    const from = first < 0 ? 0 : Math.min(first, Math.max(0, data.trajectory.length - 7));
    return data.trajectory.slice(from);
  }, [data]);

  // Engagement: daily for short ranges, weekly otherwise
  const engagement = useMemo(() => {
    if (!data) return [];
    const rows = data.trajectory;
    const size = rows.length > 31 ? 7 : 1;
    const out: { label: string; reach: number; rate: number | null }[] = [];
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size);
      const reach = chunk.reduce((s, r) => s + r.reach, 0);
      const eng = chunk.reduce((s, r) => s + r.engagements, 0);
      out.push({ label: size === 1 ? short(chunk[0].date) : `w/c ${short(chunk[0].date)}`, reach, rate: reach ? Math.round((eng / reach) * 1000) / 10 : null });
    }
    const firstData = out.findIndex((r) => r.reach > 0);
    return firstData < 0 ? [] : out.slice(firstData);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || 'Unknown error'} retry={reload} />;

  const t = data.totals, p = data.previousTotals, today = data.today;
  const firstName = user?.name.split(' ')[0] || '';
  const hasAccounts = data.accounts.length > 0;
  const hasPrev = data.trajectory.some((d) => d.previous !== null);
  const noAccountProducts = (products.data || []).filter((x) => x.account_count === 0);
  const metric = data.businessTrend.find((m) => m.id === metricId) || data.businessTrend[0];
  const totalPlatform = data.platforms.reduce((s, x) => s + x.followers, 0);
  const maxProduct = Math.max(1, ...data.products.map((x) => x.followers));
  const movers = [...data.accounts].filter((a) => a.net_change !== null && a.net_change !== 0).sort((a, b) => Math.abs(b.net_change!) - Math.abs(a.net_change!)).slice(0, 5);
  const attention = data.insights.filter((i) => i.tone !== 'good').slice(0, 4);
  const wins = data.insights.filter((i) => i.tone === 'good').slice(0, 2);
  const overdue = data.actions.filter((x) => x.deadline && x.deadline < today.date);

  const thisMonth = today.date.slice(0, 7);
  const metricNow = metric?.points.find((x) => x.month === thisMonth) || null;
  const metricLastMonth = metric ? metric.points[metric.points.length - 2] : null;
  const bizData = metric ? metric.points.map((x) => ({ ...x, label: prettyMonth(x.month).split(' ')[0].slice(0, 3) + (x.month === thisMonth ? ' (so far)' : '') })) : [];

  return (
    <div className="dash">
      <section className="today" aria-label="Today">
        <div className="today-intro">
          <h2>{prettyDate(today.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <p className="lede">Hi {firstName}, here's today at a glance.</p>
        </div>
        <div className="today-stat">
          <div className="k">Accounts updated</div>
          <div className="v num">{today.accountsLogged}/{t.accounts}</div>
          <div className="bar"><i style={{ width: `${t.accounts ? (today.accountsLogged / t.accounts) * 100 : 0}%` }} /></div>
        </div>
        <div className="today-stat">
          <div className="k">Daily checklist</div>
          <div className="v num">{today.checklistDone}/{today.checklistTotal}</div>
          <div className="bar"><i style={{ width: `${today.checklistTotal ? (today.checklistDone / today.checklistTotal) * 100 : 0}%` }} /></div>
        </div>
        <div className="today-stat">
          <div className="k">Logging streak</div>
          <div className="v num" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {data.streak} {data.streak === 1 ? 'day' : 'days'} {data.streak >= 3 && <Flame size={20} color="#f0a35e" />}
          </div>
        </div>
        <div className="today-cta">
          <Link to="/update" className="btn btn-primary btn-lg">Log today's numbers</Link>
        </div>
      </section>

      <div className="page-head dash-head">
        <div>
          <h1>Growth overview</h1>
          <p>{prettyDate(data.range.start, { day: 'numeric', month: 'short' })} – {prettyDate(data.range.end, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        </div>
        <div className="seg" role="group" aria-label="Period">
          {[7, 30, 90].map((d) => <button key={d} className={days === d ? 'on' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}
        </div>
      </div>

      <UpcomingStrip />
      {can('admin') && noAccountProducts.length > 0 && (
        <div className="notice" style={{ marginBottom: 16, alignItems: 'center' }}>
          <AlertTriangle />
          <span style={{ flex: 1 }}>No accounts yet for{' '}
            {noAccountProducts.map((x, i) => <span key={x.id}><Link to={`/products/${x.id}?add=account`}>{x.name}</Link>{i < noAccountProducts.length - 1 ? ', ' : ''}</span>)}
          </span>
        </div>
      )}

      {!hasAccounts ? (
        <div className="panel empty">
          <h3>No accounts yet</h3>
          <p>Growth charts appear once social accounts are added.</p>
          {can('admin') && <Link className="btn btn-primary" to="/products"><Plus /> Add accounts</Link>}
        </div>
      ) : (
        <>
          {/* Row 1: growth trajectory + audience mix */}
          <div className="dash-grid wide-left">
            <section className="panel hero-chart">
              <div className="panel-head">
                <div>
                  <h2>Follower growth</h2>
                  <div className="headline">
                    <span className="big num">{fmt(t.end_followers)}</span>
                    <Change value={t.net_change} pct={t.growth_pct} />
                    <span className="faint">this period</span>
                  </div>
                </div>
                <div className="legend">
                  <span><i style={{ background: '#1a5fe0' }} /> This period</span>
                  {hasPrev && <span><i className="dash-line" /> Previous {days} days</span>}
                </div>
              </div>
              <div className="chart-box" style={{ height: 270 }}>
                <ResponsiveContainer>
                  <ComposedChart data={trajectory} margin={{ left: 4, right: 12, top: 10 }}>
                    <defs>
                      <linearGradient id="gTraj" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1a5fe0" stopOpacity={0.28} /><stop offset="1" stopColor="#12b5e8" stopOpacity={0.02} /></linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e9eef5" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={short} tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => compact(v)} domain={[(min: number) => Math.max(0, Math.floor(min * 0.97)), (max: number) => Math.ceil(max * 1.02)]} allowDecimals={false} />
                    <Tooltip labelFormatter={(d) => prettyDate(String(d), { weekday: 'short', day: 'numeric', month: 'short' })} formatter={(v: number, n) => [fmt(v), n === 'total' ? 'Followers' : `Same day, previous ${days} days`]} contentStyle={TIP} />
                    {hasPrev && <Line dataKey="previous" stroke="#9aa8bd" strokeDasharray="5 5" strokeWidth={1.6} dot={false} connectNulls />}
                    <Area dataKey="total" stroke="#1a5fe0" strokeWidth={2.6} fill="url(#gTraj)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="metric-strip">
                <div>
                  <span className="k">Reach</span>
                  <span className="v num">{compact(t.reach)}</span>
                  <Change value={t.reach - p.reach} />
                </div>
                <div>
                  <span className="k">Engagement</span>
                  <span className="v num">{t.engagement_rate !== null ? `${t.engagement_rate}%` : '—'}</span>
                  <Change value={t.engagement_rate !== null && p.engagement_rate !== null ? t.engagement_rate - p.engagement_rate : null} suffix=" pts" />
                </div>
                <div>
                  <span className="k">Posts</span>
                  <span className="v num">{fmt(t.posts_added)}</span>
                  <Change value={t.posts_added - p.posts_added} />
                </div>
                <div>
                  <span className="k">DMs answered</span>
                  <span className="v num">{t.response_rate !== null ? `${t.response_rate}%` : '—'}</span>
                  <Change value={t.response_rate !== null && p.response_rate !== null ? t.response_rate - p.response_rate : null} suffix=" pts" />
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head"><h2>Audience by platform</h2></div>
              <div className="donut">
                <div className="donut-chart">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={data.platforms.filter((x) => x.followers > 0)} dataKey="followers" nameKey="platform" innerRadius="64%" outerRadius="94%" paddingAngle={2} stroke="none">
                        {data.platforms.filter((x) => x.followers > 0).map((x) => <Cell key={x.platform} fill={platformOf(x.platform).color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number, n) => [fmt(v), platformOf(String(n)).label]} contentStyle={TIP} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="donut-center"><b className="num">{compact(totalPlatform)}</b><span>followers</span></div>
                </div>
                <ul className="donut-legend">
                  {data.platforms.map((x) => (
                    <li key={x.platform}>
                      <i style={{ background: platformOf(x.platform).color }} />
                      <span className="name">{platformOf(x.platform).label}</span>
                      <span className="num">{totalPlatform ? Math.round((x.followers / totalPlatform) * 100) : 0}%</span>
                      <Change value={x.net} />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          {/* Row 2: products + engagement */}
          <div className="dash-grid halves">
            <section className="panel">
              <div className="panel-head">
                <h2>Product performance</h2>
                <Link to="/products" className="btn btn-sm btn-ghost">Products <ArrowRight size={14} /></Link>
              </div>
              <div className="pbars">
                {data.products.length === 0 && <p className="muted">Link accounts to products to compare them.</p>}
                {data.products.map((x, i) => (
                  <Link key={x.id} to={`/products/${x.id}`} className="pbar">
                    <span className="name">{x.name}</span>
                    <span className="track"><i style={{ width: `${Math.max(2, (x.followers / maxProduct) * 100)}%`, background: CHART[i % CHART.length] }} /></span>
                    <span className="num val">{fmt(x.followers)}</span>
                    <Change value={x.net} pct={x.growth_pct} />
                  </Link>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Reach & engagement</h2>
                <div className="legend">
                  <span><i style={{ background: '#12b5e8' }} /> Reach</span>
                  <span><i style={{ background: '#16b97a' }} /> Engagement %</span>
                </div>
              </div>
              {engagement.length === 0 ? (
                <p className="muted panel-pad">Log reach, likes and comments in Daily update to see this trend.</p>
              ) : (
                <div className="chart-box" style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={engagement} margin={{ left: 4, right: 4, top: 10 }}>
                      <defs><linearGradient id="gReach" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#12b5e8" /><stop offset="1" stopColor="#1a5fe0" stopOpacity={0.7} /></linearGradient></defs>
                      <CartesianGrid stroke="#e9eef5" vertical={false} />
                      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={20} />
                      <YAxis yAxisId="r" tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => compact(v)} />
                      <YAxis yAxisId="e" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} />
                      <Tooltip formatter={(v: number, n) => (n === 'rate' ? [`${v}%`, 'Engagement'] : [fmt(v), 'Reach'])} contentStyle={TIP} />
                      <Bar yAxisId="r" dataKey="reach" fill="url(#gReach)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                      <Line yAxisId="e" dataKey="rate" stroke="#16b97a" strokeWidth={2.4} dot={{ r: 2.5, fill: '#16b97a' }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {/* Row 3: business trend + goals */}
      <div className="dash-grid wide-left">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Business trend</h2>
              {metric && (
                <div className="headline">
                  <span className="big num">{fmt(metricNow?.value ?? null, 1)}</span>
                  <span className="faint">{metric.unit ? `${metric.unit} ` : ''}this month so far</span>
                  {metricLastMonth?.value !== null && metricLastMonth?.value !== undefined && (
                    <span className="faint">· {prettyMonth(metricLastMonth.month).split(' ')[0]}: <b className="num" style={{ color: 'var(--ink)' }}>{fmt(metricLastMonth.value, 1)}</b></span>
                  )}
                </div>
              )}
            </div>
            <Link to="/kpis" className="btn btn-sm btn-ghost">Targets & KPIs <ArrowRight size={14} /></Link>
          </div>
          {!metric ? (
            <div className="panel-pad"><p className="muted">No business numbers yet. <Link to="/update?tab=business">Add revenue, leads or signups</Link>.</p></div>
          ) : (
            <>
              <div className="tabs-scroll" role="tablist">
                {data.businessTrend.map((m) => (
                  <button key={m.id} role="tab" aria-selected={m.id === metric.id} className={m.id === metric.id ? 'on' : ''} onClick={() => setMetricId(m.id)}>{m.name}</button>
                ))}
              </div>
              <div className="chart-box" style={{ height: 230 }}>
                <ResponsiveContainer>
                  <BarChart data={bizData} margin={{ left: 4, right: 12, top: 10 }}>
                    <defs><linearGradient id="gBiz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#16b97a" stopOpacity={0.9} /><stop offset="1" stopColor="#12b5e8" stopOpacity={0.6} /></linearGradient></defs>
                    <CartesianGrid stroke="#e9eef5" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => compact(v)} />
                    <Tooltip formatter={(v: number) => [`${fmt(v, 1)}${metric.unit ? ` ${metric.unit}` : ''}`, metric.name]} contentStyle={TIP} cursor={{ fill: '#f1f5fb' }} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={48}>
                      {bizData.map((x) => <Cell key={x.month} fill="url(#gBiz)" fillOpacity={x.month === thisMonth ? 0.55 : 1} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h2><Target size={17} className="h-ico" /> Goals this month</h2></div>
          <div className="panel-pad goals">
            {data.goals.length === 0 ? (
              <div className="goals-empty">
                <p className="muted">No targets set for this month.</p>
                {can('admin') && <Link to="/kpis" className="btn btn-sm">Set targets</Link>}
              </div>
            ) : data.goals.map((g) => {
              const pct = g.value === null ? 0 : g.higher_is_better ? (g.value / g.target) * 100 : g.value <= g.target ? 100 : (g.target / g.value) * 100;
              const done = pct >= 100;
              return (
                <div key={g.id} className="goal">
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <span className="name">{g.name}</span>
                    <span className="num"><b>{fmt(g.value, 1)}</b><span className="faint"> / {fmt(g.target, 1)}{g.unit ? ` ${g.unit}` : ''}</span></span>
                  </div>
                  <div className={`gbar ${done ? 'done' : ''}`}><i style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} /></div>
                  <span className={`faint small ${done ? 'up' : ''}`}>{done ? 'Reached' : `${Math.round(pct)}% of target`}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Row 4: top movers + attention */}
      {hasAccounts && (
        <div className="dash-grid halves">
          <section className="panel">
            <div className="panel-head">
              <h2>Top movers</h2>
              <Link to="/accounts" className="btn btn-sm btn-ghost">All accounts <ArrowRight size={14} /></Link>
            </div>
            <div className="movers">
              {movers.length === 0 && <p className="muted">No follower changes in this period yet.</p>}
              {movers.map((a) => (
                <Link key={a.id} to={`/accounts/${a.id}`} className="mover">
                  <i className="dot" style={{ background: accountColor(a) }} />
                  <span className="who"><b>{a.brand}</b><span className="faint">{platformOf(a.platform).label} · {fmt(a.end_followers)} followers</span></span>
                  <Spark data={data.series.map((r) => r[`a${a.id}`] as number | null)} color={(a.net_change ?? 0) >= 0 ? '#16b97a' : '#c2372f'} />
                  <Change value={a.net_change} pct={a.growth_pct} />
                </Link>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Needs attention</h2></div>
            <div className="panel-pad attention">
              {wins.map((i, k) => <div key={`w${k}`} className="att good"><Lightbulb /><span>{i.text}</span></div>)}
              {overdue.map((x) => <div key={`a${x.id}`} className="att risk"><AlertTriangle /><span>Overdue: {x.title}</span></div>)}
              {attention.map((i, k) => (
                <div key={k} className={`att ${i.tone}`}>{i.tone === 'risk' ? <ShieldAlert /> : <AlertTriangle />}<span>{i.text}</span></div>
              ))}
              {wins.length + overdue.length + attention.length === 0 && <p className="muted">All clear.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
