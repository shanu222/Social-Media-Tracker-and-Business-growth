import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, FileBarChart, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox, AccountLabel, todayStr, shiftMonth, prettyMonth, prettyDate, Stars } from '../lib';

interface AccRev { account_id: number; brand: string; username: string; best_post: string | null; why_worked: string | null; weakest: string | null; fix_next: string | null; rating: number | null }
interface Action { id: number; title: string; account_id: number | null; brand: string | null; owner: string | null; deadline: string | null; done: boolean; month: string | null }
interface Data { month: string; accounts: AccRev[]; summary: { what_worked?: string | null; what_didnt?: string | null; what_change?: string | null }; actions: Action[] }

const FIELDS = [['best_post', 'Best post this month'], ['why_worked', 'Why it worked'], ['weakest', 'Weakest post / issue'], ['fix_next', 'Fix for next month']] as const;

export default function Review() {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const { data, setData, error, loading, reload } = useData<Data>(`/reviews?month=${month}`);
  const [summary, setSummary] = useState({ what_worked: '', what_didnt: '', what_change: '' });
  const [open, setOpen] = useState<number | null>(null);
  const editable = can('manager');
  const cur = todayStr().slice(0, 7);

  useEffect(() => {
    if (data) setSummary({ what_worked: data.summary.what_worked || '', what_didnt: data.summary.what_didnt || '', what_change: data.summary.what_change || '' });
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;

  async function saveAccount(r: AccRev) {
    try {
      await api.put('/reviews/account', { ...r, month });
      toast(`Saved review for ${r.brand}`);
      setOpen(null);
    } catch (e) { toast((e as Error).message, true); }
  }
  async function saveSummary() {
    try { await api.put('/reviews/summary', { month, ...summary }); toast('Summary saved'); } catch (e) { toast((e as Error).message, true); }
  }
  async function generate() {
    try {
      const r = await api.post<{ id: number }>('/reports', { kind: 'monthly', month });
      toast('Report generated');
      nav(`/reports/${r.id}`);
    } catch (e) { toast((e as Error).message, true); }
  }
  const updateRow = (id: number, patch: Partial<AccRev>) =>
    setData((d) => d && { ...d, accounts: d.accounts.map((a) => (a.account_id === id ? { ...a, ...patch } : a)) });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Monthly review</h1>
          <p>Look back on each account, write what worked, and plan next month's actions. All of it goes into the monthly report.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
          <span style={{ minWidth: 130, textAlign: 'center', fontWeight: 500 }}>{prettyMonth(month)}</span>
          <button className="btn btn-icon" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= cur} aria-label="Next month"><ChevronRight size={18} /></button>
          {editable && <button className="btn btn-dark" onClick={generate}><FileBarChart /> Generate monthly report</button>}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head"><div><h2>Account-wise analysis</h2><p>Select an account to write its review.</p></div></div>
        <div style={{ padding: '6px 20px 14px' }}>
          {data.accounts.map((r) => {
            const filled = FIELDS.filter(([k]) => r[k]).length;
            const isOpen = open === r.account_id;
            return (
              <div key={r.account_id} style={{ borderBottom: '1px solid var(--line-2)', padding: '10px 0' }}>
                <button className="row" style={{ width: '100%', background: 'none', border: 0, padding: 0, cursor: 'pointer', justifyContent: 'space-between', textAlign: 'left' }} onClick={() => setOpen(isOpen ? null : r.account_id)} aria-expanded={isOpen}>
                  <AccountLabel a={{ id: r.account_id, brand: r.brand, username: r.username }} />
                  <span className="row"><Stars n={r.rating} /><span className={`badge ${filled === 4 ? 'badge-good' : ''}`}>{filled}/4 written</span></span>
                </button>
                {isOpen && (
                  <div className="form-grid" style={{ marginTop: 14 }}>
                    {FIELDS.map(([k, label]) => (
                      <div className="field" key={k}>
                        <label htmlFor={`${k}${r.account_id}`}>{label}</label>
                        <textarea id={`${k}${r.account_id}`} className="input" disabled={!editable} value={r[k] || ''} onChange={(e) => updateRow(r.account_id, { [k]: e.target.value })} />
                      </div>
                    ))}
                    <div className="field">
                      <label htmlFor={`rating${r.account_id}`}>Rating for the month</label>
                      <select id={`rating${r.account_id}`} className="input" disabled={!editable} value={r.rating ?? ''} onChange={(e) => updateRow(r.account_id, { rating: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">Not rated</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
                      </select>
                    </div>
                    {editable && <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={() => saveAccount(r)}><Save /> Save review</button></div>}
                  </div>
                )}
              </div>
            );
          })}
          {data.accounts.length === 0 && <p className="muted" style={{ padding: 12 }}>Add accounts first to review them.</p>}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <div className="panel-head"><h2>Overall summary</h2>{editable && <button className="btn btn-sm" onClick={saveSummary}><Save size={14} /> Save</button>}</div>
          <div className="stack" style={{ padding: 20, gap: 12 }}>
            {([['what_worked', 'What worked'], ['what_didnt', 'What did not'], ['what_change', 'What to change']] as const).map(([k, l]) => (
              <div className="field" key={k}><label htmlFor={k}>{l}</label><textarea id={k} className="input" disabled={!editable} value={summary[k]} onChange={(e) => setSummary((s) => ({ ...s, [k]: e.target.value }))} /></div>
            ))}
          </div>
        </div>
        <ActionPlan month={month} actions={data.actions} accounts={data.accounts} editable={editable} reload={reload} />
      </div>
    </>
  );
}

function ActionPlan({ month, actions, accounts, editable, reload }: { month: string; actions: Action[]; accounts: AccRev[]; editable: boolean; reload: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', account_id: '', owner: '', deadline: '' });

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/reviews/actions', { ...f, account_id: f.account_id ? Number(f.account_id) : null, month });
      setF({ title: '', account_id: '', owner: '', deadline: '' });
      reload();
    } catch (err) { toast((err as Error).message, true); }
  }
  async function toggle(a: Action) {
    try { await api.put(`/reviews/actions/${a.id}`, { ...a, done: !a.done }); reload(); } catch (e) { toast((e as Error).message, true); }
  }
  async function remove(a: Action) {
    try { await api.del(`/reviews/actions/${a.id}`); reload(); } catch (e) { toast((e as Error).message, true); }
  }

  return (
    <div className="panel">
      <div className="panel-head"><div><h2>Action plan</h2><p>Unfinished actions from earlier months carry over.</p></div></div>
      <div style={{ padding: '6px 20px 16px' }}>
        {actions.map((a) => (
          <div key={a.id} className="insight" style={{ alignItems: 'center' }}>
            <button className={`tick ${a.done ? 'on' : ''}`} disabled={!editable} onClick={() => toggle(a)} aria-pressed={a.done} aria-label={a.title}>{a.done && <Check strokeWidth={3} />}</button>
            <div style={{ flex: 1 }}>
              <div style={a.done ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{a.title}</div>
              <div className="faint" style={{ fontSize: 12.5 }}>{a.brand || 'All accounts'}{a.owner && ` · ${a.owner}`}{a.deadline && ` · due ${prettyDate(a.deadline, { day: 'numeric', month: 'short' })}`}{a.month && a.month !== month && ` · from ${prettyMonth(a.month)}`}</div>
            </div>
            {editable && <button className="btn btn-ghost btn-icon btn-danger" onClick={() => remove(a)} aria-label={`Delete ${a.title}`}><Trash2 size={15} /></button>}
          </div>
        ))}
        {actions.length === 0 && <p className="muted" style={{ padding: '10px 0' }}>No actions yet.</p>}
        {editable && (
          <form onSubmit={add} className="form-grid" style={{ marginTop: 14 }}>
            <div className="field full"><label htmlFor="at">New action</label><input id="at" className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Post 3 Reels a week on Shopwalk" /></div>
            <div className="field"><label htmlFor="aa">Account</label>
              <select id="aa" className="input" value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}><option value="">All accounts</option>{accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.brand}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="ao">Owner</label><input id="ao" className="input" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></div>
            <div className="field"><label htmlFor="ad">Deadline</label><input id="ad" type="date" className="input" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}><button className="btn btn-primary"><Plus /> Add action</button></div>
          </form>
        )}
      </div>
    </div>
  );
}
