import { useState, type FormEvent } from 'react';
import { AlertTriangle, DatabaseBackup, KeyRound, LogOut, Mail, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { api, setToken } from '../api';
import { useAuth, useData, useToast, Modal, bytes, ROLE_LABEL, type Role } from '../lib';

interface U { id: number; email: string; notify_email: string | null; email_notifications?: boolean; name: string; role: Role; active: boolean; last_login_at: string | null; must_change_password?: boolean }
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
      <div className="stack" style={{ marginBottom: 16 }}>
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
  const { can } = useAuth();
  const { data, setData } = useData<{ user: { email: string; notify_email: string | null; email_notifications: boolean } }>('/auth/me');
  const [addr, setAddr] = useState<string | null>(null);
  if (!data) return null;
  const u = data.user;
  const on = u.email_notifications !== false;
  const current = u.notify_email || u.email;
  async function save(body: { email_notifications?: boolean; notify_email?: string }, msg: string) {
    try {
      await api.patch('/auth/preferences', body);
      setData({ user: { ...u, ...body, notify_email: body.notify_email !== undefined ? body.notify_email || null : u.notify_email } });
      toast(msg);
      setAddr(null);
    } catch (e) { toast((e as Error).message, true); }
  }
  return (
    <div className="panel panel-pad" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2><Mail size={18} style={{ verticalAlign: -3 }} /> Email notifications</h2>
          <p className="muted" style={{ marginTop: 4 }}>New tasks, changes, comments, completions and deadline reminders are sent to <b>{current}</b>.
            {!can('admin') && ' Only the admin can change this address.'}</p>
          {can('admin') && (addr === null
            ? <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setAddr(u.notify_email || '')}>Change notification email</button>
            : (
              <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); save({ notify_email: addr.trim() }, addr.trim() ? `Notifications will go to ${addr.trim()}` : 'Notifications will go to your login email'); }}>
                <input className="input" type="email" style={{ maxWidth: 300 }} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={`Leave empty to use ${u.email}`} aria-label="Notification email" autoFocus />
                <button className="btn btn-primary btn-sm">Save</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddr(null)}>Cancel</button>
              </form>
            ))}
        </div>
        <label className="check"><input type="checkbox" checked={on} onChange={() => save({ email_notifications: !on }, !on ? 'Email notifications on' : 'Email notifications off — you will still see them in the app')} /> Email me</label>
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
    try { const r = await api.post<{ to: string }>('/system/test-email'); toast(`Test email sent to ${r.to}`); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); log.reload(); }
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

interface AiKey {
  id: number; provider: string; providerLabel: string; pricing: string; label: string; key_hint: string | null; models: string[];
  customModels: boolean; base_url: string | null; position: number; enabled: boolean; state: string; stateText: string;
  message: string | null; last_model: string | null; checked_at: string | null; last_ok_at: string | null;
}
interface Preset { label: string; pricing: string; keyUrl: string; models: string[]; needsBaseUrl: boolean }
interface KeyForm { id?: number; provider: string; label: string; apiKey: string; models: string; base_url: string }

