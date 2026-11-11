import { useState, type FormEvent } from 'react';
import { AlertTriangle, DatabaseBackup, KeyRound, LogOut, Mail, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { api, setToken } from '../api';
import { useAuth, useData, useToast, Modal, bytes, ROLE_LABEL, type Role } from '../lib';

interface U { id: number; email: string; name: string; role: Role; active: boolean; last_login_at: string | null; must_change_password?: boolean }
interface Audit { id: number; action: string; entity: string | null; entity_id: string | null; ip: string | null; created_at: string; user_name: string | null }
interface Status { storageEnabled: boolean; timezone: string; backupSchedule: string; lastBackup: { created_at: string; size: number } | null }

const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never');

export default function Settings() {
  const { user, can, logout } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });

  async function changePw(e: FormEvent) {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return toast('The new passwords do not match.', true);
    try {
      const r = await api.post<{ token: string }>('/auth/change-password', pw);
      setToken(r.token);
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast('Password changed. Other devices have been signed out.');
    } catch (err) { toast((err as Error).message, true); }
  }
  async function logoutAll() {
    if (!window.confirm('Sign out on every device, including this one?')) return;
    await api.post('/auth/logout-all').catch(() => {});
    logout();
  }

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>Signed in as {user?.name} ({user?.email}).</p></div></div>
      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <form className="panel panel-pad stack" style={{ gap: 12 }} onSubmit={changePw}>
          <h2><KeyRound size={18} style={{ verticalAlign: -3 }} /> Change password</h2>
          <div className="field"><label htmlFor="cp">Current password</label><input id="cp" type="password" className="input" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></div>
          <div className="field"><label htmlFor="np">New password</label><input id="np" type="password" className="input" required minLength={10} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /><span className="hint">At least 10 characters, with letters and numbers.</span></div>
          <div className="field"><label htmlFor="np2">Repeat new password</label><input id="np2" type="password" className="input" required autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></div>
          <div><button className="btn btn-primary">Change password</button></div>
        </form>
        <div className="panel panel-pad stack" style={{ gap: 12 }}>
          <h2><ShieldCheck size={18} style={{ verticalAlign: -3 }} /> Security</h2>
          <p className="muted">All data lives in your private database and storage, never in the code repository. Login emails, private notes and backups are encrypted with AES-256. Accounts lock for 15 minutes after 5 wrong passwords.</p>
          <div><button className="btn" onClick={logoutAll}><LogOut /> Sign out on all devices</button></div>
          {can('admin') && <BackupBox />}
          {can('admin') && <Integrations />}
        </div>
      </div>
      <EmailPrefs />
      {can('admin') && <EmailAndAi />}
      {can('admin') && <UsersPanel />}
      {can('admin') && <AuditPanel />}
    </>
  );
}

function EmailPrefs() {
  const toast = useToast();
  const { data, setData } = useData<{ user: { email_notifications: boolean } }>('/auth/me');
  if (!data) return null;
  const on = data.user.email_notifications !== false;
  async function toggle() {
    try {
      await api.patch('/auth/preferences', { email_notifications: !on });
      setData({ user: { ...data!.user, email_notifications: !on } });
      toast(!on ? 'Email notifications on' : 'Email notifications off — you will still see them in the app');
    } catch (e) { toast((e as Error).message, true); }
  }
  return (
    <div className="panel panel-pad" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h2><Mail size={18} style={{ verticalAlign: -3 }} /> Email notifications</h2><p className="muted" style={{ marginTop: 4 }}>New tasks, changes, comments, completions and deadline reminders.</p></div>
        <label className="check"><input type="checkbox" checked={on} onChange={toggle} /> Email me</label>
      </div>
    </div>
  );
}

