import React from 'react';
import { FileCounts } from '../../shared/types';

interface Props {
  counts: FileCounts | null;
  loading: boolean;
  onDupesClick?: () => void;
}

export function SummaryBar({ counts, loading, onDupesClick }: Props) {
  if (!counts && !loading) return null;

  const fmt = (n: number) => n.toLocaleString();

  return (
    <div style={styles.bar}>
      {loading && !counts ? (
        <span style={styles.chip}>Loading…</span>
      ) : counts ? (
        <>
          <Chip label="Total" value={fmt(counts.total)} />
          <Chip label="With Date" value={fmt(counts.withDate)} color="var(--success)" />
          <Chip label="No Date" value={fmt(counts.unknownDate)} color="var(--warn)" />
          <Chip label="Junk" value={fmt(counts.junk)} color="var(--error)" />
          <Chip label="Size" value={formatSize(counts.totalSize)} />
          {counts.dupes > 0 && (
            <Chip
              label="Dupes"
              value={fmt(counts.dupes)}
              color="var(--warn)"
              onClick={onDupesClick}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function Chip({ label, value, color, onClick }: { label: string; value: string; color?: string; onClick?: () => void }) {
  return (
    <div
      style={{ ...styles.chip, cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
      title={onClick ? `Click to review ${label.toLowerCase()}` : undefined}
    >
      <span style={{ ...styles.chipValue, color: color ?? 'var(--text)' }}>{value}</span>
      <span style={styles.chipLabel}>{label}</span>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 12px',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    overflowX: 'auto',
  },
  chip: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '2px 10px',
    borderRadius: 4,
    background: 'var(--bg2)',
    minWidth: 56,
  },
  chipValue: {
    fontSize: 14,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
  },
  chipLabel: {
    fontSize: 10,
    color: 'var(--text2)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
};
