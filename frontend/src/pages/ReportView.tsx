import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Download, Printer } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { download } from '../api';
import { useData, useToast, Loading, ErrorBox, fmt, signed, tone, prettyDate, accountColor, Stars } from '../lib';

interface Report {
  id: number; title: string; kind: string; start_date: string; end_date: string; created_at: string;
  data: {
    totals: { end_followers: number; net_change: number; growth_pct: number | null; posts_added: number; reach: number; impressions: number; engagement_rate: number | null; response_rate: number | null; two_factor_coverage: number | null };
    accounts: { id: number; brand: string; username: string; color: string | null; start_followers: number | null; end_followers: number | null; net_change: number | null; growth_pct: number | null; posts_added: number | null; reach: number; engagement_rate: number | null; rating: number | null }[];
    checklist: { pct: number | null };
    kpis: { id: number; name: string; unit: string | null; value: number | null; target: number | null; previous: number | null; status: string | null }[];
    insights: { tone: string; text: string }[];
    reviews: { brand: string; best_post: string | null; why_worked: string | null; weakest: string | null; fix_next: string | null }[];
    summary: { what_worked: string | null; what_didnt: string | null; what_change: string | null } | null;
    actions: { title: string; brand: string | null; owner: string | null; deadline: string | null; done: boolean }[];
  };
}