function EmailAndAi() {
  const toast = useToast();
  const status = useData<{ email: string | null; appUrl: string; ai: boolean; aiModel: string }>('/system/status');
  const log = useData<{ id: number; to_email: string; subject: string; kind: string | null; status: string; error: string | null; created_at: string }[]>('/system/emails');
  const [busy, setBusy] = useState(false);
  if (!status.data) return null;
  const s = status.data;
  async function test() {
    setBusy(true);
    try { await api.post('/system/test-email'); toast('Test email sent — check your inbox'); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); log.reload(); }
  }
  return (
    <div className="grid cols-2" style={{ marginBottom: 16 }}>
      <div className="panel panel-pad stack" style={{ gap: 10 }}>
        <h2><Mail size={18} style={{ verticalAlign: -3 }} /> Email delivery</h2>
        {s.email ? <p><span className="badge badge-good">Connected</span> Sending with {s.email === 'resend' ? 'Resend' : s.email === 'smtp' ? 'SMTP' : 'local outbox'}. Links in emails open <b>{s.appUrl || '(set APP_URL)'}</b>.</p>
          : <p><span className="badge badge-warn">Not set up</span> Add <b>RESEND_API_KEY</b> and <b>EMAIL_FROM</b> on Railway to send emails. Until then, notifications appear in the app only.</p>}
        <div><button className="btn btn-sm" onClick={test} disabled={busy || !s.email}>{busy ? 'Sending…' : 'Send a test email to me'}</button></div>
        <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line-2)', borderRadius: 10 }}>
          <table className="t" style={{ fontSize: 13 }}>
            <thead><tr><th>Sent</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
            <tbody>{(log.data || []).map((e) => (
              <tr key={e.id}><td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(e.created_at)}</td><td>{e.to_email}</td><td>{e.subject}</td>
                <td title={e.error || ''}>{e.status === 'sent' ? <span className="badge badge-good">Sent</span> : e.status === 'failed' ? <span className="badge badge-bad">Failed</span> : <span className="badge">Skipped</span>}</td></tr>
            ))}</tbody>
          </table>
          {log.data?.length === 0 && <p className="faint" style={{ padding: 12 }}>No emails yet.</p>}
        </div>
      </div>
      <AiProviders />
    </div>
  );
}

interface Prov { provider: string; label: string; keyVar: string; configured: boolean; position: number; models: string[]; state: string; stateText: string; message: string | null; checked_at: string | null; last_ok_at: string | null }

