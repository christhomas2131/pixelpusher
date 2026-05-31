import React, { useState, useEffect } from 'react';
import { ScanOptions, ScanDepth, ScanSpeed, ScanProgress } from '../../shared/types';
import { type Mode } from '../../shared/mode';
import { CollapsibleSection } from './CollapsibleSection';
import { SOURCE_BADGE_COLORS } from '../../shared/constants';
import { useAppContext } from '../context/AppContext';

function detectOverlap(folders: string[]): string | null {
  const norm = folders.map(f => f.replace(/\\/g, '/').replace(/\/$/, ''));
  for (let i = 0; i < norm.length; i++) {
    for (let j = 0; j < norm.length; j++) {
      if (i === j) continue;
      if (norm[j].startsWith(norm[i] + '/')) {
        return `"${norm[j].split('/').pop()}" is inside another source — may cause duplicates.`;
      }
    }
  }
  return null;
}

interface Props {
  mode: Mode;
  onScan: (options: ScanOptions) => void;
  onCancel: () => void;
  scanning: boolean;
  done: boolean;
  progress: ScanProgress | null;
  totalFiles?: number;
}

export function ScanPanel({ mode, onScan, onCancel, scanning, done, progress, totalFiles }: Props) {
  const { settings } = useAppContext();
  const [folders, setFolders] = useState<string[]>([]);
  const [depth, setDepth] = useState<ScanDepth>('quick');
  const [speed, setSpeed] = useState<ScanSpeed>('safe');
  const [sourceOpen, setSourceOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(true);

  // Auto-collapse when scan completes
  useEffect(() => {
    if (done) {
      setSourceOpen(false);
      setConfigOpen(false);
    }
  }, [done]);

  const addFolder = async () => {
    const folder = await window.electronAPI.openFolderDialog();
    if (folder && !folders.includes(folder)) {
      setFolders(prev => [...prev, folder]);
    }
  };

  const removeFolder = (f: string) => setFolders(prev => prev.filter(x => x !== f));

  const handleScan = () => {
    if (folders.length === 0) return;
    // Pass the user's `enabledFileCategories` setting through so a
    // DataHoarder-mode scan doesn't silently revert to mode defaults if
    // they've customized categories. (Previously this prop was never sent
    // and main always fell back to `defaultCategoriesForMode(mode)`.)
    onScan({
      sourceFolders: folders,
      scanDepth: depth,
      scanSpeed: speed,
      mode,
      enabledCategories: settings?.enabledFileCategories,
    });
  };

  const sourceSummary = folders.length === 0
    ? 'No folders selected'
    : folders.length === 1
      ? `${shortPath(folders[0])}${totalFiles ? ` (${totalFiles.toLocaleString()} files)` : ''}`
      : `${folders.length} folders${totalFiles ? ` — ${totalFiles.toLocaleString()} files` : ''}`;

  const configSummary = `${depth === 'quick' ? 'Quick' : 'Full'} · ${speed}`;

  return (
    <div style={styles.panel}>
      {/* Source folders section */}
      <CollapsibleSection
        title="Source Folders"
        summary={sourceSummary}
        isOpen={sourceOpen}
        onToggle={() => setSourceOpen(o => !o)}
      >
        <div style={styles.folderList}>
          {folders.length === 0 && (
            <div style={styles.emptyHint}>Click "+ Add Source" to choose a folder.</div>
          )}
          {folders.map((f, i) => (
            <div key={f} style={styles.folderRow}>
              <span style={{
                ...styles.folderBadge,
                background: SOURCE_BADGE_COLORS[i % SOURCE_BADGE_COLORS.length],
              }}>
                {String.fromCharCode(65 + i)}
              </span>
              <span style={styles.folderPath} title={f}>{f}</span>
              <button
                onClick={() => removeFolder(f)}
                disabled={scanning}
                style={styles.removeBtn}
                title="Remove"
              >×</button>
            </div>
          ))}
          {(() => { const w = detectOverlap(folders); return w ? <div style={styles.overlapWarn}>⚠ {w}</div> : null; })()}
        </div>
        <button
          className="btn-secondary"
          onClick={addFolder}
          disabled={scanning}
          style={{ marginTop: 8, width: '100%', fontSize: 12 }}
        >
          + Add Source
        </button>
      </CollapsibleSection>

      {/* Scan config section */}
      <CollapsibleSection
        title="Scan Options"
        summary={configSummary}
        isOpen={configOpen}
        onToggle={() => setConfigOpen(o => !o)}
      >
        <div style={styles.optionGroup}>
          <div style={styles.optionLabel}>Scan Depth</div>
          <div style={styles.btnGroup}>
            <ToggleBtn active={depth === 'quick'} onClick={() => setDepth('quick')} disabled={scanning}>
              Quick Scan
            </ToggleBtn>
            <ToggleBtn active={depth === 'full'} onClick={() => setDepth('full')} disabled={scanning}>
              Full Scan
            </ToggleBtn>
          </div>
          <div style={styles.optionHint}>
            {depth === 'quick'
              ? 'Extracts dates only. Fast. Best for large libraries.'
              : 'Extracts all metadata: dates, camera, GPS. Slower.'}
          </div>
        </div>

        <div style={{ ...styles.optionGroup, marginTop: 12 }}>
          <div style={styles.optionLabel}>Scan Speed</div>
          <div style={styles.btnGroup}>
            <ToggleBtn active={speed === 'safe'} onClick={() => setSpeed('safe')} disabled={scanning}>
              Safe
            </ToggleBtn>
            <ToggleBtn active={speed === 'balanced'} onClick={() => setSpeed('balanced')} disabled={scanning}>
              Balanced
            </ToggleBtn>
            <ToggleBtn active={speed === 'fast'} onClick={() => setSpeed('fast')} disabled={scanning}>
              Fast
            </ToggleBtn>
          </div>
          <div style={styles.optionHint}>
            {speed === 'safe'
              ? 'Recommended for large libraries or older machines.'
              : speed === 'balanced'
              ? 'Good balance of speed and stability.'
              : 'Maximum speed. May stress slower drives.'}
          </div>
        </div>
      </CollapsibleSection>

      {/* Progress section */}
      {scanning && progress && (
        <div style={styles.progressSection}>
          <ProgressDisplay progress={progress} />
        </div>
      )}

      {/* Action button */}
      <div style={styles.actions}>
        {!scanning ? (
          <button
            className="btn-primary"
            onClick={handleScan}
            disabled={folders.length === 0}
            style={{ width: '100%' }}
          >
            Scan Folder{folders.length > 1 ? 's' : ''}
          </button>
        ) : (
          <button className="btn-danger" onClick={onCancel} style={{ width: '100%' }}>
            Cancel Scan
          </button>
        )}
      </div>
    </div>
  );
}

function ProgressDisplay({ progress }: { progress: ScanProgress }) {
  const isDiscovering = progress.phase === 'discovering';
  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div style={styles.progress}>
      <div style={styles.progressBar}>
        <div style={{
          ...styles.progressFill,
          width: isDiscovering ? '100%' : `${pct}%`,
          animation: isDiscovering ? 'ppPulse 1.5s ease-in-out infinite' : undefined,
        }} />
      </div>

      <div style={styles.progressStats}>
        {isDiscovering ? (
          <span>Discovering files… <strong>{progress.discovered.toLocaleString()}</strong> found</span>
        ) : (
          <>
            <span>
              <strong>{progress.processed.toLocaleString()}</strong>
              {' / '}
              <strong>{progress.total.toLocaleString()}</strong>
              {' files'}
              {progress.total > 0 && <span style={{ color: 'var(--text2)' }}> ({pct}%)</span>}
            </span>
            {progress.eta !== null && progress.eta > 0 && (
              <span style={{ color: 'var(--text2)' }}>{formatETA(progress.eta)} remaining</span>
            )}
          </>
        )}
      </div>

      {!isDiscovering && progress.totalWaves > 0 && (
        <div style={styles.progressWave}>
          Extracting metadata — Wave {progress.wave} of {progress.totalWaves}
          {progress.filesPerSecond > 0 && (
            <span style={{ color: 'var(--text2)' }}> · {Math.round(progress.filesPerSecond)} files/s</span>
          )}
        </div>
      )}
    </div>
  );
}

