import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Copy, Save } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, AccountLabel, PlatformChip, todayStr, shiftDate, prettyDate, signed, tone } from '../lib';

const CORE = [['followers', 'Followers'], ['following', 'Following'], ['posts', 'Posts']] as const;
const EXTRA = [
  ['likes', 'Likes'], ['comments', 'Comments'], ['reach', 'Reach'], ['dms_received', 'DMs in'], ['dms_answered', 'DMs answered'],
  ['shares', 'Shares'], ['impressions', 'Impressions'], ['profile_visits', 'Profile visits'],
] as const;
type Field = (typeof CORE)[number][0] | (typeof EXTRA)[number][0];

interface DayRow {
  account_id: number; brand: string; username: string; platform: string; color: string | null; sync_enabled: boolean; product_name: string | null;
  entry: (Record<Field, number | null> & { notes: string | null }) | null;
  previous: { date: string; followers: number | null; following: number | null; posts: number | null } | null;
}
type Draft = Record<number, Partial<Record<Field | 'notes', string>>>;

export default function DailyUpdate() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'business' ? 'business' : 'social';
  const [date, setDate] = useState(params.get('date') || todayStr());
  const today = todayStr();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Daily update</h1>
          <p>Enter today's numbers from each app. Blank fields are skipped; you can come back and edit any day.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-icon" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
          <input type="date" className="input" style={{ width: 160 }} value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
          <button className="btn btn-icon" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= today} aria-label="Next day"><ChevronRight size={18} /></button>
          {date !== today && <button className="btn" onClick={() => setDate(today)}>Today</button>}
        </div>
      </div>
      <div className="seg" style={{ marginBottom: 16 }} role="tablist">
        <button className={tab === 'social' ? 'on' : ''} onClick={() => setParams({})} role="tab" aria-selected={tab === 'social'}>Social accounts</button>
        <button className={tab === 'business' ? 'on' : ''} onClick={() => setParams({ tab: 'business' })} role="tab" aria-selected={tab === 'business'}>Business numbers</button>
      </div>
      {tab === 'social' ? <SocialSheet date={date} /> : <BusinessSheet date={date} />}
    </>
  );
}

