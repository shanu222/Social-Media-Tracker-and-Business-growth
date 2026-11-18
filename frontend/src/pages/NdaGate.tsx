import { useEffect, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from 'react';
import { CheckCircle2, Download, Eraser, LogOut, PenLine, ShieldCheck, Upload } from 'lucide-react';
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
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [sig, setSig] = useState<string | null>(null);
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

  const cnicOk = cnic.replace(/\D/g, '').length === 13;
  const ready = name.trim().length >= 3 && cnicOk && !!sig && agree;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      onSigned(await api.post<SignedNda>('/nda/sign', { full_name: name.trim(), guardian: guardian.trim() || undefined, cnic, signature: sig, agree: true }));
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
        <p className="muted small">Your CNIC and signature are encrypted and visible only to you and the company admin.</p>
        <div className="field"><label htmlFor="nn">Full name (as on CNIC)</label><input id="nn" className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
        <div className="field"><label htmlFor="ng">Father's / husband's name <span className="faint">(optional)</span></label><input id="ng" className="input" value={guardian} onChange={(e) => setGuardian(e.target.value)} placeholder="e.g. D/O Muhammad Batool" /></div>
        <div className="field">
          <label htmlFor="nc">CNIC number</label>
          <input id="nc" className="input num" inputMode="numeric" required placeholder="12345-1234567-1" value={cnic} onChange={(e) => setCnic(formatCnic(e.target.value))} aria-invalid={cnic.length > 0 && !cnicOk} />
          {cnic.length > 0 && !cnicOk && <span className="err-text small">13 digits are needed.</span>}
        </div>
        <div className="field">
          <label>Signature</label>
          <div className="seg" role="tablist">
            <button type="button" className={mode === 'draw' ? 'on' : ''} onClick={() => { setMode('draw'); setSig(null); }}><PenLine size={14} /> Draw</button>
            <button type="button" className={mode === 'upload' ? 'on' : ''} onClick={() => { setMode('upload'); setSig(null); }}><Upload size={14} /> Upload image</button>
          </div>
          {mode === 'draw' ? <SignaturePad onChange={setSig} /> : <SignatureUpload value={sig} onChange={setSig} />}
        </div>
        <label className={`check ${!read ? 'faint' : ''}`}>
          <input type="checkbox" checked={agree} disabled={!read} onChange={(e) => setAgree(e.target.checked)} />
          <span>I have read the agreement and I agree to keep all company information, products and passwords confidential.</span>
        </label>
        {!read && <p className="faint small">Scroll to the end of the agreement to continue.</p>}
        <button className="btn btn-primary btn-lg" disabled={!ready || busy}>{busy ? 'Signing…' : 'Sign agreement'}</button>
      </form>
    </div>
  );
}

function SignaturePad({ onChange }: { onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * ratio; c.height = h * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.4; ctx.strokeStyle = '#0a1a3d';
  }, []);

  const pos = (e: RPointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: RPointerEvent<HTMLCanvasElement>) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; last.current = pos(e); };
  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const p = pos(e), ctx = ref.current!.getContext('2d')!;
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p; strokes.current++;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false; last.current = null;
    onChange(strokes.current > 8 ? ref.current!.toDataURL('image/png') : null);
  };
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); strokes.current = 0; onChange(null); };

  return (
    <div className="sig-pad">
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Draw your signature" />
      <span className="sig-hint">Sign here with your mouse, finger or stylus</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={clear}><Eraser size={14} /> Clear</button>
    </div>
  );
}

function SignatureUpload({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const toast = useToast();
  function pick(file: File) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) return toast('Choose a PNG or JPG image of your signature.', true);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Shrink large photos so the upload stays small
        const scale = Math.min(1, 900 / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        onChange(c.toDataURL('image/jpeg', 0.9));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }
  return (
    <div className="sig-upload">
      {value ? <img src={value} alt="Your signature" /> : <span className="faint small">A clear photo or scan of your signature on white paper</span>}
      <label className="btn btn-sm">
        <Upload size={14} /> {value ? 'Choose another' : 'Choose image'}
        <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </label>
    </div>
  );
}

/** Admin: one person's signed agreement (used in Settings → Team). */
export function useSignedNda(userId: number | null) {
  return useData<SignedNda>(userId ? `/nda/user/${userId}` : null);
}
