import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Pencil, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth, useData, Loading, ErrorBox, fmt, signed, tone, prettyDate, prettyMonth, accountColor, Stars, type Account } from '../lib';
import { AccountForm } from './Accounts';

interface Snap { date: string; followers: number | null; following: number | null; posts: number | null; likes: number | null; comments: number | null; reach: number | null; dms_received: number | null; dms_answered: number | null; notes: string | null }
interface Review { month: string; best_post: string | null; why_worked: string | null; weakest: string | null; fix_next: string | null; rating: number | null }

export default function AccountDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const { data, error, loading, reload } = useData<{ account: Account; history: Snap[]; reviews: Review[] }>(`/accounts/${id}`);
  const [editing, setEditing] = useState(false);

  const stats = useMemo(() => {
    if (!data) return null;
    const h = data.history.filter((s) => s.followers !== null);
    const last = h.at(-1);
    const first = h[0];
    const ago = (n: number) => {
      if (!last) return null;
      const cutoff = new Date(last.date + 'T00:00:00Z');
      cutoff.setUTCDate(cutoff.getUTCDate() - n);
      const c = cutoff.toISOString().slice(0, 10);
      const row = [...h].reverse().find((s) => s.date <= c);
      return row && last.followers !== null && row.followers !== null ? last.followers - row.followers : null;
    };
    return { last, first, d7: ago(7), d30: ago(30), total: last && first ? (last.followers! - first.followers!) : null };
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data || !stats) return <ErrorBox error={error || ''} retry={reload} />;
  const a = data.account;
  const color = accountColor(a);

  return (
    <>
      <Link to="/accounts" className="btn btn-ghost btn-sm" style={{ marginBottom: 10, marginLeft: -8 }}><ChevronLeft size={16} /> Accounts</Link>
      <div className="page-head">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="acct-dot" style={{ background: color, width: 14, height: 14 }} />{a.brand}</h1>
          <p>@{a.username} on {a.platform} · tracking since {prettyDate(a.baseline_date, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="page-actions">
          {a.two_factor_enabled ? <span className="badge badge-good"><ShieldCheck size={13} /> 2FA on</span> : <span className="badge badge-bad"><ShieldAlert size={13} /> 2FA off</span>}
          {can('manager') && <button className="btn" onClick={() => setEditing(true)}><Pencil /> Edit</button>}
        </div>
      </div>

      <div className="kpis">
        <div className="panel kpi"><div className="k">Followers now</div><div className="v">{fmt(stats.last?.followers)}</div><div className="d muted">Started at {fmt(a.baseline_followers)}</div></div>
        <div className="panel kpi"><div className="k">Last 7 days</div><div className={`v ${tone(stats.d7)}`}>{signed(stats.d7)}</div><div className="d muted">followers</div></div>
        <div className="panel kpi"><div className="k">Last 30 days</div><div className={`v ${tone(stats.d30)}`}>{signed(stats.d30)}</div><div className="d muted">followers</div></div>
        <div className="panel kpi"><div className="k">Posts</div><div className="v">{fmt(stats.last?.posts ?? a.baseline_posts)}</div><div className="d muted">{signed((stats.last?.posts ?? a.baseline_posts) - a.baseline_posts)} since tracking began</div></div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head"><h2>Follower history</h2></div>
        <div style={{ height: 260, padding: '12px 12px 8px 0' }}>
          {data.history.length < 2 ? (
            <p className="muted" style={{ padding: 20 }}>Log at least two days of numbers to see the trend.</p>
          ) : (
            <ResponsiveContainer>
              <AreaChart data={data.history.filter((s) => s.followers !== null)}>
                <defs>
                  <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.22} /><stop offset="1" stopColor={color} stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="#edf0f3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => prettyDate(d, { day: 'numeric', month: 'short' })} tick={{ fontSize: 12, fill: '#5e6a7c' }} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis tick={{ fontSize: 12, fill: '#5e6a7c' }} tickLine={false} axisLine={false} width={44} domain={['dataMin - 2', 'dataMax + 2']} allowDecimals={false} />
                <Tooltip labelFormatter={(d) => prettyDate(String(d), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} formatter={(v: number) => [fmt(v), 'Followers']} contentStyle={{ borderRadius: 10, fontSize: 13 }} />
                <Area dataKey="followers" stroke={color} strokeWidth={2.2} fill="url(#fill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <div className="panel-head"><h2>Daily log</h2></div>
          <div className="table-wrap" style={{ padding: 8, maxHeight: 460, overflowY: 'auto' }}>
            <table className="t">
              <thead><tr><th>Date</th><th className="r">Followers</th><th className="r">Change</th><th className="r">Posts</th><th className="r">Reach</th><th className="r">Likes</th><th>Notes</th></tr></thead>
              <tbody>
                {[...data.history].reverse().map((s, i, arr) => {
                  const prev = arr.slice(i + 1).find((x) => x.followers !== null);
                  const ch = s.followers !== null && prev?.followers !== null && prev ? s.followers - prev.followers! : null;
                  return (
                    <tr key={s.date}>
                      <td style={{ whiteSpace: 'nowrap' }}>{prettyDate(s.date)}</td>
                      <td className="r num">{fmt(s.followers)}</td>
                      <td className={`r num ${tone(ch)}`}>{signed(ch)}</td>
                      <td className="r num">{fmt(s.posts)}</td>
                      <td className="r num">{fmt(s.reach)}</td>
                      <td className="r num">{fmt(s.likes)}</td>
                      <td className="muted" style={{ maxWidth: 220 }}>{s.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="stack">
          <div className="panel panel-pad">
            <h2 style={{ marginBottom: 10 }}>Details</h2>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: 14 }}>
              <dt className="muted">YouTube</dt><dd style={{ margin: 0 }}>{a.youtube_status || '—'}</dd>
              <dt className="muted">Theme</dt><dd style={{ margin: 0 }}>{a.content_theme || '—'}</dd>
              {a.login_email !== null && <><dt className="muted">Login email</dt><dd style={{ margin: 0 }}>{a.login_email || '—'}</dd></>}
              {a.profile_url && <><dt className="muted">Profile</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}><a href={a.profile_url} target="_blank" rel="noreferrer noopener">{a.profile_url}</a></dd></>}
            </dl>
            {a.private_notes && <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }} className="muted">{a.private_notes}</p>}
          </div>
          <div className="panel panel-pad">
            <h2 style={{ marginBottom: 6 }}>Monthly reviews</h2>
            {data.reviews.length === 0 && <p className="muted">No reviews yet. Write one in <Link to="/review">Monthly review</Link>.</p>}
            {data.reviews.map((r) => (
              <div key={r.month} className="insight" style={{ flexDirection: 'column', gap: 4 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><strong>{prettyMonth(r.month)}</strong><Stars n={r.rating} /></div>
                {r.best_post && <div><span className="muted">Best: </span>{r.best_post}</div>}
                {r.fix_next && <div><span className="muted">Next: </span>{r.fix_next}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
      {editing && <AccountForm account={a} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} onDeleted={() => nav('/accounts')} />}
    </>
  );
}
