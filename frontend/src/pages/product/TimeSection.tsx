import { useState, type FormEvent } from 'react';
import { Clock, Play, Plus, Square, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useAuth, useData, useToast, todayStr, timeAgo } from '../../lib';
import { fmtMinutes, useElapsed, useTimer } from '../../timer';

interface Entry { id: number; user_id: number; user_name: string; started_at: string; ended_at: string | null; minutes: number; source: string; note: string | null }

/** Time tracked on one task: start/stop timer, manual entry, and the log. */
export function TimeSection({ taskId, open, canTrack, onChange }: { taskId: number; open: boolean; canTrack: boolean; onChange: () => void }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const timer = useTimer();
  const { data, reload } = useData<{ total: number; entries: Entry[] }>(`/time/task/${taskId}`);
  const runningHere = timer.running?.task_id === taskId;
  const elapsed = useElapsed(runningHere ? timer.running?.started_at : null);
  const [manual, setManual] = useState(false);
  const [f, setF] = useState({ hours: '', minutes: '', date: todayStr(), note: '' });
  const [showLog, setShowLog] = useState(false);

  async function toggle() {
    if (runningHere) await timer.stop(); else await timer.start(taskId);
    reload(); onChange();
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const minutes = (Number(f.hours) || 0) * 60 + (Number(f.minutes) || 0);
    try {
      await api.post('/time/manual', { task_id: taskId, minutes, date: f.date, note: f.note || null });
      toast(`Logged ${fmtMinutes(minutes)}`);
      setManual(false); setF({ hours: '', minutes: '', date: todayStr(), note: '' }); reload(); onChange();
    } catch (err) { toast((err as Error).message, true); }
  }
  async function remove(id: number) {
    try { await api.del(`/time/${id}`); reload(); } catch (err) { toast((err as Error).message, true); }
  }

  const total = data?.total ?? 0;
  return (
    <div className="time-box">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 8 }}>
          <Clock size={17} className="muted" />
          <b>Time spent</b>
          <span className="num">{fmtMinutes(total)}</span>
          {data && data.entries.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide log' : `Log (${data.entries.length})`}</button>}
        </div>
        {canTrack && open && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setManual((v) => !v)}><Plus size={14} /> Add time</button>
            <button className={`btn btn-sm ${runningHere ? 'btn-stop' : 'btn-primary'}`} onClick={toggle}>
              {runningHere ? <><Square size={13} /> Stop <span className="num">{elapsed}</span></> : <><Play size={13} /> Start timer</>}
            </button>
          </div>
        )}
      </div>
      {manual && (
        <form className="time-form" onSubmit={save}>
          <div className="field"><label htmlFor="th">Hours</label><input id="th" className="input" type="number" min={0} max={10} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></div>
          <div className="field"><label htmlFor="tm">Minutes</label><input id="tm" className="input" type="number" min={0} max={59} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></div>
          <div className="field"><label htmlFor="td">Date</label><input id="td" className="input" type="date" max={todayStr()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="field grow"><label htmlFor="tn">Note</label><input id="tn" className="input" placeholder="Optional" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn btn-primary" disabled={!(Number(f.hours) || Number(f.minutes))}>Save</button>
        </form>
      )}
      {showLog && data && (
        <ul className="time-log">
          {data.entries.map((e) => (
            <li key={e.id}>
              <span><b>{fmtMinutes(e.minutes)}</b> · {e.user_name}{e.note && <span className="faint"> · {e.note}</span>}</span>
              <span className="faint">{e.ended_at ? timeAgo(e.started_at) : 'running'}{e.source === 'manual' ? ' · added' : ''}</span>
              {(e.user_id === user?.id || can('admin')) && e.ended_at && <button className="btn btn-ghost btn-icon" aria-label="Delete entry" onClick={() => remove(e.id)}><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
