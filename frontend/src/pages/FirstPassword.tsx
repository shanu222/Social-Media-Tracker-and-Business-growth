import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { api, setToken } from '../api';
import { useAuth } from '../lib';

/** Shown after first sign-in (or an admin reset) until the person picks their own password. */
export default function FirstPassword() {
  const { user, setUser, logout } = useAuth();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (f.newPassword !== f.confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      const r = await api.post<{ token: string }>('/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword });
      setToken(r.token);
      setUser({ ...user!, must_change_password: false });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="login-form" style={{ minHeight: '100%' }}>
      <form onSubmit={submit} className="panel panel-pad" style={{ width: 'min(420px, 100%)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <h1 style={{ fontSize: 24, display: 'flex', gap: 10, alignItems: 'center' }}><KeyRound /> Choose your own password</h1>
          <p className="muted" style={{ marginTop: 6 }}>Welcome, {user?.name}. For security, replace the temporary password you were given before continuing.</p>
        </div>
        <div className="field"><label htmlFor="fp1">Temporary password</label><input id="fp1" type="password" className="input" required autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></div>
        <div className="field"><label htmlFor="fp2">New password</label><input id="fp2" type="password" className="input" required minLength={10} autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /><span className="hint">At least 10 characters, with letters and numbers.</span></div>
        <div className="field"><label htmlFor="fp3">Repeat new password</label><input id="fp3" type="password" className="input" required autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></div>
        {error && <div className="err-text" role="alert">{error}</div>}
        <button className="btn btn-primary" style={{ height: 42 }} disabled={busy}>{busy ? 'Saving…' : 'Save password and continue'}</button>
        <button type="button" className="btn btn-ghost" onClick={logout}>Sign out</button>
      </form>
    </div>
  );
}
