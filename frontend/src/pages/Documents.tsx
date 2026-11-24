import { useState, type FormEvent } from 'react';
import { Award, CheckCircle2, Clock, Download, FileSignature, Pencil, PenLine, ScrollText, ShieldCheck, Trash2, Upload, Undo2, Ban } from 'lucide-react';
import { api, download } from '../api';
import { BRAND } from '../brand';
import { useAuth, useData, useToast, Loading, ErrorBox, Modal } from '../lib';

/* ---------------- Shared ---------------- */

interface LetterView {
  ref: string; date: string; role: string; start_date: string; end_date: string; duration: string; supervisor: string;
  accepted_at: string | null; name: string; terms: [string, string][];
  intro: { before: string; company: string; middle: string; role: string; after: string; date: string; end: string };
}
interface Mine {
  nda: { signed_at: string } | null;
  ceo_signature_ready: boolean;
  internship: { letter: LetterView; certificate: { ref: string; issued_on: string; completed_on: string; revoked: boolean } | null } | null;
}

const fmt = (d: string | null | undefined) => {
  if (!d) return '';
  const date = d.length === 10 ? new Date(`${d}T00:00:00Z`) : new Date(d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', ...(d.length === 10 ? { timeZone: 'UTC' } : {}) });
};
const fileRef = (ref: string) => ref.replace(/[^\w]+/g, '-');

/** The letter as readable text, used before accepting (same wording as the PDF). */
function LetterPreview({ l }: { l: LetterView }) {
  const t = l.intro;
  return (
    <article className="jl-preview">
      <header className="jl-head">
        <img src={BRAND.logo} alt="" />
        <div><b>{BRAND.legal}</b><span>{BRAND.email} · {BRAND.phone}</span></div>
      </header>
      <div className="jl-meta"><span>Ref No: <b>{l.ref}</b></span><span>Date: <b>{fmt(l.date)}</b></span></div>
      <p>To: <b>{l.name}</b></p>
      <h3>Subject: Internship joining letter</h3>
      <p>Dear {l.name},</p>
      <p>{t.before}<b>{t.company}</b>{t.middle}<b>{t.role}</b>{t.after}<b>{t.date}</b>{t.end}</p>
      <ol>{l.terms.map(([k, v]) => <li key={k}><b>{k}:</b> {v}</li>)}</ol>
      <p>Welcome to the RTL team. Your electronic acceptance below confirms that you have read and agree to these terms.</p>
    </article>
  );
}

/* ---------------- Team member: My documents ---------------- */

export default function Documents() {
  const { can } = useAuth();
  return can('admin') ? <AdminLetters /> : <MyDocuments />;
}

function MyDocuments() {
  const toast = useToast();
  const { data, error, loading, reload } = useData<Mine>('/letters/mine');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;
  const i = data.internship;
  const get = async (key: string, path: string, name: string) => {
    setBusy(key);
    try { await download(path, name); } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  };

  return (
    <div className="page docs-page">
      <div className="page-head">
        <div>
          <h1>My documents</h1>
          <p className="muted">Your agreement, joining letter and certificate, signed and ready to download.</p>
        </div>
      </div>

      <div className="docs-grid">
        <section className="panel doc-card">
          <div className="doc-ico"><ShieldCheck /></div>
          <div className="doc-body">
            <h2>Non-Disclosure Agreement</h2>
            {data.nda ? <p className="muted">Signed on {fmt(data.nda.signed_at)}. Your letters can be downloaded because this is signed.</p> : <p className="muted">Not signed.</p>}
          </div>
          {data.nda && <div className="doc-actions"><button className="btn" disabled={busy === 'nda'} onClick={() => get('nda', '/nda/pdf', 'NDA-signed.pdf')}><Download size={15} /> Download</button></div>}
        </section>

        <section className="panel doc-card">
          <div className="doc-ico"><FileSignature /></div>
          <div className="doc-body">
            <h2>Joining letter</h2>
            {!i ? <p className="muted">Your joining letter will appear here once the admin prepares it. You'll get a notification and an email.</p> : (
              <>
                <p className="doc-ref">{i.letter.ref} · {i.letter.role}</p>
                <p className="muted">{fmt(i.letter.start_date)} – {fmt(i.letter.end_date)} · {i.letter.duration}</p>
                {i.letter.accepted_at
                  ? <p className="doc-state ok"><CheckCircle2 size={15} /> Accepted on {fmt(i.letter.accepted_at)}</p>
                  : <p className="doc-state wait"><PenLine size={15} /> Ready for you to review and accept</p>}
              </>
            )}
          </div>
          {i && (
            <div className="doc-actions">
              {i.letter.accepted_at ? (
                <>
                  <button className="btn btn-ghost" onClick={() => setReviewing(true)}>View</button>
                  <button className="btn btn-primary" disabled={busy === 'letter' || !data.ceo_signature_ready} onClick={() => get('letter', '/letters/mine/letter.pdf', `Joining-Letter-${fileRef(i.letter.ref)}.pdf`)}><Download size={15} /> {busy === 'letter' ? 'Preparing…' : 'Download'}</button>
                </>
              ) : <button className="btn btn-primary" onClick={() => setReviewing(true)}>Review and accept</button>}
            </div>
          )}
          {i && !data.ceo_signature_ready && <p className="doc-foot faint small"><Clock size={13} /> Download opens once the CEO's signature is added. The admin has been notified.</p>}
        </section>

        <section className="panel doc-card">
          <div className="doc-ico gold"><Award /></div>
          <div className="doc-body">
            <h2>Internship certificate</h2>
            {!i ? <p className="muted">Issued when your internship is completed.</p>
              : !i.certificate ? <p className="muted">Issued when your internship is completed{i.letter.end_date ? ` (planned end: ${fmt(i.letter.end_date)})` : ''}. You'll be notified.</p>
              : i.certificate.revoked ? <p className="doc-state bad"><Ban size={15} /> This certificate has been withdrawn. Contact the admin.</p>
              : <>
                  <p className="doc-ref">{i.certificate.ref}</p>
                  <p className="doc-state ok"><CheckCircle2 size={15} /> Issued on {fmt(i.certificate.issued_on)}</p>
                </>}
          </div>
          {i?.certificate && !i.certificate.revoked && (
            <div className="doc-actions">
              <button className="btn btn-primary" disabled={busy === 'cert' || !data.ceo_signature_ready} onClick={() => get('cert', '/letters/mine/certificate.pdf', `Internship-Certificate-${fileRef(i.certificate!.ref)}.pdf`)}><Download size={15} /> {busy === 'cert' ? 'Preparing…' : 'Download'}</button>
            </div>
          )}
        </section>
      </div>
      <p className="faint small docs-note">Every letter and certificate has a reference number and a QR code that anyone can use to check it is genuine.</p>

      {reviewing && i && <AcceptLetter letter={i.letter} ceoReady={data.ceo_signature_ready} onClose={() => setReviewing(false)} onDone={() => { setReviewing(false); reload(); }} />}
    </div>
  );
}

function AcceptLetter({ letter, ceoReady, onClose, onDone }: { letter: LetterView; ceoReady: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const accepted = !!letter.accepted_at;
  async function accept() {
    setBusy(true);
    try {
      await api.post('/letters/mine/accept', {});
      if (ceoReady) await download('/letters/mine/letter.pdf', `Joining-Letter-${fileRef(letter.ref)}.pdf`);
      toast(ceoReady ? 'Accepted. Your signed letter is downloading.' : 'Accepted. You can download it once the CEO signature is added.');
      onDone();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <Modal title="Internship joining letter" onClose={onClose} wide footer={accepted ? (
      <button className="btn btn-primary" onClick={onClose}>Close</button>
    ) : (
      <>
        <button className="btn" onClick={onClose}>Not now</button>
        <button className="btn btn-primary" disabled={!agree || busy} onClick={accept}>{busy ? 'Accepting…' : ceoReady ? 'Accept and download' : 'Accept'}</button>
      </>
    )}>
      <LetterPreview l={letter} />
      {!accepted && (
        <label className="check jl-agree">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I accept these terms. I agree that the signature I provided with my NDA is placed on this letter as my acceptance.</span>
        </label>
      )}
    </Modal>
  );
}

/* ---------------- Admin: Letters & certificates ---------------- */

interface Internship {
  role: string; start_date: string; end_date: string; supervisor_name: string; supervisor_title: string | null; notice_days: number; stipend: string | null;
  letter_ref: string; letter_date: string; accepted_at: string | null;
  cert_ref: string | null; cert_issued_on: string | null; cert_completed_on: string | null; cert_remark: string | null; cert_revoked_at: string | null;
}
interface Person { user_id: number; name: string; email: string; title: string | null; active: boolean; nda_signed_at: string | null; nda_name: string | null; internship: Internship | null }
interface AdminData { ceo_signature: { preview: string; updated_at: string } | null; people: Person[] }

function AdminLetters() {
  const toast = useToast();
  const { data, error, loading, reload } = useData<AdminData>('/letters/admin');
  const [editLetter, setEditLetter] = useState<Person | null>(null);
  const [editCert, setEditCert] = useState<Person | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error || ''} retry={reload} />;
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast(ok); } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  };
  const withLetters = data.people.filter((p) => p.internship).length;

  return (
    <div className="page docs-page">
      <div className="page-head">
        <div>
          <h1>Letters & certificates</h1>
          <p className="muted">Prepare joining letters and issue internship certificates. Team members can download them only after signing the NDA.</p>
        </div>
      </div>

      <CeoSignature sig={data.ceo_signature} onChange={reload} />

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head"><div><h2>Team members</h2><p>{withLetters} of {data.people.length} have a joining letter.</p></div></div>
        {data.people.length === 0 ? <p className="muted panel-pad">Add team members in Settings first.</p> : (
          <div className="table-wrap" style={{ padding: 8 }}>
            <table className="t letters-t">
              <thead><tr><th>Name</th><th>NDA</th><th>Joining letter</th><th>Certificate</th><th /></tr></thead>
              <tbody>{data.people.map((p) => {
                const i = p.internship;
                return (
                  <tr key={p.user_id}>
                    <td><b>{p.nda_name || p.name}</b><div className="faint small">{p.title || p.email}</div></td>
                    <td>{p.nda_signed_at ? <span className="badge badge-good">Signed</span> : <span className="badge badge-warn">Not signed</span>}</td>
                    <td>
                      {!i ? <span className="faint">Not prepared</span> : (
                        <>
                          <div className="num small"><b>{i.letter_ref}</b></div>
                          <div className="faint small">{i.role} · {fmt(i.start_date)} – {fmt(i.end_date)}</div>
                          {i.accepted_at ? <span className="badge badge-good">Accepted {fmt(i.accepted_at)}</span> : <span className="badge">Awaiting acceptance</span>}
                        </>
                      )}
                    </td>
                    <td>
                      {!i?.cert_ref ? <span className="faint">{i ? 'Not issued' : '—'}</span> : (
                        <>
                          <div className="num small"><b>{i.cert_ref}</b></div>
                          {i.cert_revoked_at ? <span className="badge badge-bad">Withdrawn</span> : <span className="badge badge-good">Issued {fmt(i.cert_issued_on)}</span>}
                        </>
                      )}
                    </td>
                    <td className="r letters-actions">
                      {!i ? <button className="btn btn-sm btn-primary" onClick={() => setEditLetter(p)}><FileSignature size={14} /> Prepare letter</button> : (
                        <>
                          <button className="btn btn-sm" title="Edit letter" onClick={() => setEditLetter(p)}><Pencil size={14} /> Letter</button>
                          <button className="btn btn-sm btn-ghost" disabled={busy === `l${p.user_id}`} aria-label={`Download joining letter for ${p.name}`} onClick={() => run(`l${p.user_id}`, () => download(`/letters/intern/${p.user_id}/letter.pdf`, `Joining-Letter-${fileRef(i.letter_ref)}.pdf`))}><Download size={14} /> PDF</button>
                          <button className="btn btn-sm" onClick={() => setEditCert(p)}><Award size={14} /> {i.cert_ref ? 'Certificate' : 'Issue certificate'}</button>
                          {i.cert_ref && !i.cert_revoked_at && <button className="btn btn-sm btn-ghost" disabled={busy === `c${p.user_id}`} aria-label={`Download certificate for ${p.name}`} onClick={() => run(`c${p.user_id}`, () => download(`/letters/intern/${p.user_id}/certificate.pdf`, `Internship-Certificate-${fileRef(i.cert_ref!)}.pdf`))}><Download size={14} /> PDF</button>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>

      {editLetter && <LetterForm p={editLetter} onClose={() => setEditLetter(null)} onSaved={() => { setEditLetter(null); reload(); }} />}
      {editCert && <CertForm p={editCert} onClose={() => setEditCert(null)} onSaved={() => { setEditCert(null); reload(); }} />}
    </div>
  );
}

function CeoSignature({ sig, onChange }: { sig: AdminData['ceo_signature']; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  function pick(file: File) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) return toast('Choose a PNG or JPG image.', true);
    if (file.size > 6 * 1024 * 1024) return toast('Choose an image under 6 MB.', true);
    const r = new FileReader();
    r.onload = async () => {
      setBusy(true);
      try { await api.put('/letters/ceo-signature', { image: String(r.result) }); toast('Signature saved. It now appears on the NDA, letters and certificates.'); onChange(); }
      catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
    };
    r.readAsDataURL(file);
  }
  return (
    <section className="panel ceo-sig">
      <div className="ceo-sig-text">
        <h2><PenLine size={18} /> CEO signature</h2>
        <p className="muted">Placed on every NDA, joining letter and certificate. Sign on plain white paper and upload a clear photo or scan; the paper background is removed automatically.</p>
        {!sig && <p className="notice warn" style={{ marginTop: 8 }}>Letters and certificates can't be downloaded until a signature is added.</p>}
      </div>
      <div className="ceo-sig-box">
        {sig ? <img src={sig.preview} alt={`${BRAND.ceo}'s signature`} /> : <span className="faint">No signature yet</span>}
        <div className="line" />
        <b>{BRAND.ceo}</b><span className="faint small">{BRAND.ceoTitle}</span>
      </div>
      <div className="ceo-sig-actions">
        <label className={`btn ${sig ? '' : 'btn-primary'}`} aria-disabled={busy}>
          <Upload size={15} /> {busy ? 'Saving…' : sig ? 'Replace' : 'Upload signature'}
          <input type="file" accept="image/png,image/jpeg" hidden disabled={busy} onChange={(e) => { if (e.target.files?.[0]) pick(e.target.files[0]); e.target.value = ''; }} />
        </label>
        {sig && <button className="btn btn-ghost btn-danger" disabled={busy} onClick={async () => { if (!window.confirm('Remove the CEO signature? Letters and certificates cannot be downloaded until a new one is added.')) return; try { await api.del('/letters/ceo-signature'); onChange(); } catch (e) { toast((e as Error).message, true); } }}><Trash2 size={15} /> Remove</button>}
        {sig && <span className="faint small">Updated {fmt(sig.updated_at)}</span>}
      </div>
    </section>
  );
}

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
const plusMonths = (d: string, m: number) => {
  const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + m); x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};

function LetterForm({ p, onClose, onSaved }: { p: Person; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const i = p.internship;
  const start0 = i?.start_date || todayStr();
  const [f, setF] = useState({
    role: i?.role || (p.title ? p.title.replace(/\s*intern$/i, '') : ''),
    start_date: start0, end_date: i?.end_date || plusMonths(start0, 3),
    supervisor_name: i?.supervisor_name || BRAND.ceo, supervisor_title: i?.supervisor_title ?? BRAND.ceoTitle,
    notice_days: i?.notice_days ?? 7, stipend: i?.stipend || '', letter_date: i?.letter_date || todayStr(),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.put<{ needs_reaccept: boolean }>(`/letters/intern/${p.user_id}`, { ...f, notice_days: Number(f.notice_days), stipend: f.stipend.trim() || null, supervisor_title: f.supervisor_title.trim() || null });
      toast(i ? (r.needs_reaccept ? `Saved. ${p.name} has been asked to accept the updated letter.` : 'Letter saved') : `Letter prepared. ${p.name} has been notified.`);
      onSaved();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Delete ${p.name}'s joining letter? Its reference number will not be reused.`)) return;
    try { await api.del(`/letters/intern/${p.user_id}`); toast('Letter deleted'); onSaved(); } catch (err) { toast((err as Error).message, true); }
  }
  return (
    <Modal title={`${i ? 'Edit' : 'Prepare'} joining letter — ${p.nda_name || p.name}`} onClose={onClose} footer={
      <>
        {i && !i.cert_ref && <button type="button" className="btn btn-ghost btn-danger" style={{ marginRight: 'auto' }} onClick={remove}><Trash2 size={15} /> Delete</button>}
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" form="letter-form" disabled={busy}>{busy ? 'Saving…' : i ? 'Save changes' : 'Prepare and notify'}</button>
      </>
    }>
      <form id="letter-form" className="stack" style={{ gap: 12 }} onSubmit={submit}>
        {i?.accepted_at && <p className="notice info">Already accepted. Changing the role, dates, supervisor, notice or stipend asks {p.name} to accept again.</p>}
        <div className="field"><label htmlFor="lf-role">Internship role</label><input id="lf-role" className="input" required value={f.role} onChange={set('role')} placeholder="e.g. Social Media, Graphic Design, Web Development" /><span className="faint small">Printed as “{(f.role || 'Role').replace(/\s*intern$/i, '')} Intern”.</span></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="lf-s">Start date</label><input id="lf-s" type="date" className="input" required value={f.start_date} onChange={set('start_date')} /></div>
          <div className="field"><label htmlFor="lf-e">End date</label><input id="lf-e" type="date" className="input" required value={f.end_date} onChange={set('end_date')} /></div>
        </div>
        <div className="row" style={{ gap: 6, marginTop: -4 }}>{[1, 2, 3, 6].map((m) => <button type="button" key={m} className="btn btn-sm btn-ghost" onClick={() => setF({ ...f, end_date: plusMonths(f.start_date, m) })}>{m} month{m > 1 ? 's' : ''}</button>)}</div>
        <div className="form-grid">
          <div className="field"><label htmlFor="lf-sn">Supervisor</label><input id="lf-sn" className="input" required value={f.supervisor_name} onChange={set('supervisor_name')} /></div>
          <div className="field"><label htmlFor="lf-st">Supervisor's designation</label><input id="lf-st" className="input" value={f.supervisor_title} onChange={set('supervisor_title')} /></div>
        </div>
        <div className="form-grid">
          <div className="field"><label htmlFor="lf-n">Notice period (days)</label><input id="lf-n" type="number" min={1} max={60} className="input num" value={f.notice_days} onChange={set('notice_days')} /></div>
          <div className="field"><label htmlFor="lf-d">Letter date</label><input id="lf-d" type="date" className="input" value={f.letter_date} onChange={set('letter_date')} /></div>
        </div>
        <div className="field"><label htmlFor="lf-p">Stipend <span className="faint">(leave empty for an unpaid internship)</span></label><input id="lf-p" className="input" value={f.stipend} onChange={set('stipend')} placeholder="e.g. PKR 15,000 per month" /></div>
        {!i && <p className="faint small">A reference number like RTL/HR/INT/{f.letter_date.slice(0, 4)}/0001 is assigned. {p.name} is notified and can accept and download once the NDA is signed.</p>}
      </form>
    </Modal>
  );
}

function CertForm({ p, onClose, onSaved }: { p: Person; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const i = p.internship!;
  const [completed, setCompleted] = useState(i.cert_completed_on || (i.end_date < todayStr() ? i.end_date : todayStr()));
  const [remark, setRemark] = useState(i.cert_remark || '');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/letters/intern/${p.user_id}/certificate`, { completed_on: completed, remark: remark.trim() || null });
      toast(i.cert_ref ? 'Certificate updated' : `Certificate issued. ${p.name} has been notified.`);
      onSaved();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }
  async function revoke(restore: boolean) {
    if (!restore && !window.confirm('Withdraw this certificate? It stops downloading and the verification page shows it as withdrawn.')) return;
    try { await api.post(`/letters/intern/${p.user_id}/certificate/revoke`, { restore }); toast(restore ? 'Certificate restored' : 'Certificate withdrawn'); onSaved(); } catch (err) { toast((err as Error).message, true); }
  }
  return (
    <Modal title={`${i.cert_ref ? 'Certificate' : 'Issue certificate'} — ${p.nda_name || p.name}`} onClose={onClose} footer={
      <>
        {i.cert_ref && (i.cert_revoked_at
          ? <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={() => revoke(true)}><Undo2 size={15} /> Restore</button>
          : <button type="button" className="btn btn-ghost btn-danger" style={{ marginRight: 'auto' }} onClick={() => revoke(false)}><Ban size={15} /> Withdraw</button>)}
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" form="cert-form" disabled={busy}>{busy ? 'Saving…' : i.cert_ref ? 'Save changes' : 'Issue certificate'}</button>
      </>
    }>
      <form id="cert-form" className="stack" style={{ gap: 12 }} onSubmit={submit}>
        {i.cert_ref && <p className="muted small">Certificate No. <b>{i.cert_ref}</b>, issued {fmt(i.cert_issued_on)}. The number stays the same when you edit.</p>}
        <p className="muted small">{i.role} Intern · {fmt(i.start_date)} – {fmt(i.end_date)}</p>
        <div className="field"><label htmlFor="cf-d">Completed on</label><input id="cf-d" type="date" className="input" required value={completed} onChange={(e) => setCompleted(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="cf-r">Short appreciation <span className="faint">(optional, printed on the certificate)</span></label>
          <textarea id="cf-r" className="input" rows={2} maxLength={220} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. Consistently delivered high-quality content and grew the NET360 audience" />
          <span className="faint small">{remark.length}/220</span>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Public verification page ---------------- */

interface Verified { valid: boolean; status: 'valid' | 'withdrawn'; type: string; ref: string; name: string; role: string; period: string; issued_on: string; issuer: string }

export function VerifyPage({ code }: { code: string }) {
  const { data, error, loading } = useData<Verified>(`/verify/${encodeURIComponent(code)}`);
  return (
    <div className="verify-page">
      <div className="verify-card">
        <header><img src={BRAND.logo} alt="RTL" /><div><b>{BRAND.legal}</b><span>Document verification</span></div></header>
        {loading && !data && !error ? <Loading /> : !data ? (
          <div className="verify-state bad"><ScrollText /><div><h1>Not found</h1><p>No letter or certificate matches the code <b className="num">{code}</b>. Check the code and try again, or contact {BRAND.email}.</p></div></div>
        ) : (
          <>
            <div className={`verify-state ${data.valid ? 'ok' : 'bad'}`}>
              {data.valid ? <CheckCircle2 /> : <Ban />}
              <div><h1>{data.valid ? 'Genuine document' : 'Withdrawn'}</h1><p>{data.valid ? `This ${data.type.toLowerCase()} was issued by RTL and is valid.` : `This ${data.type.toLowerCase()} was issued by RTL but has since been withdrawn.`}</p></div>
            </div>
            <dl className="verify-dl">
              <dt>Document</dt><dd>{data.type}</dd>
              <dt>Reference</dt><dd className="num">{data.ref}</dd>
              <dt>Issued to</dt><dd>{data.name}</dd>
              <dt>Role</dt><dd>{data.role}</dd>
              <dt>Period</dt><dd>{data.period}</dd>
              <dt>Issued on</dt><dd>{data.issued_on}</dd>
            </dl>
          </>
        )}
        <footer>{BRAND.email} · {BRAND.phone} · {BRAND.websiteLabel}</footer>
      </div>
    </div>
  );
}