/** Shows which AI keys work, which expired or ran out of quota, and lets the admin re-test. */
function AiProviders() {
  const toast = useToast();
  const { data, setData } = useData<{ order: string; fallback: boolean; providers: Prov[] }>('/system/ai');
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  async function test() {
    setBusy(true);
    try {
      const r = await api.post<{ providers: Prov[] }>('/system/ai/test');
      setData({ ...data!, providers: r.providers });
      const ok = r.providers.filter((p) => p.state === 'ok').length;
      toast(ok ? `${ok} AI provider${ok > 1 ? 's' : ''} working` : 'No AI provider is working — see the reasons below', !ok);
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  const tone = (s: string) => (s === 'ok' ? 'badge-good' : s === 'invalid' || s === 'quota' ? 'badge-bad' : s === 'not_set' || s === 'unknown' ? '' : 'badge-warn');
  const working = data.providers.filter((p) => p.state === 'ok').length;
  const set = data.providers.filter((p) => p.configured).length;
  return (
    <div className="panel panel-pad stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2><Sparkles size={18} style={{ verticalAlign: -3 }} /> AI providers</h2>
        <button className="btn btn-sm" onClick={test} disabled={busy || !set}>{busy ? 'Testing…' : 'Test keys'}</button>
      </div>
      <p className="muted" style={{ fontSize: 13.5 }}>
        {set ? <>Tried in this order{data.fallback ? '; if one fails or its key expires, the next is used automatically' : ' (fallback is off)'}. Suggestions only appear when you press <b>New task</b>.</>
          : <>No AI key is set. Add <b>OPENAI_API_KEY</b>, <b>GEMINI_API_KEY</b> or <b>OPENROUTER_API_KEY</b> on Railway. Without AI, New task shows a full product brief instead.</>}
      </p>
      {set > 0 && working === 0 && data.providers.some((p) => p.configured && p.state !== 'unknown') && (
        <div className="notice"><AlertTriangle /><span>No AI provider is working right now. Replace the keys marked red on Railway, then press <b>Test keys</b>.</span></div>
      )}
      <div className="table-wrap" style={{ border: '1px solid var(--line-2)', borderRadius: 10 }}>
        <table className="t" style={{ fontSize: 13.5 }}>
          <thead><tr><th>#</th><th>Provider</th><th>Status</th><th>Models</th><th>Last checked</th></tr></thead>
          <tbody>{data.providers.map((p) => (
            <tr key={p.provider} style={!p.configured ? { opacity: 0.6 } : undefined}>
              <td className="faint">{p.configured ? p.position : ''}</td>
              <td><b>{p.label}</b><div className="faint" style={{ fontSize: 12 }}>{p.keyVar}</div></td>
              <td><span className={`badge ${tone(p.state)}`}>{p.stateText}</span>{p.message && <div className="faint" style={{ fontSize: 12, maxWidth: 260 }}>{p.message}</div>}</td>
              <td className="muted" style={{ fontSize: 12.5, maxWidth: 240 }}>{p.models.join(' → ') || '—'}</td>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>{p.checked_at ? when(p.checked_at) : '—'}{p.last_ok_at && p.state !== 'ok' && <div className="faint" style={{ fontSize: 12 }}>last worked {when(p.last_ok_at)}</div>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function Integrations() {
  const { data } = useData<{ youtubeKey: boolean; telegramToken: boolean }>('/accounts/sync-support');
  if (!data) return null;
  const row = (ok: boolean, label: string, how: string) => (
    <li style={{ marginBottom: 4 }}>{ok ? <span className="badge badge-good">Connected</span> : <span className="badge">Not set</span>} {label}{!ok && <span className="faint"> — {how}</span>}</li>
  );
  return (
    <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
      <h3 style={{ marginBottom: 6 }}>Automatic numbers (official APIs)</h3>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: 13.5 }}>
        {row(data.youtubeKey, 'YouTube', 'add YOUTUBE_API_KEY on Railway')}
        {row(data.telegramToken, 'Telegram', 'add TELEGRAM_BOT_TOKEN on Railway')}
        <li style={{ marginBottom: 4 }}><span className="badge badge-good">Ready</span> Discord — add the invite code on the account</li>
        <li><span className="badge">Manual</span> Instagram, Facebook, LinkedIn and others — enter numbers in Daily update</li>
      </ul>
    </div>
  );
}

function BackupBox() {
  const toast = useToast();
  const { data, reload } = useData<Status>('/system/status');
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { await api.post('/system/backups'); toast('Encrypted backup saved to Cloudflare R2'); reload(); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  if (!data) return null;
  return (
    <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
      <h3 style={{ marginBottom: 4 }}>Backups</h3>
      <p className="muted" style={{ fontSize: 13.5 }}>
        {data.storageEnabled
          ? <>An encrypted backup runs every night at 2:00 ({data.timezone}). Last backup: {data.lastBackup ? `${when(data.lastBackup.created_at)} (${bytes(data.lastBackup.size)})` : 'none yet'}.</>
          : 'Connect Cloudflare R2 on Railway to turn on nightly backups.'}
      </p>
      {data.storageEnabled && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={run} disabled={busy}><DatabaseBackup size={14} /> {busy ? 'Backing up…' : 'Back up now'}</button>}
    </div>
  );
}

function UsersPanel() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, reload } = useData<U[]>('/users');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'manager' as Role, password: '' });

  async function add(e: FormEvent) {
    e.preventDefault();
    try { await api.post('/users', f); toast(`Added ${f.name}`); setAdding(false); setF({ name: '', email: '', role: 'manager', password: '' }); reload(); } catch (err) { toast((err as Error).message, true); }
  }
  async function patch(u: U, body: Partial<U> & { password?: string }) {
    try { await api.patch(`/users/${u.id}`, body); toast('User updated'); reload(); } catch (err) { toast((err as Error).message, true); }
  }
  function changeEmail(u: U) {
    const e = window.prompt(`New sign-in email for ${u.name}:`, u.email);
    if (e && e !== u.email) patch(u, { email: e });
  }
  function resetPw(u: U) {
    const p = window.prompt(`New password for ${u.name} (10+ characters, letters and numbers):`);
    if (p) patch(u, { password: p });
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <div><h2>Team</h2><p>Admins control everything. Social media managers see only their assigned products and can't change security settings. Viewers can only look.</p></div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus /> Add person</button>
      </div>
      <div className="table-wrap" style={{ padding: 8 }}>
        <table className="t">
          <thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>{data?.map((u) => (
            <tr key={u.id}>
              <td>{u.name}<div className="acct-user">{u.email}</div></td>
              <td>
                <select className="input" style={{ width: 130, height: 32 }} value={u.role} disabled={u.id === user?.id} onChange={(e) => patch(u, { role: e.target.value as Role })} aria-label={`Role for ${u.name}`}>
                  <option value="admin">{ROLE_LABEL.admin}</option><option value="manager">{ROLE_LABEL.manager}</option><option value="viewer">{ROLE_LABEL.viewer}</option>
                </select>
              </td>
              <td className="muted">{when(u.last_login_at)}</td>
              <td>{!u.active ? <span className="badge">Disabled</span> : u.must_change_password ? <span className="badge badge-warn">Must set password</span> : <span className="badge badge-good">Active</span>}</td>
              <td className="r" style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-sm btn-ghost" onClick={() => changeEmail(u)}>Change email</button>
                <button className="btn btn-sm btn-ghost" onClick={() => resetPw(u)}>Reset password</button>
                {u.id !== user?.id && <button className="btn btn-sm btn-ghost" onClick={() => patch(u, { active: !u.active })}>{u.active ? 'Disable' : 'Enable'}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {adding && (
        <Modal title="Add a team member" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" form="user-form">Add person</button></>}>
          <form id="user-form" className="form-grid" onSubmit={add}>
            <div className="field"><label htmlFor="un">Name</label><input id="un" className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="ue">Email</label><input id="ue" type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="ur">Role</label><select id="ur" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}><option value="manager">{ROLE_LABEL.manager}</option><option value="viewer">{ROLE_LABEL.viewer}</option><option value="admin">{ROLE_LABEL.admin}</option></select></div>
            <div className="field"><label htmlFor="up">Temporary password</label><input id="up" className="input" required minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><span className="hint">Share it privately. They must choose their own password at first sign-in.</span></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  'login.success': 'Signed in', 'login.failed': 'Failed sign-in', 'snapshots.saved': 'Saved daily numbers', 'metrics.saved': 'Saved business numbers',
  'account.created': 'Added account', 'account.updated': 'Edited account', 'account.deleted': 'Deleted account', 'account.imported': 'Imported accounts',
  'report.generated': 'Generated report', 'report.downloaded': 'Downloaded report', 'file.uploaded': 'Uploaded file', 'file.downloaded': 'Downloaded file',
  'user.created': 'Added user', 'user.updated': 'Updated user', 'backup.created': 'Ran backup', 'snapshots.exported': 'Exported CSV',
};

function AuditPanel() {
  const { data } = useData<Audit[]>('/users/audit?limit=60');
  return (
    <div className="panel">
      <div className="panel-head"><div><h2>Activity log</h2><p>Every sign-in, change and download, newest first.</p></div></div>
      <div className="table-wrap" style={{ padding: 8, maxHeight: 420, overflowY: 'auto' }}>
        <table className="t">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>IP</th></tr></thead>
          <tbody>{data?.map((a) => (
            <tr key={a.id}>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(a.created_at)}</td>
              <td>{a.user_name || '—'}</td>
              <td>{a.action === 'login.failed' ? <span className="badge badge-bad">{ACTIONS[a.action]}</span> : ACTIONS[a.action] || a.action}{a.entity_id && <span className="faint"> #{a.entity_id}</span>}</td>
              <td className="faint num">{a.ip}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
