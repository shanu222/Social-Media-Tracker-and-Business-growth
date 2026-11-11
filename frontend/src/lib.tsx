import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';
import { api, setToken, setUnauthorizedHandler, hasToken } from './api';

/* ---------------- Types ---------------- */
export type Role = 'admin' | 'manager' | 'viewer';
export interface User { id: number; email: string; name: string; role: Role; must_change_password?: boolean }
export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', manager: 'Social media manager', viewer: 'Viewer' };

export const PLATFORMS: { id: string; label: string; color: string }[] = [
  { id: 'instagram', label: 'Instagram', color: '#c13584' },
  { id: 'facebook', label: 'Facebook', color: '#1877f2' },
  { id: 'youtube', label: 'YouTube', color: '#e62117' },
  { id: 'linkedin', label: 'LinkedIn', color: '#0a66c2' },
  { id: 'discord', label: 'Discord', color: '#5865f2' },
  { id: 'telegram', label: 'Telegram', color: '#229ed9' },
  { id: 'tiktok', label: 'TikTok', color: '#111111' },
  { id: 'x', label: 'X', color: '#333333' },
  { id: 'threads', label: 'Threads', color: '#444444' },
  { id: 'pinterest', label: 'Pinterest', color: '#bd081c' },
  { id: 'whatsapp', label: 'WhatsApp', color: '#1f9d55' },
  { id: 'website', label: 'Website', color: '#0b7a62' },
  { id: 'other', label: 'Other', color: '#5e6a7c' },
];
export const platformOf = (id: string) => PLATFORMS.find((p) => p.id === id) || { id, label: id, color: '#5e6a7c' };

export function PlatformChip({ id, small }: { id: string; small?: boolean }) {
  const p = platformOf(id);
  return (
    <span className="pchip" style={{ ['--pc' as string]: p.color, fontSize: small ? 12 : undefined }}>
      <i />{p.label}
    </span>
  );
}

export const timeAgo = (d: string) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
export interface Account {
  id: number; brand: string; username: string; platform: string; profile_url: string | null;
  content_theme: string | null; youtube_status: string | null; two_factor_enabled: boolean;
  login_email: string | null; private_notes: string | null; baseline_date: string;
  baseline_posts: number; baseline_followers: number; baseline_following: number;
  color: string | null; archived: boolean;
  last_date?: string | null; last_followers?: number | null; last_following?: number | null;
  last_posts?: number | null; week_ago_followers?: number | null;
  product_id?: number | null; product_name?: string | null; external_id?: string | null; has_api_token?: boolean;
  sync_enabled?: boolean; can_sync?: boolean; last_synced_at?: string | null; sync_error?: string | null;
}

/* ---------------- Formatting ---------------- */
export const fmt = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
export const signed = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${fmt(n)}`;
export const compact = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const tone = (n: number | null | undefined) => (n ? (n > 0 ? 'up' : 'down') : '');

export function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
}
export function shiftDate(d: string, n: number) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export function shiftMonth(m: string, n: number) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
}
export const prettyDate = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
export const prettyMonth = (m: string) =>
  new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const PALETTE = ['#0b7a62', '#3346b0', '#c0562a', '#7a3fb0', '#b0870f', '#1f8bb0', '#b03a6b', '#4d6b1f', '#5e6a7c'];
export const accountColor = (a: { id: number; color?: string | null }) => a.color || PALETTE[(a.id - 1) % PALETTE.length];

/* ---------------- Auth ---------------- */
interface AuthState {
  user: User | null;
  ready: boolean;
  setUser: (u: User | null) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (role: Role) => boolean;
}
const AuthCtx = createContext<AuthState>(null!);
export const useAuth = () => useContext(AuthCtx);
const RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (!hasToken()) {
      setReady(true);
      return;
    }
    api
      .get<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    setToken(r.token);
    setUser(r.user);
  }, []);
  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);
  const can = useCallback((role: Role) => !!user && RANK[user.role] >= RANK[role], [user]);

  return <AuthCtx.Provider value={{ user, ready, setUser, login, logout, can }}>{children}</AuthCtx.Provider>;
}

/* ---------------- Toasts ---------------- */
type Toast = { id: number; text: string; err?: boolean };
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, err = false) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, err }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), err ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>
            {t.err ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- Data hook ---------------- */
export function useData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, setData, error, loading, reload: () => setTick((t) => t + 1) };
}

/* ---------------- UI bits ---------------- */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(860px, 100%)' } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Loading() {
  return <div className="loading"><span className="spinner" /></div>;
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="panel empty">
      <h3>This page didn't load</h3>
      <p>{error}</p>
      {retry && <button className="btn" onClick={retry}>Try again</button>}
    </div>
  );
}

export function Stars({ n }: { n: number | null | undefined }) {
  return (
    <span className="stars" aria-label={n ? `${n} out of 5` : 'Not rated'}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width="13" height="13" viewBox="0 0 20 20" className={n && i <= n ? 'on' : ''} fill="currentColor"><path d="M10 1.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6L10 15l-5.4 3 1.2-6L1.3 7.8l6.1-.7z" /></svg>
      ))}
    </span>
  );
}

export function AccountLabel({ a }: { a: { id: number; brand: string; username: string; color?: string | null } }) {
  return (
    <div className="acct">
      <span className="acct-dot" style={{ background: accountColor(a) }} />
      <div style={{ minWidth: 0 }}>
        <div className="acct-name">{a.brand}</div>
        <div className="acct-user">@{a.username}</div>
      </div>
    </div>
  );
}
