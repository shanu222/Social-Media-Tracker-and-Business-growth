import { useState, type FormEvent } from 'react';
import { Lock, Mail, Phone, Globe } from 'lucide-react';
import { BRAND } from '../brand';
import { useAuth } from '../lib';

const BARS = [18, 26, 22, 34, 30, 42, 38, 52, 47, 61, 58, 74, 70, 88];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-art">
        <div className="login-org">
          <img src="/rtl-logo.png" alt="RTL" />
          <div><b>Growth Desk for RTL</b><span>{BRAND.legal}</span></div>
        </div>
        <div>
          <h1>Every product, every account, one desk.</h1>
          <p>Track daily growth across all RTL products, assign work to the team and send branded reports, from one private workspace.</p>
          <div className="login-bars" aria-hidden="true" style={{ marginTop: 28 }}>
            {BARS.map((h, i) => <i key={i} className={i >= BARS.length - 3 ? 'hi' : ''} style={{ height: `${h}%` }} />)}
          </div>
        </div>
        <div className="login-ceo">
          <span><b>{BRAND.ceo}</b>, {BRAND.ceoTitle}</span>
          <a href={`mailto:${BRAND.email}`}><Mail /> {BRAND.email}</a>
          <a href={BRAND.whatsapp} target="_blank" rel="noreferrer noopener"><Phone /> {BRAND.phone}</a>
          <a href={BRAND.website} target="_blank" rel="noreferrer noopener"><Globe /> {BRAND.websiteLabel}</a>
        </div>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <div className="login-mobile-logo"><img src="/rtl-logo-192.png" alt="RTL" /></div>
          <div>
            <h1 style={{ fontSize: 26 }}>Sign in to Growth Desk for RTL</h1>
            <p className="muted" style={{ marginTop: 6 }}>Sign in with your work account.</p>
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="err-text" role="alert">{error}</div>}
          <button className="btn btn-primary" style={{ height: 42 }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="faint" style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Lock size={13} /> Data is encrypted and only visible to signed-in team members.
          </p>
          <p className="faint" style={{ fontSize: 12 }}>© {new Date().getFullYear()} {BRAND.legal}</p>
        </form>
      </div>
    </div>
  );
}
