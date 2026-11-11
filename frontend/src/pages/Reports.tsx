import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cloud, Download, FileSpreadsheet, Trash2 } from 'lucide-react';
import { api, download } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, fmt, signed, tone, todayStr, shiftDate, prettyDate } from '../lib';

interface Row { id: number; title: string; kind: string; start_date: string; end_date: string; in_cloud: boolean; created_at: string; created_by_name: string | null; followers: number | null; net_change: number | null }

export default function Reports() {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data, error, loading, reload } = useData<Row[]>('/reports');
  const [kind, setKind] = useState<'weekly' | 'monthly' | 'custom'>('monthly');
  const today = todayStr();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [weekOf, setWeekOf] = useState(today);
  const [start, setStart] = useState(shiftDate(today, -29));
  const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState({ start: shiftDate(today, -89), end: today });

  async function generate() {
    setBusy(true);
    try {
      const r = await api.post<{ id: number }>('/reports', { kind, month, weekOf, start, end });
      toast('Report generated');
      nav(`/reports/${r.id}`);
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  async function remove(r: Row) {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    try { await api.del(`/reports/${r.id}`); reload(); } catch (e) { toast((e as Error).message, true); }
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>Each report freezes the numbers for its period, so you can compare months later. Download as PDF to share with the team or clients.</p>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        {can('manager') && (
          <div className="panel panel-pad">
            <h2 style={{ marginBottom: 12 }}>Create a report</h2>
            <div className="seg" style={{ marginBottom: 14 }}>
              {(['weekly', 'monthly', 'custom'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
            </div>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              {kind === 'monthly' && <div className="field"><label htmlFor="rm">Month</label><input id="rm" type="month" className="input" max={today.slice(0, 7)} value={month} onChange={(e) => setMonth(e.target.value)} /></div>}
              {kind === 'weekly' && <div className="field"><label htmlFor="rw">Any day in the week</label><input id="rw" type="date" className="input" max={today} value={weekOf} onChange={(e) => setWeekOf(e.target.value)} /></div>}
              {kind === 'custom' && <>
                <div className="field"><label htmlFor="rs">From</label><input id="rs" type="date" className="input" value={start} max={end} onChange={(e) => setStart(e.target.value)} /></div>
                <div className="field"><label htmlFor="re">To</label><input id="re" type="date" className="input" value={end} max={today} onChange={(e) => setEnd(e.target.value)} /></div>
              </>}
              <button className="btn btn-primary" onClick={generate} disabled={busy}>{busy ? 'Generating…' : 'Generate report'}</button>
            </div>
            <p className="faint" style={{ marginTop: 10, fontSize: 12.5 }}>Monthly reports include KPI targets, the account reviews and the action plan.</p>
          </div>
        )}
        <div className="panel panel-pad">
          <h2 style={{ marginBottom: 12 }}>Export raw data</h2>
          <p className="muted" style={{ marginBottom: 12 }}>Every logged number for all accounts as a CSV file for Excel or Google Sheets.</p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field"><label htmlFor="cs">From</label><input id="cs" type="date" className="input" value={csv.start} onChange={(e) => setCsv({ ...csv, start: e.target.value })} /></div>
            <div className="field"><label htmlFor="ce">To</label><input id="ce" type="date" className="input" value={csv.end} max={today} onChange={(e) => setCsv({ ...csv, end: e.target.value })} /></div>
            <button className="btn" onClick={() => download(`/snapshots/export.csv?start=${csv.start}&end=${csv.end}`, `social-data-${csv.start}-to-${csv.end}.csv`).catch((e) => toast(e.message, true))}><FileSpreadsheet /> Download CSV</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Saved reports</h2></div>
        {data.length === 0 ? (
          <div className="empty"><h3>No reports yet</h3><p>Generate your first weekly or monthly report above.</p></div>
        ) : (
          <div className="table-wrap" style={{ padding: 8 }}>
            <table className="t">
              <thead><tr><th>Report</th><th>Period</th><th className="r">Followers</th><th className="r">Net</th><th>Created</th><th /></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/reports/${r.id}`} style={{ fontWeight: 500 }}>{r.title}</Link>{r.in_cloud && <span className="badge badge-info" style={{ marginLeft: 8 }} title="A PDF copy is stored in Cloudflare R2"><Cloud size={12} /> Saved to cloud</span>}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{prettyDate(r.start_date, { day: 'numeric', month: 'short' })} – {prettyDate(r.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="r num">{fmt(r.followers)}</td>
                    <td className={`r num ${tone(r.net_change)}`}>{signed(r.net_change)}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{r.created_by_name && ` by ${r.created_by_name}`}</td>
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-icon" onClick={() => download(`/reports/${r.id}/pdf`, `${r.title}.pdf`).catch((e) => toast(e.message, true))} aria-label="Download PDF"><Download size={16} /></button>
                      {can('admin') && <button className="btn btn-ghost btn-icon btn-danger" onClick={() => remove(r)} aria-label="Delete report"><Trash2 size={16} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
