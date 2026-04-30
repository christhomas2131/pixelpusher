import React from 'react';
import { OrganizeProgress as OrgProgress, OrganizeResult } from '../../shared/types';
import { OrganizeState } from '../hooks/useOrganize';

interface Props {
  state: OrganizeState;
  progress: OrgProgress | null;
  result: OrganizeResult | null;
  error: string | null;
  onCancel: () => void;
  onOpenFolder: (dest: string) => void;
  onNewScan: () => void;
  onDone: () => void;
}

function fmtBytes(b: number): string {
  if (b < 1024)         return `${b} B`;
  if (b < 1024 * 1024)  return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtEta(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function OrganizeProgressView({ state, progress, result, error, onCancel, onOpenFolder, onNewScan, onDone }: Props) {
  if (state === 'organizing' || (state === 'complete' && !result && !error)) {
    const pct = progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;

    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={styles.heading}>Organizing files…</div>

          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${pct}%` }} />
          </div>

          <div style={styles.stats}>
            {progress ? (
              <>
                <span>{progress.processed.toLocaleString()} / {progress.total.toLocaleString()} files</span>
                <span style={styles.dot}>·</span>
                <span>{fmtBytes(progress.bytesProcessed)} / {fmtBytes(progress.totalBytes)}</span>
                <span style={styles.dot}>·</span>
                <span>~{fmtEta(progress.eta)} remaining</span>
              </>
            ) : (
              <span>Starting…</span>
            )}
          </div>

          {progress?.currentFile && (
            <div style={styles.currentFile} title={progress.currentFile}>
              {progress.currentFile}
            </div>
          )}

          <button className="btn-secondary" style={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (state === 'complete' && result) {
    const hasErrors = result.errors > 0;
    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={styles.icon}>{hasErrors ? '⚠' : '✓'}</div>
          <div style={styles.heading}>
            {hasErrors ? 'Done with errors' : 'Done!'}
          </div>

          <div style={styles.summaryRow}>
            <span style={{ color: 'var(--success)' }}>{result.successful.toLocaleString()} transferred</span>
            {result.skipped > 0 && (
              <><span style={styles.dot}>·</span><span style={{ color: 'var(--text2)' }}>{result.skipped.toLocaleString()} skipped</span></>
            )}
            {result.errors > 0 && (
              <><span style={styles.dot}>·</span><span style={{ color: 'var(--error)' }}>{result.errors.toLocaleString()} errors</span></>
            )}
          </div>

          {result.recentErrors.length > 0 && (
            <div style={styles.errorList}>
              {result.recentErrors.slice(0, 10).map((e, i) => (
                <div key={i} style={styles.errorItem}>{e}</div>
              ))}
              {result.recentErrors.length > 10 && (
                <div style={styles.errorItem}>…and {result.recentErrors.length - 10} more</div>
              )}
            </div>
          )}

          <div style={styles.actions}>
            <button className="btn-primary" onClick={() => onOpenFolder(result.destination)}>
              Open Folder
            </button>
            <button className="btn-secondary" onClick={onNewScan}>
              New Scan
            </button>
            <button className="btn-secondary" onClick={onDone}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={{ ...styles.icon, color: 'var(--error)' }}>✕</div>
          <div style={styles.heading}>Organize failed</div>
          <div style={styles.errorItem}>{error}</div>
          <div style={styles.actions}>
            <button className="btn-secondary" onClick={onNewScan}>New Scan</button>
            <button className="btn-secondary" onClick={onDone}>Dismiss</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: 24,
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 32,
    width: '100%',
    maxWidth: 520,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  heading: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text)',
  },
  icon: {
    fontSize: 36,
    color: 'var(--success)',
    lineHeight: 1,
  },
  progressBar: {
    height: 8,
    background: 'var(--bg2)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'var(--accent)',
    transition: 'width 0.3s ease',
    borderRadius: 4,
  },
  stats: {
    fontSize: 13,
    color: 'var(--text2)',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  dot: {
    color: 'var(--border)',
  },
  currentFile: {
    fontSize: 11,
    color: 'var(--text2)',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cancelBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  summaryRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    fontSize: 14,
    alignItems: 'center',
  },
  errorList: {
    background: 'var(--bg2)',
    borderRadius: 6,
    padding: '8px 10px',
    maxHeight: 160,
    overflowY: 'auto',
  },
  errorItem: {
    fontSize: 11,
    color: 'var(--error)',
    fontFamily: 'monospace',
    lineHeight: 1.6,
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
};
