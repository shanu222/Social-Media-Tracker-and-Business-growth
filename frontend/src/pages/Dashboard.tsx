import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Flame, AlertTriangle } from 'lucide-react';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART } from '../brand';
import { useData, Loading, ErrorBox, fmt, signed, tone, prettyDate, AccountLabel, Stars, compact, useAuth } from '../lib';

interface Acc {
  id: number; brand: string; username: string; color: string | null; start_followers: number | null; end_followers: number | null;
  net_change: number | null; growth_pct: number | null; posts_added: number | null; reach: number; engagement_rate: number | null;
  rating: number | null; deltas: (number | null)[]; days_logged: number;
}
interface Totals { end_followers: number; net_change: number; growth_pct: number | null; posts_added: number; reach: number; engagement_rate: number | null; response_rate: number | null; two_factor_coverage: number | null; accounts: number }
interface Dash {
  range: { start: string; end: string; days: number };
  totals: Totals; previousTotals: Totals; accounts: Acc[]; series: Record<string, number | string | null>[];
  checklist: { pct: number | null }; business: { id: number; name: string; unit: string | null; value: number | null; previous: number | null; higher_is_better: boolean }[];
  today: { date: string; accountsLogged: number; checklistDone: number; checklistTotal: number };
  streak: number; actions: { id: number; title: string; brand: string | null; deadline: string | null; owner: string | null }[];
  insights: { tone: string; text: string }[];
}

function ribbonClass(d: number | null, scale: number) {
  if (d === null) return '';
  if (d < 0) return 'l';
  if (d === 0) return 'z';
  const r = d / scale;
  return r > 0.75 ? 'g4' : r > 0.45 ? 'g3' : r > 0.2 ? 'g2' : 'g1';
}

