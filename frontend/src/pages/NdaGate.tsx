import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Download, LogOut, ShieldCheck, Upload } from 'lucide-react';
import { api, download } from '../api';
import { useAuth, useData, useToast, Loading, ErrorBox } from '../lib';
import { NdaLetter, type NdaSection, type SignedNda } from './NdaLetter';

interface NdaInfo { version: string; title: string; signed: boolean; prefill: { full_name: string; role_title: string }; sections: NdaSection[]; signature: SignedNda | null }

const formatCnic = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 13);
  return [d.slice(0, 5), d.slice(5, 12), d.slice(12)].filter(Boolean).join('-');
};

/** Shown instead of the app until the team member signs the confidentiality agreement. */
export default function NdaGate() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useData<NdaInfo>('/nda');
  const [signed, setSigned] = useState<SignedNda | null>(null);

  useEffect(() => { if (data?.signature) setSigned(data.signature); }, [data]);

  if (loading && !data) return <div className="nda-page"><Loading /></div>;
  if (error || !data) return <div className="nda-page"><ErrorBox error={error || ''} retry={reload} /></div>;

  const enter = () => setUser(user ? { ...user, nda_required: false } : user);

  return (
    <div className="nda-page">
      <div className="nda-top">
        <div className="nda-steps">
          <span className={!signed ? 'on' : 'done'}>{signed ? <CheckCircle2 size={15} /> : '1'} Read and sign</span>
          <span className={signed ? 'on' : ''}>2 Review your signed copy</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={14} /> Sign out</button>
      </div>

      {!signed ? (
        <SignStep info={data} onSigned={(s) => { setSigned(s); toast('Agreement signed'); window.scrollTo({ top: 0 }); }} />
      ) : (
        <div className="nda-done">
          <div className="nda-done-head">
            <ShieldCheck size={22} />
            <div><h2>Thank you, {signed.full_name.split(' ')[0]}.</h2><p>Your signed copy is below. You can download it any time from Settings.</p></div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" onClick={() => download('/nda/pdf', `NDA-${signed.full_name}.pdf`).catch((e) => toast(e.message, true))}><Download size={15} /> Download PDF</button>
              <button className="btn btn-primary" onClick={enter}>Continue to Growth Desk</button>
            </div>
          </div>
          <div className="nda-paper"><NdaLetter title={data.title} sections={signed.sections} signed={signed} /></div>
          <div className="nda-bottom"><button className="btn btn-primary btn-lg" onClick={enter}>Continue to Growth Desk</button></div>
        </div>
      )}
    </div>
  );
}