/** Admin manages AI keys: add several accounts, reorder, pause, replace, test. First healthy key in order is used. */
function AiProviders() {
  const toast = useToast();
  const { data, setData, reload } = useData<{ fallback: boolean; presets: Record<string, Preset>; keys: AiKey[] }>('/system/ai');
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<KeyForm | null>(null);
  if (!data) return null;
  const keys = data.keys;
  const setKeys = (k: AiKey[]) => setData({ ...data, keys: k });
  const replace = (k: AiKey) => setKeys(keys.map((x) => (x.id === k.id ? k : x)));

  async function run<T>(id: string, fn: () => Promise<T>) {
    setBusy(id);
    try { return await fn(); } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  }
  const testAll = () => run('all', async () => {
    const r = await api.post<{ keys: AiKey[] }>('/system/ai/test');
    setKeys(r.keys);
    const ok = r.keys.filter((k) => k.state === 'ok').length;
    toast(ok ? `${ok} key${ok > 1 ? 's' : ''} working` : 'No key is working — see the reasons below', !ok);
  });
  const testOne = (k: AiKey) => run(`t${k.id}`, async () => { const r = await api.post<AiKey>(`/system/ai/keys/${k.id}/test`); replace(r); toast(`${r.label}: ${r.stateText}`, r.state !== 'ok'); });
  const toggle = (k: AiKey) => run(`p${k.id}`, async () => { replace(await api.put<AiKey>(`/system/ai/keys/${k.id}`, { enabled: !k.enabled })); });
  const remove = (k: AiKey) => window.confirm(`Delete the key "${k.label}"?`) && run(`d${k.id}`, async () => { await api.del(`/system/ai/keys/${k.id}`); reload(); toast('Key deleted'); });
  const move = (k: AiKey, dir: -1 | 1) => run(`m${k.id}`, async () => {
    const ids = keys.map((x) => x.id); const i = ids.indexOf(k.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setKeys((await api.post<{ keys: AiKey[] }>('/system/ai/keys/reorder', { ids })).keys);
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const models = form.models.split(',').map((m) => m.trim()).filter(Boolean);
    const body = { provider: form.provider, label: form.label.trim(), apiKey: form.apiKey.trim(), models, base_url: form.base_url.trim() };
    await run('save', async () => {
      const k = form.id ? await api.put<AiKey>(`/system/ai/keys/${form.id}`, body) : await api.post<AiKey>('/system/ai/keys', body);
      toast(`${k.label}: ${k.stateText}`, k.state !== 'ok');
      setForm(null);
      reload();
    });
  }
  const tone = (s: string) => (s === 'ok' ? 'badge-good' : s === 'invalid' || s === 'quota' ? 'badge-bad' : s === 'unknown' || s === 'paused' ? '' : 'badge-warn');
  const working = keys.filter((k) => k.state === 'ok').length;
  const preset = form ? data.presets[form.provider] : null;

  return (
    <div className="panel panel-pad stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2><Sparkles size={18} style={{ verticalAlign: -3 }} /> AI providers</h2>
        <div className="row">
          {keys.length > 0 && <button className="btn btn-sm" onClick={testAll} disabled={!!busy}>{busy === 'all' ? 'Testing…' : 'Test all'}</button>}
          <button className="btn btn-sm btn-primary" onClick={() => setForm({ provider: 'gemini', label: '', apiKey: '', models: data.presets.gemini.models.join(', '), base_url: '' })}><Plus size={14} /> Add key</button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Keys are tried from top to bottom. The first one that works is used; expired keys and keys out of credit are skipped automatically.
        Add as many accounts as you like — free ones first saves money. Suggestions only appear when you press <b>New task</b>.
      </p>
      {keys.length > 0 && working === 0 && keys.some((k) => k.enabled && k.state !== 'unknown') && (
        <div className="notice"><AlertTriangle /><span>No AI key is working right now. Replace the keys marked red or add a free one (Gemini, Groq, Cerebras or Mistral).</span></div>
      )}
      {keys.length === 0 ? <div className="empty" style={{ padding: 20 }}><h3>No AI keys yet</h3><p>Add a free Gemini or Groq key to get task suggestions.</p></div> : (
        <div className="stack" style={{ gap: 8 }}>
          {keys.map((k, i) => (
            <div key={k.id} className="row" style={{ border: '1px solid var(--line-2)', borderRadius: 10, padding: '10px 12px', flexWrap: 'nowrap', alignItems: 'flex-start', opacity: k.enabled ? 1 : 0.6 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button className="btn btn-ghost btn-icon btn-sm" style={{ height: 22, width: 26 }} disabled={i === 0 || !!busy} onClick={() => move(k, -1)} aria-label="Move up">▲</button>
                <span className="faint num" style={{ textAlign: 'center', fontSize: 12 }}>{i + 1}</span>
                <button className="btn btn-ghost btn-icon btn-sm" style={{ height: 22, width: 26 }} disabled={i === keys.length - 1 || !!busy} onClick={() => move(k, 1)} aria-label="Move down">▼</button>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <b>{k.label}</b><span className="badge">{k.providerLabel}</span><span className="faint" style={{ fontSize: 12 }}>{k.pricing}</span>
                </div>
                <div className="faint" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>Key {k.key_hint} · {k.models.join(' → ')}</div>
                <div style={{ marginTop: 4 }}>
                  <span className={`badge ${tone(k.state)}`}>{k.stateText}</span>
                  {k.checked_at && <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>checked {when(k.checked_at)}{k.last_ok_at && k.state !== 'ok' ? ` · last worked ${when(k.last_ok_at)}` : ''}</span>}
                  {k.message && k.state !== 'ok' && <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{k.message}</div>}
                </div>
              </div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 210 }}>
                <button className="btn btn-sm" disabled={!!busy} onClick={() => testOne(k)}>{busy === `t${k.id}` ? 'Testing…' : 'Test'}</button>
                <button className="btn btn-sm" onClick={() => setForm({ id: k.id, provider: k.provider, label: k.label, apiKey: '', models: k.models.join(', '), base_url: k.base_url || '' })}>Edit</button>
                <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => toggle(k)}>{k.enabled ? 'Pause' : 'Resume'}</button>
                <button className="btn btn-sm btn-ghost btn-danger" disabled={!!busy} onClick={() => remove(k)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {form && preset && (
        <Modal title={form.id ? `Edit ${form.label}` : 'Add an AI key'} onClose={() => setForm(null)}
          footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" form="aikey-form" disabled={busy === 'save'}>{busy === 'save' ? 'Saving & testing…' : form.id ? 'Save & test' : 'Add & test'}</button></>}>
          <form id="aikey-form" className="form-grid" onSubmit={save}>
            <div className="field full">
              <label htmlFor="akp">Provider</label>
              <select id="akp" className="input" value={form.provider} disabled={!!form.id}
                onChange={(e) => { const p = e.target.value; setForm({ ...form, provider: p, models: data.presets[p].models.join(', '), label: form.label }); }}>
                {Object.entries(data.presets).map(([k, p]) => <option key={k} value={k}>{p.label} — {p.pricing}</option>)}
              </select>
              {preset.keyUrl && <span className="hint">Get a key at <a href={preset.keyUrl} target="_blank" rel="noreferrer noopener">{preset.keyUrl.replace(/^https:\/\//, '')}</a></span>}
            </div>
            <div className="field"><label htmlFor="akl">Name</label><input id="akl" className="input" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={`e.g. ${preset.label} — personal account`} /></div>
            <div className="field"><label htmlFor="akk">API key</label><input id="akk" className="input" type="password" autoComplete="new-password" required={!form.id} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={form.id ? 'Leave empty to keep the current key' : 'Paste the key'} /><span className="hint">Encrypted. Never shown again.</span></div>
            <div className="field full"><label htmlFor="akm">Models, in order</label><input id="akm" className="input" value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} placeholder="model-a, model-b" /><span className="hint">If the first model fails, the next one is tried. Defaults usually work.</span></div>
            {(preset.needsBaseUrl || form.base_url) && <div className="field full"><label htmlFor="akb">Base URL</label><input id="akb" className="input" type="url" required={preset.needsBaseUrl} value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.example.com/v1" /></div>}
          </form>
        </Modal>
      )}
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

interface PersonForm { id?: number; name: string; email: string; notify_email: string; role: Role; password: string; active?: boolean }

function UsersPanel() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, reload } = useData<U[]>('/users');
  const [editing, setEditing] = useState<PersonForm | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) {
        const cur = data!.find((u) => u.id === editing.id)!;
        const body: Record<string, unknown> = { name: editing.name, notify_email: editing.notify_email.trim() };
        if (editing.email.trim().toLowerCase() !== cur.email) body.email = editing.email.trim();
        if (editing.id !== user?.id && editing.role !== cur.role) body.role = editing.role;
        if (editing.password) body.password = editing.password;
        await api.patch(`/users/${editing.id}`, body);
        toast(`${editing.name} updated`);
      } else {
        await api.post('/users', { name: editing.name, email: editing.email.trim(), notify_email: editing.notify_email.trim(), role: editing.role, password: editing.password });
        toast(`${editing.name} added. Share the login email and temporary password with them privately.`);
      }
      setEditing(null);
      reload();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }
  async function toggleActive(u: U) {
    try { await api.patch(`/users/${u.id}`, { active: !u.active }); toast(u.active ? `${u.name} disabled` : `${u.name} enabled`); reload(); } catch (e) { toast((e as Error).message, true); }
  }
  const tempPassword = () => {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const r = new Uint32Array(12); crypto.getRandomValues(r);
    return Array.from(r, (n) => a[n % a.length]).join('') + '7';
  };
  const isNew = editing && !editing.id;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <div><h2>Team</h2><p>Each person signs in with their login email. Notifications go to their notification email (or the login email if none is set).</p></div>
        <button className="btn btn-primary" onClick={() => setEditing({ name: '', email: '', notify_email: '', role: 'manager', password: tempPassword() })}><Plus /> Add person</button>
      </div>
      <div className="table-wrap" style={{ padding: 8 }}>
        <table className="t">
          <thead><tr><th>Name</th><th>Login email</th><th>Notifications to</th><th>Role</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>{data?.map((u) => (
            <tr key={u.id}>
              <td><b>{u.name}</b>{u.id === user?.id && <span className="faint"> (you)</span>}</td>
              <td className="muted">{u.email}</td>
              <td>{u.notify_email || <span className="faint">{u.email}</span>}{u.email_notifications === false && <div><span className="badge">Emails off</span></div>}</td>
              <td>{ROLE_LABEL[u.role]}</td>
              <td className="muted">{when(u.last_login_at)}</td>
              <td>{!u.active ? <span className="badge">Disabled</span> : u.must_change_password ? <span className="badge badge-warn">Must set password</span> : <span className="badge badge-good">Active</span>}</td>
              <td className="r" style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-sm" onClick={() => setEditing({ id: u.id, name: u.name, email: u.email, notify_email: u.notify_email || '', role: u.role, password: '', active: u.active })}>Edit</button>
                {u.id !== user?.id && <button className="btn btn-sm btn-ghost" onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {editing && (
        <Modal title={isNew ? 'Add a team member' : `Edit ${editing.name}`} onClose={() => setEditing(null)}
          footer={<><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" form="person-form" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add person' : 'Save changes'}</button></>}>
          <form id="person-form" className="form-grid" onSubmit={save}>
            <div className="field"><label htmlFor="pnm">Name</label><input id="pnm" className="input" required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Maryam Batool" /></div>
            <div className="field"><label htmlFor="prl">Role</label>
              <select id="prl" className="input" value={editing.role} disabled={editing.id === user?.id} onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })}>
                <option value="manager">{ROLE_LABEL.manager}</option><option value="viewer">{ROLE_LABEL.viewer}</option><option value="admin">{ROLE_LABEL.admin}</option>
              </select>
            </div>
            <div className="field"><label htmlFor="pem">Login email</label><input id="pem" type="email" className="input" required value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /><span className="hint">Used to sign in.</span></div>
            <div className="field"><label htmlFor="pne">Notification email</label><input id="pne" type="email" className="input" value={editing.notify_email} onChange={(e) => setEditing({ ...editing, notify_email: e.target.value })} placeholder="Same as login email" /><span className="hint">Tasks, reminders and replies are sent here.</span></div>
            <div className="field full">
              <label htmlFor="ppw">{isNew ? 'Temporary password' : 'Reset password (optional)'}</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id="ppw" className="input" required={!!isNew} minLength={editing.password ? 10 : undefined} value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} placeholder={isNew ? '' : 'Leave empty to keep the current password'} autoComplete="off" />
                <button type="button" className="btn" onClick={() => setEditing({ ...editing, password: tempPassword() })}>Generate</button>
              </div>
              <span className="hint">{isNew ? 'Share it privately — they must choose their own password at first sign-in.' : 'If you reset it, they must choose a new one at next sign-in.'}</span>
            </div>
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