function ToggleBtn({ active, onClick, disabled, children }: {
  active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: '5px 0',
        fontSize: 12,
        fontWeight: active ? 700 : 400,
        background: active ? 'var(--accent)' : 'var(--bg2)',
        color: active ? '#fff' : 'var(--text)',
        border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function formatETA(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `~${h}h ${m}m`;
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--surface)',
    width: '100%',
    minWidth: 0,
  },
  folderList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  folderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--bg2)',
    borderRadius: 4,
    padding: '4px 6px',
  },
  folderBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#fff',
    minWidth: 18,
    height: 18,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  overlapWarn: {
    fontSize: 11,
    color: 'var(--warn)',
    padding: '4px 2px',
    lineHeight: 1.4,
  },
  folderPath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11,
    color: 'var(--text)',
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text2)',
    fontSize: 14,
    padding: '0 2px',
    cursor: 'pointer',
    lineHeight: 1,
    borderRadius: 2,
  },
  emptyHint: {
    fontSize: 12,
    color: 'var(--text2)',
    fontStyle: 'italic',
  },
  optionGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  optionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text2)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  btnGroup: {
    display: 'flex',
    gap: 4,
  },
  optionHint: {
    fontSize: 11,
    color: 'var(--text2)',
    lineHeight: 1.4,
  },
  progressSection: {
    padding: '12px',
    borderTop: '1px solid var(--border)',
  },
  progress: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  progressBar: {
    height: 5,
    background: 'var(--bg2)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'var(--progress-fill)',
    borderRadius: 3,
    transition: 'width 0.4s ease',
  },
  progressStats: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    gap: 4,
    flexWrap: 'wrap',
  },
  progressWave: {
    fontSize: 11,
    color: 'var(--text2)',
  },
  actions: {
    padding: 12,
    marginTop: 'auto',
    borderTop: '1px solid var(--border)',
  },
};
