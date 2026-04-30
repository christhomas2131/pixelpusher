import React, { useState } from 'react';
import type { DryRunResult, DryRunNode, OrganizeOptions } from '../../shared/types';

interface Props {
  options: OrganizeOptions;
  result: DryRunResult;
  // True when the parent knows the user is on the free tier and the proposed
  // organize would exceed FREE_FILE_CAP. The component disables the Confirm
  // CTA and surfaces an upgrade banner.
  blockedByTier?: { reason: string; onUpgrade: () => void };
  onConfirm: () => void;
  onBack: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function NodeRow({ node, depth }: { node: DryRunNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  return (
    <>
      <div
        style={{ ...styles.row, paddingLeft: 8 + depth * 14 }}
        onClick={() => hasChildren && setOpen((o) => !o)}
      >
        <span style={styles.arrow}>{hasChildren ? (open ? '▾' : '▸') : ' '}</span>
        <span style={styles.name}>{node.name || '/'}</span>
        {node.internalCollisions > 0 && (
          <span style={styles.collisionBadge} title={`${node.internalCollisions} files map to the same destination filename in this folder`}>
            ⚠ {node.internalCollisions}
          </span>
        )}
        <span style={styles.count}>{node.count.toLocaleString()}</span>
        <span style={styles.bytes}>{formatBytes(node.bytes)}</span>
      </div>
      {open && hasChildren && node.children.map((child) => (
        <NodeRow key={child.name} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function DryRunPreview({ options, result, blockedByTier, onConfirm, onBack }: Props) {
  const hasWarnings = result.unknownDate > 0 || result.internalCollisions > 0 || result.existingConflicts > 0;

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Preview — what will happen if you organize</div>
          <div style={styles.dest}>
            <span style={styles.destLabel}>To:</span>
            <code style={styles.destPath}>{options.destination}</code>
            <span style={styles.destLabel}>Pattern:</span>
            <code style={styles.destPath}>{options.pattern}</code>
            <span style={styles.destLabel}>Mode:</span>
            <span style={styles.modeBadge}>{options.mode}</span>
          </div>
        </div>
        <div style={styles.actions}>
          <button className="btn-secondary" onClick={onBack}>← Back</button>
          {blockedByTier ? (
            <button
              className="btn-primary"
              onClick={blockedByTier.onUpgrade}
              style={styles.confirmBtn}
            >
              Upgrade to Organize
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={onConfirm}
              disabled={result.totalFiles === 0}
              style={styles.confirmBtn}
            >
              Confirm and Organize {result.totalFiles.toLocaleString()} file{result.totalFiles !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      {blockedByTier && (
        <div style={styles.upgradeBanner}>
          <div style={styles.upgradeText}>{blockedByTier.reason}</div>
          <button className="btn-primary" onClick={blockedByTier.onUpgrade} style={{ flexShrink: 0 }}>
            Upgrade
          </button>
        </div>
      )}

      <div style={styles.statBar}>
        <Stat label="Files" value={result.totalFiles.toLocaleString()} />
        <Stat label="Total size" value={formatBytes(result.totalBytes)} />
        <Stat label="Folders" value={result.uniqueFolders.toLocaleString()} />
        {result.unknownDate > 0 && (
          <Stat label="No date" value={result.unknownDate.toLocaleString()} warn />
        )}
        {result.internalCollisions > 0 && (
          <Stat label="Filename collisions" value={result.internalCollisions.toLocaleString()} warn />
        )}
        {result.existingConflicts > 0 && (
          <Stat label="Already at dest" value={result.existingConflicts.toLocaleString()} warn />
        )}
      </div>

      {hasWarnings && (
        <div style={styles.warnings}>
          {result.unknownDate > 0 && (
            <div style={styles.warning}>
              <strong>{result.unknownDate.toLocaleString()}</strong> file{result.unknownDate !== 1 ? 's' : ''} have no usable date and will land in <code>Unknown Date/</code>.
            </div>
          )}
          {result.internalCollisions > 0 && (
            <div style={styles.warning}>
              <strong>{result.internalCollisions.toLocaleString()}</strong> filename collision{result.internalCollisions !== 1 ? 's' : ''} detected — multiple files map to the same destination path. Your conflict strategy is <strong>{options.conflictStrategy}</strong>.
            </div>
          )}
          {result.existingConflicts > 0 && (
            <div style={styles.warning}>
              <strong>{result.existingConflicts.toLocaleString()}+</strong> destination{result.existingConflicts !== 1 ? 's' : ''} already exist on disk (sampled). They'll be handled per your <strong>{options.conflictStrategy}</strong> setting.
            </div>
          )}
        </div>
      )}

      <div style={styles.body}>
        <div style={styles.col}>
          <div style={styles.colHeader}>Proposed structure</div>
          <div style={styles.tree}>
            {result.tree.children.length === 0 ? (
              <div style={styles.empty}>No files to organize.</div>
            ) : (
              result.tree.children.map((child) => (
                <NodeRow key={child.name} node={child} depth={0} />
              ))
            )}
          </div>
        </div>

        <div style={styles.col}>
          <div style={styles.colHeader}>Sample (first {result.sample.length})</div>
          <div style={styles.sampleList}>
            {result.sample.length === 0 ? (
              <div style={styles.empty}>—</div>
            ) : (
              result.sample.map((s, i) => (
                <div key={i} style={styles.sampleRow}>
                  <div style={styles.sampleSrc} title={s.source}>{s.source}</div>
                  <div style={styles.sampleArrow}>→</div>
                  <div style={styles.sampleDest} title={s.dest}>{s.dest}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={styles.stat}>
      <div style={{ ...styles.statValue, ...(warn ? { color: 'var(--warn)' } : {}) }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden',
    background: 'var(--bg)',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid var(--border)', gap: 12,
    flexShrink: 0,
  },
  title: { fontWeight: 700, fontSize: 14, color: 'var(--text)' },
  dest: {
    display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, fontSize: 12,
    alignItems: 'center', color: 'var(--text2)',
  },
  destLabel: { color: 'var(--text2)' },
  destPath: {
    background: 'var(--bg2)', padding: '2px 6px', borderRadius: 3,
    fontFamily: 'monospace', color: 'var(--text)',
  },
  modeBadge: {
    background: 'var(--accent)', color: '#fff', padding: '1px 8px',
    borderRadius: 3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  },
  actions: { display: 'flex', gap: 8, flexShrink: 0 },
  confirmBtn: { fontWeight: 700 },
  statBar: {
    display: 'flex', gap: 16, padding: '10px 18px',
    borderBottom: '1px solid var(--border)', flexShrink: 0,
  },
  stat: { display: 'flex', flexDirection: 'column' },
  statValue: { fontSize: 18, fontWeight: 700, color: 'var(--text)' },
  statLabel: { fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  warnings: {
    padding: '8px 18px', borderBottom: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0,
  },
  warning: {
    fontSize: 12, color: 'var(--text)', background: 'var(--bg2)',
    borderLeft: '3px solid var(--warn)', padding: '6px 10px', borderRadius: 3,
  },
  body: { display: 'flex', flex: 1, overflow: 'hidden', gap: 1, background: 'var(--border)' },
  col: { flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  colHeader: {
    padding: '8px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text2)',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    background: 'var(--bg2)', borderBottom: '1px solid var(--border)', flexShrink: 0,
  },
  tree: { padding: '6px 0', overflowY: 'auto', flex: 1, fontSize: 12 },
  row: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px',
    cursor: 'pointer',
  },
  arrow: { color: 'var(--text2)', fontSize: 10, width: 12, flexShrink: 0 },
  name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  count: {
    fontSize: 11, color: 'var(--text2)', background: 'var(--bg2)',
    padding: '0 6px', borderRadius: 3, minWidth: 32, textAlign: 'right',
  },
  bytes: { fontSize: 11, color: 'var(--text2)', minWidth: 60, textAlign: 'right' },
  collisionBadge: {
    fontSize: 10, color: 'var(--warn)', background: 'var(--bg2)',
    padding: '0 6px', borderRadius: 3,
  },
  sampleList: { padding: '4px 0', overflowY: 'auto', flex: 1, fontSize: 11 },
  sampleRow: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '3px 14px',
    fontFamily: 'monospace',
  },
  sampleSrc: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' },
  sampleArrow: { color: 'var(--text2)', flexShrink: 0 },
  sampleDest: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--accent)' },
  empty: { padding: 20, color: 'var(--text2)', fontSize: 12, fontStyle: 'italic', textAlign: 'center' },
  upgradeBanner: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 18px', background: 'var(--bg2)',
    borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent)',
    flexShrink: 0,
  },
  upgradeText: { fontSize: 12, color: 'var(--text)', flex: 1 },
};