function SignStep({ info, onSigned }: { info: NdaInfo; onSigned: (s: SignedNda) => void }) {
  const toast = useToast();
  const [name, setName] = useState(info.prefill.full_name);
  const [guardian, setGuardian] = useState('');
  const [cnic, setCnic] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [read, setRead] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setRead(true), { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();
  const cnicOk = cnic.replace(/\D/g, '').length === 13;
  const phoneDigits = phone.replace(/\D/g, '').replace(/^92/, '0');
  const phoneOk = /^03\d{9}$/.test(phoneDigits);
  const typedOk = typed.trim().length >= 3 && norm(typed) === norm(name);
  const ready = name.trim().length >= 3 && cnicOk && phoneOk && address.trim().length >= 10 && !!front && !!back && !!sig && typedOk && agree;
  const missing = [
    !cnicOk && 'CNIC', !phoneOk && 'mobile number', address.trim().length < 10 && 'address',
    !front && 'CNIC front', !back && 'CNIC back', !sig && 'signature', !typedOk && 'typed name', !agree && 'agreement tick',
  ].filter(Boolean) as string[];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      onSigned(await api.post<SignedNda>('/nda/sign', {
        full_name: name.trim(), guardian: guardian.trim() || undefined, cnic, phone, address: address.trim(),
        typed_name: typed.trim(), signature: sig, cnic_front: front, cnic_back: back, agree: true,
      }));
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <div className="nda-grid">
      <div className="nda-paper scroll">
        <NdaLetter title={info.title} sections={info.sections} />
        <div ref={endRef} className="nda-end">End of agreement</div>
      </div>

      <form className="panel nda-form" onSubmit={submit}>
        <h2>Sign the agreement</h2>
        <p className="muted small">Your CNIC, address and images are encrypted and visible only to you and the company admin.</p>

        <fieldset className="nda-fs">
          <legend>1. Your details</legend>
          <div className="field"><label htmlFor="nn">Full name (as on CNIC)</label><input id="nn" className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
          <div className="field"><label htmlFor="ng">Father's / husband's name <span className="faint">(optional)</span></label><input id="ng" className="input" value={guardian} onChange={(e) => setGuardian(e.target.value)} placeholder="e.g. D/O Muhammad Batool" /></div>
          <div className="field">
            <label htmlFor="nc">CNIC number</label>
            <input id="nc" className="input num" inputMode="numeric" required placeholder="12345-1234567-1" value={cnic} onChange={(e) => setCnic(formatCnic(e.target.value))} aria-invalid={cnic.length > 0 && !cnicOk} />
            {cnic.length > 0 && !cnicOk && <span className="err-text small">13 digits are needed.</span>}
          </div>
          <div className="field">
            <label htmlFor="np">Mobile number</label>
            <input id="np" className="input num" inputMode="tel" required placeholder="0300 1234567" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={phone.length > 3 && !phoneOk} autoComplete="tel" />
            {phone.length > 3 && !phoneOk && <span className="err-text small">Enter a Pakistani mobile number, e.g. 0300 1234567.</span>}
          </div>
          <div className="field"><label htmlFor="na">Home address</label><textarea id="na" className="input" rows={2} required value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House, street, area, city" autoComplete="street-address" /></div>
        </fieldset>

        <fieldset className="nda-fs">
          <legend>2. CNIC images</legend>
          <div className="nda-cnic">
            <ImageUpload label="Front of CNIC" hint="Clear photo, all corners visible" value={front} onChange={setFront} maxWidth={1600} />
            <ImageUpload label="Back of CNIC" hint="Clear photo, all corners visible" value={back} onChange={setBack} maxWidth={1600} />
          </div>
        </fieldset>

        <fieldset className="nda-fs">
          <legend>3. Sign</legend>
          <ImageUpload label="Your signature" hint="Sign on plain white paper and upload a clear photo or scan" value={sig} onChange={setSig} maxWidth={900} />
          <div className="field">
            <label htmlFor="nt">Type your full name to sign</label>
            <input id="nt" className="input nda-typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name || 'Your full name'} aria-invalid={typed.length > 2 && !typedOk} />
            {typed.length > 2 && !typedOk && <span className="err-text small">Must match your full name: {name}</span>}
          </div>
          <label className={`check ${!read ? 'faint' : ''}`}>
            <input type="checkbox" checked={agree} disabled={!read} onChange={(e) => setAgree(e.target.checked)} />
            <span>I have read the agreement, my details are true, and I agree to keep all company information, products and passwords confidential.</span>
          </label>
          {!read && <p className="faint small">Scroll to the end of the agreement to continue.</p>}
        </fieldset>
        <button className="btn btn-primary btn-lg" disabled={!ready || busy}>{busy ? 'Signing…' : 'Sign agreement'}</button>
        {!ready && missing.length > 0 && <p className="faint small" style={{ marginTop: -6 }}>Still needed: {missing.join(', ')}.</p>}
      </form>
    </div>
  );
}

function ImageUpload({ label, hint, value, onChange, maxWidth }: { label: string; hint: string; value: string | null; onChange: (v: string | null) => void; maxWidth: number }) {
  const toast = useToast();
  function pick(file: File) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) return toast('Choose a PNG or JPG image.', true);
    if (file.size > 15 * 1024 * 1024) return toast('That image is too large. Choose one under 15 MB.', true);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Resize so uploads stay small but readable
        const scale = Math.min(1, maxWidth / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        onChange(c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => toast('That image could not be read. Try another.', true);
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }
  return (
    <div className={`img-up ${value ? 'has' : ''}`}>
      <span className="img-up-l">{label}</span>
      {value ? <img src={value} alt={label} /> : <span className="faint small">{hint}</span>}
      <label className="btn btn-sm">
        <Upload size={14} /> {value ? 'Replace' : 'Upload'}
        <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { if (e.target.files?.[0]) pick(e.target.files[0]); e.target.value = ''; }} />
      </label>
    </div>
  );
}

/** Admin: one person's signed agreement (used in Settings → Team). */
export function useSignedNda(userId: number | null) {
  return useData<SignedNda>(userId ? `/nda/user/${userId}` : null);
}
