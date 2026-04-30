import React, { useState } from 'react';
import { LicenseInfo } from '../../shared/types';

interface Props {
  license: LicenseInfo | null;
  onClose: () => void;
  onActivated: () => void;
}

export function LicenseModal({ license, onClose, onActivated }: Props) {
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleActivate = async () => {
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
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.title}>License</div>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
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
            <div style={styles.hint}>Enter your license key to unlock Pro features.</div>
            <input
              style={{ ...styles.input, marginTop: 12 }}
              placeholder="PXLP-XXXX-XXXX-XXXX-XXXX"
              value={key}
              onChange={e => setKey(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleActivate()}
              spellCheck={false}
            />
            <input
              style={styles.input}
              placeholder="your@email.com"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleActivate()}
            />
            {error && <div style={styles.errorMsg}>{error}</div>}
            <button
              className="btn-primary"
              onClick={handleActivate}
              disabled={busy}
              style={{ width: '100%', marginTop: 8 }}
            >
              {busy ? 'Activating…' : 'Activate'}
            </button>
            <div style={styles.buyHint}>
              Don't have a key?{' '}
              <span
                style={{ color: 'var(--accent)', cursor: 'pointer' }}
                onClick={() => window.electronAPI.openPath('https://pixelpusher.app/#pricing')}
              >
                Get Pro for $12
              </span>
            </div>
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
};
