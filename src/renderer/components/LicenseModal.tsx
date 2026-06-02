import React, { useState, useEffect, useRef } from 'react';
import { LicenseInfo } from '../../shared/types';
import { PURCHASE_URL, PRICE_LABEL, PRICING_TAGLINE, type ProFeature } from '../../shared/pro-features';

interface Props {
  license: LicenseInfo | null;
  onClose: () => void;
  onActivated: () => void;
  // When the modal is opened by a feature gate (rather than the gear icon),
  // pass the reason so the user sees what they were trying to do.
  prompt?: { feature: ProFeature; reason: string } | null;
}

const PRO_BENEFITS = [
  'Organize unlimited files',
  'Local AI search across your library',
  'DataHoarder mode (PDFs, docs, audio, design)',
  'Apple Photos library import',
  'Auto-cluster docs into smart folders',
  'Watch folders for hands-off organizing',
];

export function LicenseModal({ license, onClose, onActivated, prompt }: Props) {
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // a11y: ESC-to-close + initial focus + click-outside-to-dismiss.
  // role/aria attributes below let screen readers announce as a modal.
  const firstFocusRef = useRef<HTMLInputElement | HTMLButtonElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Move focus into the modal on mount so keyboard users land somewhere
    // sensible instead of the body.
    queueMicrotask(() => firstFocusRef.current?.focus());
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleActivate = async () => {
    if (busy) return; // guard against double-submit
    if (!key.trim() || !email.trim()) { setError('Enter your license key and email.'); return; }
    setBusy(true);
    setError('');
    try {
      const ok = await window.electronAPI.activateLicense(key.trim(), email.trim());
      if (ok) {
        setSuccess(true);
        onActivated();
      } else {
        setError('Invalid license key. Please check and try again.');
      }
    } catch {
      setError('Activation failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async () => {
    await window.electronAPI.deactivateLicense();
    onActivated();
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={styles.modal}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="license-modal-title"
      >
        <div style={styles.header}>
          <div id="license-modal-title" style={styles.title}>License</div>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close">✕</button>
        </div>

        {success ? (
          <div style={styles.body}>
            <div style={styles.successIcon}>✓</div>
            <div style={styles.successText}>License activated! Enjoy Pro features.</div>
            <button className="btn-primary" onClick={onClose} style={{ marginTop: 16, width: '100%' }}>
              Close
            </button>
          </div>
        ) : license?.status === 'valid' ? (
          <div style={styles.body}>
            <div style={styles.activeRow}>
              <span style={styles.activeBadge}>PRO</span>
              <span style={styles.activeEmail}>{license.email}</span>
            </div>
            <div style={styles.activeKey}>{license.key}</div>
            {license.activatedAt && (
              <div style={styles.hint}>
                Activated {new Date(license.activatedAt).toLocaleDateString()}
              </div>
            )}
            <button className="btn-secondary" onClick={handleDeactivate} style={{ marginTop: 16, width: '100%', color: 'var(--error)', borderColor: 'var(--error)' }}>
              Deactivate License
            </button>
          </div>
        ) : (
          <div style={styles.body}>
            <div style={styles.freeBadge}>Free Tier</div>
            {prompt && (
              <div style={styles.promptBanner}>{prompt.reason}</div>
            )}
            <ul style={styles.benefitList}>
              {PRO_BENEFITS.map((b) => (
                <li key={b} style={styles.benefitItem}>
                  <span style={styles.benefitCheck}>✓</span>
                  {b}
                </li>
              ))}
            </ul>
            <button
              className="btn-primary"
              onClick={() => window.electronAPI.openPath(PURCHASE_URL)}
              style={{ width: '100%', marginTop: 4 }}
            >
              Get Pro for {PRICE_LABEL}
            </button>
            <div style={styles.tagline}>{PRICING_TAGLINE}</div>

            <div style={styles.divider} />

            <div style={styles.hint}>Already bought? Enter your key:</div>
            <input
              ref={el => { if (el && !firstFocusRef.current) firstFocusRef.current = el; }}
              style={styles.input}
              placeholder="PXLP-XXXX-XXXX-XXXX-XXXX"
              aria-label="License key"
              value={key}
              onChange={e => setKey(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleActivate()}
              spellCheck={false}
            />
            <input
              style={styles.input}
              placeholder="your@email.com"
              aria-label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleActivate()}
            />
            {error && <div style={styles.errorMsg}>{error}</div>}
            <button
              className="btn-secondary"
              onClick={handleActivate}
              disabled={busy}
              style={{ width: '100%' }}
            >
              {busy ? 'Activating…' : 'Activate'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, width: 400, maxWidth: '90vw', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px', borderBottom: '1px solid var(--border)',
  },
  title: { fontWeight: 700, fontSize: 15 },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--text2)',
    fontSize: 14, padding: '2px 6px', cursor: 'pointer',
  },
  body: {
    padding: '20px 20px 24px',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  input: { width: '100%', fontSize: 13, padding: '7px 10px' },
  errorMsg: { color: 'var(--error)', fontSize: 12 },
  hint: { fontSize: 12, color: 'var(--text2)' },
  buyHint: { fontSize: 12, color: 'var(--text2)', textAlign: 'center', marginTop: 4 },
  freeBadge: {
    display: 'inline-flex', alignSelf: 'flex-start',
    background: 'var(--bg2)', color: 'var(--text2)',
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  activeBadge: {
    background: 'var(--accent)', color: '#fff',
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  activeRow: { display: 'flex', alignItems: 'center', gap: 10 },
  activeEmail: { fontSize: 14, color: 'var(--text)' },
  activeKey: {
    fontFamily: 'monospace', fontSize: 13, color: 'var(--text2)',
    background: 'var(--bg2)', padding: '4px 8px', borderRadius: 4,
  },
  successIcon: { fontSize: 40, color: 'var(--success)', textAlign: 'center' },
  successText: { fontSize: 14, textAlign: 'center', color: 'var(--text)' },
  promptBanner: {
    background: 'var(--bg2)', borderLeft: '3px solid var(--accent)',
    padding: '8px 12px', fontSize: 12, color: 'var(--text)', borderRadius: 4,
    margin: '4px 0',
  },
  benefitList: {
    listStyle: 'none', margin: '8px 0 4px', padding: 0,
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  benefitItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 12, color: 'var(--text)',
  },
  benefitCheck: { color: 'var(--accent)', fontWeight: 700, width: 14 },
  tagline: {
    fontSize: 11, color: 'var(--text2)', textAlign: 'center', marginTop: 2,
  },
  divider: {
    height: 1, background: 'var(--border)', margin: '16px 0 4px',
  },
};
