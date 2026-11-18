import { BRAND } from '../brand';

export interface NdaSection { heading: string | null; body: string }
export interface SignedNda {
  id: number; user_id: number; version: string; full_name: string; guardian: string | null; role_title: string | null;
  cnic: string; signed_at: string; ip: string | null; doc_hash: string; signature: string; sections: NdaSection[];
  typed_name?: string | null; phone?: string | null; address?: string | null; cnic_front?: string | null; cnic_back?: string | null;
}

/** The agreement as a letter. With `signed`, it includes the signature block. */
export function NdaLetter({ title, sections, signed }: { title: string; sections: NdaSection[]; signed?: SignedNda | null }) {
  const date = signed ? new Date(signed.signed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return (
    <article className="nda-letter">
      <header className="nda-head">
        <img src={BRAND.logo} alt="RTL" />
        <div>
          <b>{BRAND.legal}</b>
          <span>{BRAND.email} · {BRAND.phone} · {BRAND.websiteLabel}</span>
        </div>
      </header>
      <div className="nda-rule" />
      <h1>{title}</h1>
      {date && <p className="nda-date">Signed on {date}</p>}
      {sections.map((s, i) => (
        <section key={i} className={s.heading === 'A note before you sign' ? 'nda-note' : ''}>
          {s.heading && <h2>{s.heading}</h2>}
          <p>{s.body}</p>
        </section>
      ))}
      {signed && (
        <div className="nda-sign">
          <div className="nda-sign-box">
            <span className="lbl">Team member</span>
            <img src={signed.signature} alt={`Signature of ${signed.full_name}`} />
            <div className="line" />
            <b>{signed.full_name}</b>
            {signed.guardian && <span>{signed.guardian}</span>}
            <span>CNIC: {signed.cnic}</span>
            <span>Role: {signed.role_title || 'Team Member'}</span>
            {signed.phone && <span>Mobile: {signed.phone}</span>}
            <span>Date: {date}</span>
          </div>
          <div className="nda-sign-box">
            <span className="lbl">For the Company</span>
            <img src={BRAND.logo} alt="" className="seal" />
            <div className="line" />
            <b>{BRAND.ceo}</b>
            <span>{BRAND.ceoTitle}</span>
            <span>{BRAND.legal}</span>
          </div>
        </div>
      )}
      {signed && <p className="nda-evidence">Signed electronically in {BRAND.app}{signed.typed_name ? ` by typing "${signed.typed_name}"` : ''}. Fingerprint {signed.doc_hash.slice(0, 16)}…</p>}
      {signed && (signed.cnic_front || signed.cnic_back || signed.address) && (
        <section className="nda-annex">
          <h2>Annex A — Identity verification</h2>
          <dl>
            <dt>CNIC</dt><dd>{signed.cnic}</dd>
            {signed.phone && <><dt>Mobile</dt><dd>{signed.phone}</dd></>}
            {signed.address && <><dt>Address</dt><dd>{signed.address}</dd></>}
          </dl>
          <div className="nda-cnic-imgs">
            {signed.cnic_front && <figure><img src={signed.cnic_front} alt="CNIC front" /><figcaption>CNIC — front</figcaption></figure>}
            {signed.cnic_back && <figure><img src={signed.cnic_back} alt="CNIC back" /><figcaption>CNIC — back</figcaption></figure>}
          </div>
        </section>
      )}
    </article>
  );
}