export default function ReportView() {
  const { id } = useParams();
  const toast = useToast();
  const { data: r, error, loading, reload } = useData<Report>(`/reports/${id}`);
  if (loading && !r) return <Loading />;
  if (error || !r) return <ErrorBox error={error || ''} retry={reload} />;
  const d = r.data;
  const t = d.totals;

  return (
    <>
      <div className="page-head">
        <Link to="/reports" className="btn btn-ghost btn-sm" style={{ marginLeft: -8 }}><ChevronLeft size={16} /> Reports</Link>
        <div className="page-actions">
          <button className="btn" onClick={() => window.print()}><Printer /> Print</button>
          <button className="btn btn-primary" onClick={() => download(`/reports/${r.id}/pdf`, `${r.title}.pdf`).catch((e) => toast(e.message, true))}><Download /> Download PDF</button>
        </div>
      </div>
      <article className="report-sheet">
        <header className="report-top">
          <h1 style={{ color: '#fff' }}>{r.title}</h1>
          <p>{prettyDate(r.start_date, { day: 'numeric', month: 'long', year: 'numeric' })} to {prettyDate(r.end_date, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </header>
        <div className="report-body">
          <div className="kpis" style={{ margin: 0 }}>
            <div className="kpi" style={{ padding: 0 }}><div className="k">Total followers</div><div className="v">{fmt(t.end_followers)}</div></div>
            <div className="kpi" style={{ padding: 0 }}><div className="k">Net change</div><div className={`v ${tone(t.net_change)}`}>{signed(t.net_change)}</div><div className="d muted">{t.growth_pct !== null ? `${t.growth_pct}% growth` : ''}</div></div>
            <div className="kpi" style={{ padding: 0 }}><div className="k">Posts published</div><div className="v">{fmt(t.posts_added)}</div></div>
            <div className="kpi" style={{ padding: 0 }}><div className="k">Engagement rate</div><div className="v">{t.engagement_rate !== null ? `${t.engagement_rate}%` : '—'}</div><div className="d muted">Reach {fmt(t.reach)}</div></div>
          </div>
          <p className="muted">DMs answered {t.response_rate !== null ? `${t.response_rate}%` : '—'} · Checklist completed {d.checklist?.pct !== null ? `${d.checklist.pct}%` : '—'} · 2FA on {t.two_factor_coverage ?? '—'}% of accounts</p>

          <section>
            <h2 style={{ marginBottom: 10 }}>Followers gained by account</h2>
            <div style={{ height: Math.max(160, d.accounts.length * 34) }}>
              <ResponsiveContainer>
                <BarChart data={d.accounts} layout="vertical" margin={{ left: 10, right: 30 }}>
                  <CartesianGrid stroke="#edf0f3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="brand" width={170} tick={{ fontSize: 12.5 }} />
                  <Tooltip formatter={(v: number) => [signed(v), 'Net followers']} contentStyle={{ borderRadius: 10, fontSize: 13 }} />
                  <Bar dataKey="net_change" radius={[0, 4, 4, 0]} maxBarSize={20}>
                    {d.accounts.map((a) => <Cell key={a.id} fill={accountColor(a)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section>
            <h2 style={{ marginBottom: 6 }}>Growth by account</h2>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Account</th><th className="r">Start</th><th className="r">End</th><th className="r">Net</th><th className="r">Growth</th><th className="r">Posts</th><th className="r">Reach</th><th className="r">Eng.</th><th>Rating</th></tr></thead>
                <tbody>{d.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.brand}<div className="acct-user">@{a.username}</div></td>
                    <td className="r num">{fmt(a.start_followers)}</td><td className="r num">{fmt(a.end_followers)}</td>
                    <td className={`r num ${tone(a.net_change)}`}>{signed(a.net_change)}</td>
                    <td className="r num">{a.growth_pct !== null ? `${a.growth_pct}%` : '—'}</td>
                    <td className="r num">{fmt(a.posts_added)}</td><td className="r num">{fmt(a.reach)}</td>
                    <td className="r num">{a.engagement_rate !== null ? `${a.engagement_rate}%` : '—'}</td>
                    <td><Stars n={a.rating} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>

          {d.kpis.length > 0 && (
            <section>
              <h2 style={{ marginBottom: 6 }}>Key numbers</h2>
              <table className="t">
                <thead><tr><th>Metric</th><th className="r">Target</th><th className="r">Actual</th><th className="r">Last period</th><th>Status</th></tr></thead>
                <tbody>{d.kpis.map((k) => (
                  <tr key={k.id}><td>{k.name}{k.unit && <span className="faint"> ({k.unit})</span>}</td><td className="r num">{fmt(k.target, 1)}</td><td className="r num"><b>{fmt(k.value, 1)}</b></td><td className="r num muted">{fmt(k.previous, 1)}</td>
                    <td>{k.status === 'on' ? <span className="badge badge-good">On track</span> : k.status === 'off' ? <span className="badge badge-warn">Off track</span> : '—'}</td></tr>
                ))}</tbody>
              </table>
            </section>
          )}

          {d.insights.length > 0 && (
            <section>
              <h2 style={{ marginBottom: 4 }}>What the numbers say</h2>
              {d.insights.map((i, k) => (
                <div className="insight" key={k}><span className="mark" style={{ background: i.tone === 'good' ? 'var(--growth)' : i.tone === 'info' ? 'var(--signal)' : 'var(--loss)' }} /><span>{i.text}</span></div>
              ))}
            </section>
          )}

          {d.reviews.some((x) => x.best_post || x.fix_next) && (
            <section>
              <h2 style={{ marginBottom: 6 }}>Account-wise analysis</h2>
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Account</th><th>Best post</th><th>Why it worked</th><th>Weakest / issue</th><th>Fix for next month</th></tr></thead>
                <tbody>{d.reviews.map((x, i) => <tr key={i}><td>{x.brand}</td><td>{x.best_post}</td><td>{x.why_worked}</td><td>{x.weakest}</td><td>{x.fix_next}</td></tr>)}</tbody>
              </table></div>
            </section>
          )}

          {d.summary && (d.summary.what_worked || d.summary.what_didnt || d.summary.what_change) && (
            <section className="grid cols-3">
              {([['What worked', d.summary.what_worked], ['What did not', d.summary.what_didnt], ['What to change', d.summary.what_change]] as const).map(([l, v]) => (
                <div key={l}><h3 style={{ marginBottom: 4 }}>{l}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{v || '—'}</p></div>
              ))}
            </section>
          )}

          {d.actions.length > 0 && (
            <section>
              <h2 style={{ marginBottom: 6 }}>Action plan</h2>
              <table className="t"><thead><tr><th>Action</th><th>Account</th><th>Owner</th><th>Deadline</th><th>Done</th></tr></thead>
                <tbody>{d.actions.map((a, i) => <tr key={i}><td>{a.title}</td><td>{a.brand || 'All'}</td><td>{a.owner || '—'}</td><td>{a.deadline ? prettyDate(a.deadline, { day: 'numeric', month: 'short' }) : '—'}</td><td>{a.done ? <span className="badge badge-good">Done</span> : <span className="badge">Open</span>}</td></tr>)}</tbody>
              </table>
            </section>
          )}
        </div>
      </article>
    </>
  );
}
