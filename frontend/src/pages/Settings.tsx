import { useState, type FormEvent } from 'react';
import { DatabaseBackup, KeyRound, LogOut, Plus, ShieldCheck } from 'lucide-react';
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
      {can('admin') && <UsersPanel />}
      {can('admin') && <AuditPanel />}
    </>
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
        <li><span className="badge badge-info">Per account</span> Instagram & Facebook — add the Meta access token on the account</li>
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
