import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Square, Timer } from 'lucide-react';
import { api } from './api';
import { useToast } from './lib';

export interface Running { id: number; task_id: number; product_id: number; started_at: string; task_title: string; product_name?: string }
interface Ctx { running: Running | null; start: (taskId: number) => Promise<void>; stop: () => Promise<void>; refresh: () => void }
const TimerCtx = createContext<Ctx>({ running: null, start: async () => {}, stop: async () => {}, refresh: () => {} });
export const useTimer = () => useContext(TimerCtx);

export function TimerProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [running, setRunning] = useState<Running | null>(null);
  const refresh = useCallback(() => { api.get<Running | null>('/time/running').then(setRunning).catch(() => {}); }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), 60000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(t); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  const start = useCallback(async (taskId: number) => {
    try { setRunning(await api.post<Running>('/time/start', { task_id: taskId })); refresh(); toast('Timer started'); } catch (e) { toast((e as Error).message, true); }
  }, [refresh, toast]);
  const stop = useCallback(async () => {
    try { const r = await api.post<{ minutes: number }>('/time/stop', {}); setRunning(null); toast(`Logged ${fmtMinutes(r.minutes)}`); } catch (e) { toast((e as Error).message, true); refresh(); }
  }, [refresh, toast]);
  return <TimerCtx.Provider value={{ running, start, stop, refresh }}>{children}</TimerCtx.Provider>;
}

export const fmtMinutes = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

export function useElapsed(since: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return '';
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Compact running-timer chip shown in the sidebar and mobile bar. */
export function TimerChip() {
  const { running, stop } = useTimer();
  const elapsed = useElapsed(running?.started_at);
  if (!running) return null;
  return (
    <div className="timer-chip" role="status">
      <Timer className="pulse" />
      <Link to={`/products/${running.product_id}?tab=tasks&task=${running.task_id}`} title={running.task_title}>
        <span className="num">{elapsed}</span>
        <span className="t">{running.task_title}</span>
      </Link>
      <button onClick={stop} aria-label="Stop timer"><Square size={13} /></button>
    </div>
  );
}
