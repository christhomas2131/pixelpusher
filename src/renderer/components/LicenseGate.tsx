import React, { ReactNode } from 'react';

interface Props {
  isPro: boolean;
  feature: string;
  onUpgrade: () => void;
  children: ReactNode;
}

export function LicenseGate({ isPro, feature, onUpgrade, children }: Props) {
  if (isPro) return <>{children}</>;

  return (
    <div style={styles.wrapper}>
      {children}
      <div style={styles.overlay}>
        <div style={styles.lockIcon}>🔒</div>
        <div style={styles.label}>Pro Feature</div>
        <div style={styles.desc}>{feature}</div>
        <button className="btn-primary" style={styles.btn} onClick={onUpgrade}>
          Upgrade to Pro
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute', inset: 0,
    background: 'rgba(15, 15, 30, 0.85)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 6, zIndex: 10,
    backdropFilter: 'blur(2px)',
  },
  lockIcon: { fontSize: 28 },
  label: { fontWeight: 700, fontSize: 14, color: '#fff' },
  desc: { fontSize: 12, color: 'rgba(255,255,255,0.7)', textAlign: 'center', maxWidth: 200 },
  btn: {
    marginTop: 8, padding: '6px 20px',
    background: 'var(--warn)', fontSize: 13, fontWeight: 700,
  },
};
