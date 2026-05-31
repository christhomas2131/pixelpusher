import React, { useState, useEffect } from 'react';
import { FileCounts, OrganizeOptions, OperationMode, ConflictStrategy } from '../../shared/types';
import { resolvePattern, getPatternTokens, PatternContext } from '../../shared/pattern';
import { defaultPatternForMode, type Mode } from '../../shared/mode';
import { useAppContext } from '../context/AppContext';

interface Props {
  sessionId: string;
  mode: Mode;
  counts: FileCounts | null;
  onPreview: (options: OrganizeOptions) => void;
}

type OrgMode = 'date' | 'type';

const PRESETS: { label: string; pattern: string; mode: OrgMode }[] = [
  { label: 'Year/Month',   pattern: '{YYYY}/{MMM}',           mode: 'date' },
  { label: 'Year',         pattern: '{YYYY}',                 mode: 'date' },
  { label: 'Quarter',      pattern: '{YYYY}/{QUARTER}',       mode: 'date' },
  { label: 'By Camera',    pattern: '{YYYY}/{CAMERA}',        mode: 'date' },
  { label: 'Year Range',   pattern: '{YEAR_RANGE}',           mode: 'date' },
  { label: 'By Type',      pattern: '{YYYY} {TYPE_LABEL}',    mode: 'type' },
];

// Pattern defaults per organize-mode, picked off the app mode so the
// DataHoarder profile doesn't snap a user back to photo-style folders
// every time they toggle Date/Type.
function patternForOrgMode(orgMode: OrgMode, appMode: Mode): string {
  if (orgMode === 'date') return defaultPatternForMode(appMode);
  // Type-based default: surface the {TYPE_LABEL} prominently.
  return appMode === 'datahoarder' ? '{TYPE_LABEL}/{YYYY}' : '{YYYY} {TYPE_LABEL}';
}