function SocialSheet({ date }: { date: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('manager');
  const { data, error, loading, reload } = useData<{ date: string; rows: DayRow[] }>(`/snapshots/day?date=${date}`);
  const [draft, setDraft] = useState<Draft>({});
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showAuto, setShowAuto] = useState(false);

  useEffect(() => {
    if (!data) return;
    const d: Draft = {};
    for (const r of data.rows) {
      d[r.account_id] = {};
      for (const [f] of [...CORE, ...EXTRA]) {
        const v = r.entry?.[f];
        d[r.account_id][f] = v === null || v === undefined ? '' : String(v);
      }
      d[r.account_id].notes = r.entry?.notes || '';
    }
    setDraft(d);
    setDirty(false);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;
  if (data.rows.length === 0)
    return (
      <div className="panel empty">
        <h3>No accounts yet</h3>
        <p>Register your social accounts first, then log their numbers here every day.</p>
        <Link to="/accounts" className="btn btn-primary">Add accounts</Link>
      </div>
    );

  const set = (id: number, f: Field | 'notes', v: string) => {
    if (f !== 'notes' && v !== '' && !/^\d+$/.test(v)) return;
    setDraft((d) => ({ ...d, [id]: { ...d[id], [f]: v } }));
    setDirty(true);
  };

  const copyPrevious = () => {
    setDraft((d) => {
      const n = { ...d };
      for (const r of data.rows) {
        if (!r.previous) continue;
        n[r.account_id] = { ...n[r.account_id] };
        for (const f of ['followers', 'following', 'posts'] as const) {
          if (!n[r.account_id][f] && r.previous[f] !== null) n[r.account_id][f] = String(r.previous[f]);
        }
      }
      return n;
    });
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      const rows = data!.rows.map((r) => {
        const d = draft[r.account_id] || {};
        const o: Record<string, unknown> = { account_id: r.account_id, notes: d.notes || null };
        for (const [f] of [...CORE, ...EXTRA]) o[f] = d[f] === '' || d[f] === undefined ? null : Number(d[f]);
        return o;
      });
      const res = await api.put<{ saved: number }>('/snapshots/day', { date, rows });
      toast(`Saved numbers for ${res.saved} ${res.saved === 1 ? 'account' : 'accounts'}`);
      setDirty(false);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  const cols = more ? [...CORE, ...EXTRA] : CORE;
  const autoRows = data.rows.filter((r) => r.sync_enabled);
  const rows = showAuto ? data.rows : data.rows.filter((r) => !r.sync_enabled);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>{prettyDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <p>Type today's followers, following and posts. Grey numbers are the last ones logged.{autoRows.length > 0 && !showAuto && <> {autoRows.length} account{autoRows.length > 1 ? 's update' : ' updates'} automatically and {autoRows.length > 1 ? 'are' : 'is'} hidden — <button className="btn btn-ghost btn-sm" style={{ padding: '0 4px', height: 'auto' }} onClick={() => setShowAuto(true)}>show</button>.</>}</p>
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} /> Likes, reach & DMs</label>
          {editable && <button className="btn" onClick={copyPrevious}><Copy /> Copy last counts</button>}
          {editable && <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}><Save /> {saving ? 'Saving…' : 'Save numbers'}</button>}
        </div>
      </div>
      <div className="table-wrap" style={{ padding: '10px 8px 6px' }}>
        <table className="t">
          <thead>
            <tr>
              <th>Account</th>
              {cols.map(([f, l]) => <th key={f} className="r">{l}</th>)}
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = draft[r.account_id] || {};
              const change = d.followers && r.previous?.followers !== null && r.previous?.followers !== undefined ? Number(d.followers) - r.previous.followers : null;
              return (
                <tr key={r.account_id}>
                  <td style={{ minWidth: 190 }}>
                    <AccountLabel a={{ id: r.account_id, brand: r.brand, username: r.username, color: r.color }} />
                    <div className="row" style={{ gap: 4, marginTop: 2 }}><PlatformChip id={r.platform} small />{r.sync_enabled && <span className="badge badge-good">Auto</span>}</div>
                    {change !== null && <div className={`num ${tone(change)}`} style={{ fontSize: 12.5, marginTop: 2 }}>{signed(change)} since {prettyDate(r.previous!.date, { day: 'numeric', month: 'short' })}</div>}
                  </td>
                  {cols.map(([f, l]) => {
                    const prev = r.previous && (f === 'followers' || f === 'following' || f === 'posts') ? r.previous[f] : null;
                    return (
                      <td key={f} className="r" style={{ minWidth: 92 }}>
                        <input
                          className="input input-num"
                          inputMode="numeric"
                          aria-label={`${r.brand} ${l}`}
                          placeholder={prev !== null && prev !== undefined ? String(prev) : ''}
                          value={d[f] ?? ''}
                          onChange={(e) => set(r.account_id, f, e.target.value.trim())}
                          disabled={!editable}
                        />
                      </td>
                    );
                  })}
                  <td style={{ minWidth: 180 }}>
                    <input className="input" aria-label={`${r.brand} notes`} value={d.notes ?? ''} onChange={(e) => set(r.account_id, 'notes', e.target.value)} disabled={!editable} placeholder="Best post, issues…" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface MetricRow { id: number; name: string; category: string; unit: string | null; value: number | null; note: string | null; aggregation: string }

function BusinessSheet({ date }: { date: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('manager');
  const { data, error, loading, reload } = useData<{ date: string; rows: MetricRow[] }>(`/metrics/day?date=${date}`);
  const [vals, setVals] = useState<Record<number, { value: string; note: string }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setVals(Object.fromEntries(data.rows.map((m) => [m.id, { value: m.value === null ? '' : String(m.value), note: m.note || '' }])));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;

  const groups = [...new Set(data.rows.map((m) => m.category))];

  async function save() {
    setSaving(true);
    try {
      await api.put('/metrics/day', {
        date,
        entries: data!.rows.map((m) => ({
          metric_id: m.id,
          value: vals[m.id]?.value === '' || vals[m.id]?.value === undefined ? null : Number(vals[m.id].value),
          note: vals[m.id]?.note || null,
        })),
      });
      toast('Saved business numbers');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Business numbers for {prettyDate(date, { day: 'numeric', month: 'long' })}</h2>
          <p>Log what happened today. Monthly totals and targets are on <Link to="/kpis">Targets & KPIs</Link>, where you can also add your own metrics.</p>
        </div>
        {editable && <button className="btn btn-primary" onClick={save} disabled={saving}><Save /> {saving ? 'Saving…' : 'Save numbers'}</button>}
      </div>
      <div className="grid cols-2" style={{ padding: 20 }}>
        {groups.map((g) => (
          <div key={g}>
            <h3 style={{ marginBottom: 8 }}>{g}</h3>
            <div className="stack" style={{ gap: 8 }}>
              {data.rows.filter((m) => m.category === g).map((m) => (
                <div key={m.id} className="row" style={{ flexWrap: 'nowrap' }}>
                  <label htmlFor={`m${m.id}`} style={{ flex: 1, minWidth: 0 }}>
                    {m.name}
                    <div className="faint" style={{ fontSize: 12 }}>{m.aggregation === 'last' ? 'Current total' : 'Count for today'}{m.unit ? ` · ${m.unit}` : ''}</div>
                  </label>
                  <input
                    id={`m${m.id}`}
                    className="input input-num"
                    style={{ width: 120 }}
                    inputMode="decimal"
                    value={vals[m.id]?.value ?? ''}
                    disabled={!editable}
                    onChange={(e) => /^-?\d*\.?\d*$/.test(e.target.value) && setVals((v) => ({ ...v, [m.id]: { ...v[m.id], value: e.target.value } }))}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
