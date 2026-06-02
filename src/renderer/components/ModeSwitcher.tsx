import React from 'react';
import { ALL_MODES, modeLabel, modeDescription, type Mode } from '../../shared/mode';

interface Props {
  mode: Mode;
  isPro: boolean;
  onChange: (mode: Mode) => void;
  // Called when a free-tier user clicks a mode that's gated as Pro.
  onUpgradeRequired: (mode: Mode) => void;
}

export function ModeSwitcher({ mode, isPro, onChange, onUpgradeRequired }: Props) {
  return (
    <div style={styles.root} role="tablist" aria-label="App mode">
      {ALL_MODES.map((m) => {
        const active = m === mode;
        const gated = !isPro && m === 'datahoarder';
        return (
          <button
            key={m}
            role="tab"
            aria-selected={active}
            title={modeDescription(m) + (gated ? ' (Pro)' : '')}
            onClick={() => {
              if (gated) onUpgradeRequired(m);
              else if (!active) onChange(m);
            }}
            style={{
              ...styles.btn,
              ...(active ? styles.btnActive : styles.btnInactive),
            }}
          >
            {modeLabel(m)}
            {gated && <span style={styles.lock}>PRO</span>}
          </button>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'inline-flex',
    background: 'var(--bg2)',
    borderRadius: 6,
    padding: 2,
    gap: 2,
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  btnActive: {
    background: 'var(--accent)',
    color: '#fff',
    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
  },
  btnInactive: {
    background: 'transparent',
    color: 'var(--text2)',
  },
  lock: {
    fontSize: 9,
    fontWeight: 800,
    background: 'rgba(255,255,255,0.18)',
    padding: '1px 5px',
    borderRadius: 3,
    letterSpacing: '0.05em',
  },
};