export function DestinationPanel({ sessionId, mode: appMode, counts, onPreview }: Props) {
  const { settings, refreshSettings } = useAppContext();
  const [destination,      setDestination]      = useState('');
  const [pattern,          setPattern]          = useState(() => defaultPatternForMode(appMode));
  const [orgMode,          setOrgMode]          = useState<OrgMode>('date');
  const [mode,             setMode]             = useState<OperationMode>('copy');
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('rename');

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getPictures().then(p => {
      if (!cancelled) setDestination(d => d || p);
    });
    window.electronAPI.getSettings().then(s => {
      if (cancelled) return;
      // Use a functional setter so a destination the user typed in between
      // the getPictures() and getSettings() resolves doesn't get clobbered.
      if (s.lastDestination) setDestination(d => d || s.lastDestination);
      // Pattern: stored value if set, otherwise the mode's default. This lets
      // a user customize a pattern in DataHoarder mode without it leaking
      // back to PixelPusher mode (and vice versa) when switching.
      setPattern(s.folderPattern || defaultPatternForMode(appMode));
      setMode(s.operationMode);
      setConflictStrategy(s.conflictStrategy);
    });
    return () => { cancelled = true; };
  }, [appMode]);

  // Preview context derived from the actual app mode — DataHoarder previews
  // should show "Documents" / "PDF", not "Photos" / "jpg".
  const previewCtx: PatternContext = {
    date: new Date('2024-03-15T12:00:00Z'),
    cameraModel: appMode === 'datahoarder' ? 'Microsoft Word' : 'iPhone 15 Pro',
    category: appMode === 'datahoarder' ? 'documents' : 'images',
    format: appMode === 'datahoarder' ? 'pdf' : 'jpg',
  };
  const previewName = appMode === 'datahoarder' ? 'document.pdf' : 'photo.jpg';

  const browse = async () => {
    const p = await window.electronAPI.openFolderDialog();
    if (p) setDestination(p);
  };

  const applyPreset = (preset: typeof PRESETS[number]) => {
    setPattern(preset.pattern);
    setOrgMode(preset.mode);
  };

  const preview = pattern
    ? resolvePattern(pattern, previewCtx) + `/${previewName}`
    : `Unknown/${previewName}`;

  const readyCount = counts?.ready ?? 0;

  const handlePreview = () => {
    if (!destination) return;
    onPreview({ sessionId, destination, pattern, mode, conflictStrategy });
    // Merge with current settings — previous version overwrote with hardcoded
    // defaults (windowBounds: null, leftPanelWidth: 280, theme: 'system',
    // enabledFileCategories: ['images','videos']…), nuking the user's prefs
    // on every Preview click.
    if (!settings) return;
    window.electronAPI
      .saveSettings({
        ...settings,
        lastDestination: destination,
        folderPattern: pattern,
        operationMode: mode,
        conflictStrategy,
      })
      .then(() => refreshSettings())
      .catch(() => { /* surfaced via app-wide error UI if it matters */ });
  };

  return (
    <div style={styles.root}>
      <div style={styles.title}>Organize</div>

      {/* Destination */}
      <label style={styles.label} htmlFor="dest-input">Destination</label>
      <div style={styles.row}>
        <input
          id="dest-input"
          style={{ ...styles.input, flex: 1, minWidth: 0 }}
          value={destination}
          onChange={e => setDestination(e.target.value)}
          placeholder="Select destination folder…"
          aria-label="Destination folder"
        />
        <button className="btn-secondary" style={styles.browseBtn} onClick={browse}>
          Browse
        </button>
      </div>

      {/* Mode toggle */}
      <label style={styles.label}>Organize by</label>
      <div style={styles.toggleRow}>
        {(['date', 'type'] as OrgMode[]).map(m => (
          <button
            key={m}
            className={orgMode === m ? 'btn-primary' : 'btn-secondary'}
            style={styles.toggleBtn}
            onClick={() => {
              setOrgMode(m);
              setPattern(patternForOrgMode(m, appMode));
            }}
          >
            {m === 'date' ? 'Date' : 'Type'}
          </button>
        ))}
      </div>

      {/* Presets */}
      <div style={styles.presetRow}>
        {PRESETS.map(p => (
          <button
            key={p.label}
            className="btn-secondary"
            style={{ ...styles.presetBtn, ...(pattern === p.pattern ? styles.presetBtnActive : {}) }}
            onClick={() => applyPreset(p)}
            title={p.pattern}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Pattern input */}
      <label style={styles.label} htmlFor="pattern-input">Folder pattern</label>
      <input
        id="pattern-input"
        style={styles.input}
        value={pattern}
        onChange={e => setPattern(e.target.value)}
        placeholder="{YYYY}/{MMM}"
        aria-label="Folder pattern"
      />
      <div style={styles.tokenRow}>
        {getPatternTokens().map(t => (
          <button
            key={t.token}
            className="btn-secondary"
            style={styles.tokenBtn}
            onClick={() => setPattern(p => p + t.token)}
            title={`${t.description} — e.g. ${t.example}`}
          >
            {t.token}
          </button>
        ))}
      </div>
      <div style={styles.preview}>
        Preview: <span style={styles.previewPath}>{preview}</span>
      </div>

      {/* Operation */}
      <label style={styles.label}>Operation</label>
      <div style={styles.toggleRow}>
        {(['copy', 'move'] as OperationMode[]).map(m => (
          <button
            key={m}
            className={mode === m ? 'btn-primary' : 'btn-secondary'}
            style={styles.toggleBtn}
            onClick={() => setMode(m)}
          >
            {m === 'copy' ? 'Copy' : 'Move'}
          </button>
        ))}
      </div>

      {/* Conflict strategy */}
      <label style={styles.label} htmlFor="conflict-select">If file exists</label>
      <select
        id="conflict-select"
        style={styles.select}
        value={conflictStrategy}
        onChange={e => setConflictStrategy(e.target.value as ConflictStrategy)}
        aria-label="Conflict strategy"
      >
        <option value="rename">Auto-rename</option>
        <option value="skip">Skip</option>
        <option value="overwrite">Overwrite</option>
      </select>

      <button
        className="btn-primary"
        style={styles.organizeBtn}
        disabled={!destination || readyCount === 0}
        onClick={handlePreview}
      >
        Preview {readyCount.toLocaleString()} file{readyCount !== 1 ? 's' : ''}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    padding: '12px 14px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  title: {
    fontWeight: 700,
    fontSize: 13,
    color: 'var(--text)',
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    color: 'var(--text2)',
    marginTop: 4,
  },
  row: {
    display: 'flex',
    gap: 6,
  },
  input: {
    width: '100%',
    fontSize: 12,
    padding: '4px 8px',
  },
  browseBtn: {
    fontSize: 12,
    padding: '4px 10px',
    flexShrink: 0,
  },
  toggleRow: {
    display: 'flex',
    gap: 6,
  },
  toggleBtn: {
    flex: 1,
    fontSize: 12,
    padding: '5px 0',
  },
  presetRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  presetBtn: {
    fontSize: 10,
    padding: '2px 7px',
  },
  presetBtnActive: {
    background: 'var(--bg3)',
    borderColor: 'var(--accent)',
    color: 'var(--accent)',
  },
  tokenRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  tokenBtn: {
    fontSize: 10,
    padding: '2px 6px',
    fontFamily: 'monospace',
  },
  preview: {
    fontSize: 11,
    color: 'var(--text2)',
  },
  previewPath: {
    color: 'var(--accent)',
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
  select: {
    width: '100%',
    fontSize: 12,
  },
  organizeBtn: {
    marginTop: 6,
    width: '100%',
    fontWeight: 700,
    padding: '8px 0',
  },
};