function Delta({ cur, prev, suffix = '' }: { cur: number | null; prev: number | null; suffix?: string }) {
  if (cur === null || prev === null || prev === undefined) return <span className="faint">No earlier period to compare</span>;
  const diff = cur - prev;
  return <span className={tone(diff)}>{diff === 0 ? 'Same as' : `${signed(Math.round(diff * 10) / 10)}${suffix} vs`} previous period</span>;
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useData<Dash>(`/dashboard?days=${days}`);
  const products = useData<{ id: number; name: string; account_count: number; followers: number | string | null; color: string | null }[]>('/products');
  const { user, can } = useAuth();

  const chart = useMemo(() => {
    if (!data) return [];
    return data.series.map((row, i) => {
      let total = 0, any = false;
      for (const a of data.accounts) {
        const v = row[`a${a.id}`] as number | null;
        if (v !== null && v !== undefined) { total += v; any = true; }
      }
      const gained = data.accounts.reduce((s, a) => s + (a.deltas[i] ?? 0), 0);
      return { date: row.date as string, total: any ? total : null, gained };
    });
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || 'Unknown error'} retry={reload} />;

  const { totals: t, previousTotals: p, today } = data;
  const firstName = user?.name.split(' ')[0];
  const maxDelta = Math.max(1, ...data.accounts.flatMap((a) => a.deltas.map((d) => d ?? 0)));
  const hasAccounts = data.accounts.length > 0;
  const byProduct = (products.data || []).filter((p) => p.account_count > 0).map((p) => ({ id: p.id, name: p.name, followers: Number(p.followers) || 0 })).sort((a, b) => b.followers - a.followers);

  return (
    <>
      <section className="today" aria-label="Today">
        <div className="today-intro">
          <h2>{prettyDate(today.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <p className="lede">Good to see you, {firstName}. Here's what is left for today.</p>
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
          <Link to="/update" className="btn btn-primary" style={{ height: 42 }}>Log today's numbers</Link>
        </div>
      </section>

      <div className="page-head" style={{ marginBottom: 14 }}>
        <div>
          <h1>Growth overview</h1>
          <p>{prettyDate(data.range.start, { day: 'numeric', month: 'short' })} – {prettyDate(data.range.end, { day: 'numeric', month: 'short', year: 'numeric' })}, compared with the {days} days before.</p>
        </div>
        <div className="seg" role="group" aria-label="Period">
          {[7, 30, 90].map((d) => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>
          ))}
        </div>
      </div>

      {can('admin') && (products.data || []).some((p) => p.account_count === 0) && (
        <div className="notice" style={{ marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <AlertTriangle />
          <span style={{ flex: 1 }}><b>These products have no social accounts yet:</b>{' '}
            {(products.data || []).filter((p) => p.account_count === 0).map((p, i, arr) => (
              <span key={p.id}><Link to={`/products/${p.id}?add=account`}>{p.name}</Link>{i < arr.length - 1 ? ', ' : ''}</span>
            ))}. Add them so their growth is tracked.
          </span>
        </div>
      )}
      {!hasAccounts && can('admin') && (
        <div className="panel empty" style={{ marginBottom: 16 }}>
          <h3>Add your first social account</h3>
          <p>Once accounts are registered, daily numbers and growth show up here.</p>
          <Link className="btn btn-primary" to="/accounts">Add accounts</Link>
        </div>
      )}

      <div className="kpis">
        <div className="panel kpi">
          <div className="k">Total followers</div>
          <div className="v">{fmt(t.end_followers)}</div>
          <div className="d"><span className={tone(t.net_change)}>{signed(t.net_change)}{t.growth_pct !== null && ` (${t.growth_pct}%)`}</span> <span className="muted">this period</span></div>
        </div>
        <div className="panel kpi">
          <div className="k">Posts published</div>
          <div className="v">{fmt(t.posts_added)}</div>
          <div className="d"><Delta cur={t.posts_added} prev={p.posts_added} /></div>
        </div>
        <div className="panel kpi">
          <div className="k">Reach</div>
          <div className="v">{compact(t.reach)}</div>
          <div className="d"><span className="muted">Engagement {t.engagement_rate !== null ? `${t.engagement_rate}%` : '—'}</span></div>
        </div>
        <div className="panel kpi">
          <div className="k">DMs answered</div>
          <div className="v">{t.response_rate !== null ? `${t.response_rate}%` : '—'}</div>
          <div className="d"><span className="muted">Checklist done {data.checklist.pct !== null ? `${data.checklist.pct}%` : '—'}</span></div>
        </div>
      </div>

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Followers over time</h2>
              <p>Bars show new followers gained each day; the line is the total across all accounts.</p>
            </div>
          </div>
          <div style={{ height: 290, padding: '12px 8px 8px 0' }}>
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#16b97a" /><stop offset="1" stopColor="#12b5e8" stopOpacity={0.75} /></linearGradient>
                  <linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1a5fe0" stopOpacity={0.18} /><stop offset="1" stopColor="#1a5fe0" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="#e9eef5" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => prettyDate(d, { day: 'numeric', month: 'short' })} tick={{ fontSize: 12, fill: '#5e6a7c' }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis yAxisId="g" tick={{ fontSize: 12, fill: '#5e6a7c' }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <YAxis yAxisId="t" orientation="right" tick={{ fontSize: 12, fill: '#5e6a7c' }} tickLine={false} axisLine={false} width={44} domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip
                  labelFormatter={(d) => prettyDate(String(d), { weekday: 'long', day: 'numeric', month: 'short' })}
                  formatter={(v: number, n) => [fmt(v), n === 'total' ? 'Total followers' : 'New followers']}
                  contentStyle={{ borderRadius: 10, border: '1px solid #dde2e8', fontSize: 13, boxShadow: '0 8px 24px rgba(10,26,61,.12)' }}
                />
                <Area yAxisId="t" dataKey="total" stroke="#1a5fe0" strokeWidth={2.4} fill="url(#gArea)" dot={false} activeDot={{ r: 4 }} connectNulls />
                <Bar yAxisId="g" dataKey="gained" fill="url(#gBar)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>What the numbers say</h2></div>
          <div className="panel-pad" style={{ paddingTop: 6 }}>
            {data.insights.length === 0 && <p className="muted" style={{ padding: '12px 0' }}>Log a few days of numbers to get suggestions.</p>}
            {data.insights.map((i, k) => (
              <div className="insight" key={k}>
                <span className="mark" style={{ background: i.tone === 'good' ? 'var(--growth)' : i.tone === 'risk' ? 'var(--loss)' : i.tone === 'warn' ? 'var(--amber)' : 'var(--signal)' }} />
                <span>{i.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {byProduct.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <div>
              <h2>Followers by product</h2>
              <p>Latest total followers across each product's social accounts.</p>
            </div>
            <Link to="/products" className="btn btn-ghost">All products <ArrowRight /></Link>
          </div>
          <div style={{ height: Math.max(140, byProduct.length * 38 + 30), padding: '10px 16px 10px 4px' }}>
            <ResponsiveContainer>
              <BarChart data={byProduct} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }}>
                <CartesianGrid stroke="#e9eef5" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12, fill: '#5e6a7c' }} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v)} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12.5, fill: '#1b2433' }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: '#f1f5fb' }} formatter={(v: number) => [fmt(v), 'Followers']} contentStyle={{ borderRadius: 10, border: '1px solid #dde2e8', fontSize: 13 }} />
                <Bar dataKey="followers" radius={[0, 5, 5, 0]} maxBarSize={22}>
                  {byProduct.map((p, i) => <Cell key={p.id} fill={CHART[i % CHART.length]} />)}
                  <LabelList dataKey="followers" position="right" formatter={(v: number) => fmt(v)} style={{ fontSize: 12, fill: '#1b2433', fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {hasAccounts && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <div>
              <h2>Growth by account</h2>
              <p>Each cell is one day. Darker green means more new followers; red means followers were lost.</p>
            </div>
            <div className="ribbon-legend" aria-hidden="true">
              Lost <i style={{ background: '#e9a39c' }} /> <i style={{ background: '#dfe4ea' }} /> <i style={{ background: '#bfe6d9' }} /><i style={{ background: '#2fa585' }} /><i style={{ background: '#0b7f66' }} /> Gained
            </div>
          </div>
          <div className="table-wrap" style={{ padding: '8px 8px 4px' }}>
            <table className="t ribbon-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th style={{ width: '38%' }}>Daily change</th>
                  <th className="r">Followers</th>
                  <th className="r">Net</th>
                  <th className="r">Growth</th>
                  <th className="r">Posts</th>
                  <th className="r">Eng.</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {[...data.accounts].sort((a, b) => (b.growth_pct ?? -1) - (a.growth_pct ?? -1)).map((a) => (
                  <tr key={a.id}>
                    <td><Link to={`/accounts/${a.id}`} style={{ textDecoration: 'none' }}><AccountLabel a={a} /></Link></td>
                    <td>
                      <div className="ribbon" title={`${a.days_logged} days logged`}>
                        {a.deltas.map((d, i) => <i key={i} className={ribbonClass(d, maxDelta)} title={`${prettyDate(data.series[i].date as string, { day: 'numeric', month: 'short' })}: ${d === null ? 'not logged' : signed(d)}`} />)}
                      </div>
                    </td>
                    <td className="r num">{fmt(a.end_followers)}</td>
                    <td className={`r num ${tone(a.net_change)}`}>{signed(a.net_change)}</td>
                    <td className="r num">{a.growth_pct !== null ? `${a.growth_pct}%` : '—'}</td>
                    <td className="r num">{fmt(a.posts_added)}</td>
                    <td className="r num">{a.engagement_rate !== null ? `${a.engagement_rate}%` : '—'}</td>
                    <td><Stars n={a.rating} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid cols-2">
        <div className="panel">
          <div className="panel-head">
            <h2>Business numbers</h2>
            <Link to="/kpis" className="btn btn-sm btn-ghost">Targets <ArrowRight size={14} /></Link>
          </div>
          <div className="table-wrap" style={{ padding: '6px 8px 8px' }}>
            <table className="t">
              <thead><tr><th>Metric</th><th className="r">This period</th><th className="r">Before</th></tr></thead>
              <tbody>
                {data.business.filter((m) => m.value !== null || m.previous !== null).map((m) => {
                  const diff = m.value !== null && m.previous !== null ? m.value - m.previous : null;
                  const good = diff === null ? '' : (diff > 0) === m.higher_is_better ? 'up' : diff === 0 ? '' : 'down';
                  return (
                    <tr key={m.id}>
                      <td>{m.name}{m.unit && <span className="faint"> ({m.unit})</span>}</td>
                      <td className={`r num ${good}`}>{fmt(m.value, 1)}</td>
                      <td className="r num muted">{fmt(m.previous, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.business.every((m) => m.value === null && m.previous === null) && (
              <p className="muted" style={{ padding: '12px' }}>No business numbers logged yet. Add revenue, leads or signups in <Link to="/update?tab=business">Daily update</Link>.</p>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Open actions</h2>
            <Link to="/review" className="btn btn-sm btn-ghost">Action plan <ArrowRight size={14} /></Link>
          </div>
          <div className="panel-pad" style={{ paddingTop: 6 }}>
            {data.actions.length === 0 && <p className="muted" style={{ padding: '12px 0' }}>No open actions. Add next month's plan in Monthly review.</p>}
            {data.actions.map((x) => {
              const overdue = x.deadline && x.deadline < today.date;
              return (
                <div className="insight" key={x.id}>
                  <span className="mark" style={{ background: overdue ? 'var(--loss)' : 'var(--signal)' }} />
                  <div style={{ flex: 1 }}>
                    <div>{x.title}</div>
                    <div className="faint" style={{ fontSize: 12.5 }}>
                      {x.brand || 'All accounts'}{x.owner && ` · ${x.owner}`}
                    </div>
                  </div>
                  {x.deadline && <span className={`badge ${overdue ? 'badge-bad' : ''}`}>{overdue ? 'Overdue ' : 'Due '}{prettyDate(x.deadline, { day: 'numeric', month: 'short' })}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
