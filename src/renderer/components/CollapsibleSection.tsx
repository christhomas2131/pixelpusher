import React, { ReactNode } from 'react';

interface Props {
  title: string;
  summary?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function CollapsibleSection({ title, summary, isOpen, onToggle, children }: Props) {
  return (
    <div style={styles.wrapper}>
      <button style={styles.header} onClick={onToggle}>
        <span style={{ ...styles.chevron, transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ›
        </span>
        <span style={styles.title}>{title}</span>
        {!isOpen && summary && (
          <span style={styles.summary}>{summary}</span>
        )}
      </button>
      <div style={{
        overflow: 'hidden',
        maxHeight: isOpen ? '1200px' : '0',
        opacity: isOpen ? 1 : 0,
        transition: 'max-height 200ms ease, opacity 150ms ease',
      }}>
        <div style={styles.body}>{children}</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    borderBottom: '1px solid var(--border)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    background: 'none',
    border: 'none',
    borderRadius: 0,
    padding: '8px 12px',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'var(--text)',
    userSelect: 'none',
  },
  chevron: {
    fontSize: 14,
    color: 'var(--text2)',
    transition: 'transform 200ms ease',
    display: 'inline-block',
    minWidth: 14,
    lineHeight: 1,
  },
  title: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--text2)',
    flex: 1,
  },
  summary: {
    fontSize: 11,
    color: 'var(--text2)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 160,
  },
  body: {
    padding: '8px 12px 12px',
  },
};
