import React, { useEffect, useRef, useState } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { ScanPanel } from './components/ScanPanel';
import { PreviewTable } from './components/PreviewTable';
import { SummaryBar } from './components/SummaryBar';
import { DestinationPanel } from './components/DestinationPanel';
import { OrganizeProgressView } from './components/OrganizeProgress';
import { DupeReview } from './components/DupeReview';
import { LicenseModal } from './components/LicenseModal';
import { FolderTreeView } from './components/FolderTreeView';
import { DryRunPreview } from './components/DryRunPreview';
import { ModeSwitcher } from './components/ModeSwitcher';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useScan } from './hooks/useScan';
import { useFiles } from './hooks/useFiles';
import { useOrganize } from './hooks/useOrganize';
import { useHash, HashResult } from './hooks/useHash';
import { parseProRequiredError, FREE_FILE_CAP, type ProFeature } from '../shared/pro-features';
import { defaultPatternForMode, type Mode } from '../shared/mode';
import type { OrganizeOptions, DryRunResult } from '../shared/types';
import './styles/globals.css';

const PLATFORM = (typeof window !== 'undefined' && window.electronAPI?.platform) || 'unknown';
const IS_MAC = PLATFORM === 'darwin';
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-platform', PLATFORM);
}

function HashProgressBar({ processed, total }: { processed: number; total: number }) {
  const pct = total > 0 ? Math.round(processed / total * 100) : 0;
  return (
    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>
        Finding duplicates… {processed.toLocaleString()} / {total.toLocaleString()} ({pct}%)
      </div>
      <div style={{ height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--warn)', transition: 'width 0.3s', borderRadius: 2 }} />
      </div>
    </div>
  );
}

const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 500;
const DEFAULT_PANEL_WIDTH = 280;

function Inner() {
  const { sessionId, setSessionId, isPro, license, refreshLicense, settings, refreshSettings } = useAppContext();
  const mode: Mode = settings?.mode ?? 'photos';
  const { state, progress, error, sessionId: scanSessionId, startScan, cancelScan } = useScan();
  const { files, counts, page, totalPages, totalCount, sortBy, sortDir, filters, loading,
    setPage, setSortBy, setFilters, refresh } = useFiles(sessionId);
  const { state: orgState, progress: orgProgress, result: orgResult, error: orgError,
    startOrganize, cancelOrganize, reset: resetOrganize } = useOrganize();
  const { state: hashState, progress: hashProgress, result: hashResult,
    startHash, cancelHash, reset: resetHash } = useHash();

  const [showDupeReview, setShowDupeReview] = useState(false);
  const [showLicense, setShowLicense] = useState(false);
  const [showTreeView, setShowTreeView] = useState(false);
  const [orgError2, setOrgError2] = useState('');
  const [licensePrompt, setLicensePrompt] = useState<{ feature: ProFeature; reason: string } | null>(null);
  const [dryRunOptions, setDryRunOptions] = useState<OrganizeOptions | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_PANEL_WIDTH);
  const currentWidth = useRef(DEFAULT_PANEL_WIDTH);

  useEffect(() => {
    const saved = settings?.leftPanelWidth;
    if (saved && saved !== currentWidth.current) {
      setPanelWidth(saved);
      currentWidth.current = saved;
    }
  }, [settings?.leftPanelWidth]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const w = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, dragStartWidth.current + e.clientX - dragStartX.current));
      setPanelWidth(w);
      currentWidth.current = w;
    };
    const onUp = () => {
      setIsDragging(false);
      if (settings) window.electronAPI.saveSettings({ ...settings, leftPanelWidth: currentWidth.current });
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, settings]);

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = currentWidth.current;
    setIsDragging(true);
  };

  const handleDividerDoubleClick = () => {
    setPanelWidth(DEFAULT_PANEL_WIDTH);
    currentWidth.current = DEFAULT_PANEL_WIDTH;
    if (settings) window.electronAPI.saveSettings({ ...settings, leftPanelWidth: DEFAULT_PANEL_WIDTH });
  };

  useEffect(() => {
    if (scanSessionId && state === 'done') setSessionId(scanSessionId);
  }, [scanSessionId, state]);

  useEffect(() => {
    if (state === 'done') refresh();
  }, [state]);

  useEffect(() => {
    if (state !== 'scanning' || !scanSessionId) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [state, scanSessionId]);

  useEffect(() => {
    if (hashState === 'complete') refresh();
  }, [hashState]);

  const handleNewScan = () => {
    resetOrganize();
    resetHash();
    setShowDupeReview(false);
    setShowTreeView(false);
    setOrgError2('');
    setDryRunOptions(null);
    setDryRunResult(null);
    setSessionId(null);
  };

  const handleModeChange = async (next: Mode) => {
    if (!settings) return;
    if (next === mode) return;
    // Save mode + reset folderPattern to mode default so the next scan
    // starts with sensible defaults; user can still customize after.
    await window.electronAPI.saveSettings({
      ...settings,
      mode: next,
      folderPattern: defaultPatternForMode(next),
    });
    refreshSettings();
    handleNewScan();
  };

  const handleModeUpgradeRequired = (target: Mode) => {
    setLicensePrompt({
      feature: 'datahoarder_mode',
      reason: `${target === 'datahoarder' ? 'DataHoarder mode' : 'This mode'} is a Pro feature — organize PDFs, docs, audio, design files, and more.`,
    });
    setShowLicense(true);
  };

  // Use a ref so the IPC listener always calls the latest version of handleNewScan
  const handleNewScanRef = useRef(handleNewScan);
  handleNewScanRef.current = handleNewScan;

  useEffect(() => {
    return window.electronAPI.onNewSession(() => handleNewScanRef.current());
  }, []);

  const handleOpenFolder = (dest: string) => window.electronAPI.openPath(dest);

  const handleFindDupes = () => {
    if (sessionId) startHash(sessionId);
  };

  const handleDupesDone = () => {
    setShowDupeReview(false);
    refresh();
  };

  const handlePreview = async (options: OrganizeOptions) => {
    setOrgError2('');
    setDryRunOptions(options);
    setDryRunResult(null);
    setDryRunLoading(true);
    try {
      const result = await window.electronAPI.dryRunOrganize(options);
      setDryRunResult(result);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      setOrgError2(`Preview failed: ${msg}`);
      setDryRunOptions(null);
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleConfirmOrganize = async () => {
    if (!dryRunOptions) return;
    const options = dryRunOptions;
    setDryRunOptions(null);
    setDryRunResult(null);
    setOrgError2('');
    try {
      await startOrganize(options);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      const proReq = parseProRequiredError(msg);
      if (proReq) {
        setOrgError2(proReq.reason);
        setLicensePrompt(proReq);
        setShowLicense(true);
      } else {
        setOrgError2(msg);
      }
    }
  };

  const handleBackFromPreview = () => {
    setDryRunOptions(null);
    setDryRunResult(null);
    setOrgError2('');
  };

  // Free-tier dry-run can show the full proposed tree, but the Confirm step
  // is gated when the count exceeds the cap. The renderer surfaces the gate
  // up-front (before the user clicks Confirm) so the upgrade moment isn't a
  // surprise modal after a long preview.
  const dryRunBlock = (() => {
    if (!dryRunResult || isPro) return undefined;
    if (dryRunResult.totalFiles <= FREE_FILE_CAP) return undefined;
    return {
      reason: `Free tier organizes up to ${FREE_FILE_CAP.toLocaleString()} files at a time. This preview includes ${dryRunResult.totalFiles.toLocaleString()}.`,
      onUpgrade: () => {
        setLicensePrompt({
          feature: 'unlimited_organize',
          reason: `Upgrade to organize all ${dryRunResult.totalFiles.toLocaleString()} files in one pass.`,
        });
        setShowLicense(true);
      },
    };
  })();

  const handleExportReport = async () => {
    if (!sessionId) return;
    try { await window.electronAPI.exportReport(sessionId); } catch { /* dismissed */ }
  };

  const showDryRun = !!dryRunOptions;
  const showOrganize    = orgState !== 'idle';
  const showDestination = sessionId && state === 'done' && !showOrganize && !showDupeReview && !showDryRun;
  const showHashProgress = hashState === 'hashing';
  const showDupeSection = state === 'done' && !!sessionId && !showOrganize && hashState !== 'hashing' && !showDryRun;
  const dupeGroupCount = hashResult?.dupeGroups ?? counts?.dupes ?? 0;
  const organizeComplete = orgState === 'complete';
  const isDev = license?.developer === true;

  return (
    <div style={styles.root}>
      <header
        className="app-titlebar"
        style={{
          ...styles.header,
          ...(IS_MAC ? ({ paddingLeft: 84, WebkitAppRegion: 'drag' } as React.CSSProperties) : {}),
        }}
      >
        <div style={styles.logo}>
          {isDev && <span style={styles.devBadge}>DEV</span>}
          PixelPusher
        </div>
        <ModeSwitcher
          mode={mode}
          isPro={isPro}
          onChange={handleModeChange}
          onUpgradeRequired={handleModeUpgradeRequired}
        />
        {error && <div style={styles.errorBanner}>{error}</div>}
        {orgError2 && <div style={{ ...styles.errorBanner, background: 'var(--warn)' }}>{orgError2}</div>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {organizeComplete && sessionId && (
            <>
              <button
                className="btn-secondary"
                style={styles.headerBtn}
                onClick={handleExportReport}
                title="Export PDF report"
              >
                Export Report
              </button>
              {files.length > 0 && (
                <button
                  className="btn-secondary"
                  style={styles.headerBtn}
                  onClick={() => setShowTreeView(v => !v)}
                >
                  {showTreeView ? 'Hide Tree' : 'Show Tree'}
                </button>
              )}
            </>
          )}
          <button
            className="btn-secondary"
            style={{ ...styles.headerBtn, fontSize: 16, padding: '2px 9px' }}
            onClick={() => setShowLicense(true)}
            title={isPro ? (isDev ? 'Dev license active' : 'Pro license active') : 'Upgrade to Pro'}
          >
            {isPro ? (isDev ? '⚙' : '⚙') : '⚙'}
          </button>
        </div>
      </header>

      <div style={styles.body}>
        <div style={{ ...styles.sidebar, width: panelWidth }}>
          <ScanPanel
            mode={mode}
            onScan={startScan}
            onCancel={cancelScan}
            scanning={state === 'scanning'}
            done={state === 'done'}
            progress={progress}
            totalFiles={counts?.total}
          />

          {showDupeSection && (
            <div style={styles.dupeSection}>
              {hashState === 'idle' && (
                <button
                  className="btn-secondary"
                  style={{ width: '100%', fontSize: 12 }}
                  onClick={handleFindDupes}
                >
                  Find Duplicates
                </button>
              )}
              {hashState === 'complete' && dupeGroupCount > 0 && (
                <button
                  className="btn-secondary"
                  style={{ width: '100%', fontSize: 12, borderColor: 'var(--warn)', color: 'var(--warn)' }}
                  onClick={() => setShowDupeReview(true)}
                >
                  Review {dupeGroupCount} duplicate group{dupeGroupCount !== 1 ? 's' : ''}
                </button>
              )}
              {hashState === 'complete' && dupeGroupCount === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', padding: '4px 0' }}>
                  No duplicates found
                </div>
              )}
              {hashState === 'error' && (
                <div style={{ fontSize: 12, color: 'var(--error)', padding: '4px 0' }}>
                  Duplicate scan failed
                </div>
              )}
            </div>
          )}

          {showHashProgress && hashProgress && (
            <HashProgressBar processed={hashProgress.processed} total={hashProgress.total} />
          )}

          {showDestination && (
            <DestinationPanel
              sessionId={sessionId!}
              mode={mode}
              counts={counts}
              onPreview={handlePreview}
            />
          )}
        </div>

        <div
          className={`panel-divider${isDragging ? ' panel-divider--dragging' : ''}`}
          onMouseDown={handleDividerMouseDown}
          onDoubleClick={handleDividerDoubleClick}
        />

        <div style={styles.main}>
          {showDryRun ? (
            dryRunLoading || !dryRunResult ? (
              <div style={styles.welcome}>
                <div style={styles.welcomeTitle}>Computing preview…</div>
                <div style={styles.welcomeSub}>Walking the destination tree without touching a single file.</div>
              </div>
            ) : (
              <DryRunPreview
                options={dryRunOptions!}
                result={dryRunResult}
                blockedByTier={dryRunBlock}
                onConfirm={handleConfirmOrganize}
                onBack={handleBackFromPreview}
              />
            )
          ) : showDupeReview && sessionId ? (
            <DupeReview
              sessionId={sessionId}
              totalGroups={dupeGroupCount}
              onDone={handleDupesDone}
            />
          ) : showOrganize ? (
            <OrganizeProgressView
              state={orgState}
              progress={orgProgress}
              result={orgResult}
              error={orgError}
              onCancel={cancelOrganize}
              onOpenFolder={handleOpenFolder}
              onNewScan={handleNewScan}
              onDone={resetOrganize}
            />
          ) : sessionId ? (
            <>
              <SummaryBar
                counts={counts}
                loading={loading && !counts}
                onDupesClick={dupeGroupCount > 0 ? () => setShowDupeReview(true) : undefined}
              />
              {showTreeView && (
                <FolderTreeView files={files} totalCount={totalCount} />
              )}
              <PreviewTable
                files={files}
                page={page}
                totalPages={totalPages}
                totalCount={totalCount}
                sortBy={sortBy}
                sortDir={sortDir}
                filters={filters}
                loading={loading}
                onPageChange={setPage}
                onSort={setSortBy}
                onFilterChange={setFilters}
              />
            </>
          ) : (
            <div style={styles.welcome}>
              <div style={styles.welcomeTitle}>Welcome to PixelPusher</div>
              <div style={styles.welcomeSub}>
                Select a source folder and click <strong>Scan Folder</strong> to discover your photos and videos.
              </div>
            </div>
          )}
        </div>
      </div>

      {showLicense && (
        <LicenseModal
          license={license}
          prompt={licensePrompt}
          onClose={() => { setShowLicense(false); setLicensePrompt(null); }}
          onActivated={() => { refreshLicense(); setShowLicense(false); setLicensePrompt(null); }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <ErrorBoundary>
          <Inner />
        </ErrorBoundary>
      </AppProvider>
    </ErrorBoundary>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100vh',
    background: 'var(--bg)', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', height: 40, padding: '0 16px',
    background: 'var(--bg)', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 12,
  },
  logo: {
    fontWeight: 700, fontSize: 15, color: 'var(--accent)',
    letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: 8,
  },
  devBadge: {
    fontSize: 10, fontWeight: 800, color: 'var(--warn)',
    background: 'var(--badge-bg)', border: '1px solid var(--badge-border)',
    boxShadow: 'var(--badge-shadow)',
    padding: '1px 6px', borderRadius: 4, letterSpacing: '0.08em',
  },
  errorBanner: {
    background: 'var(--error)', color: '#fff', padding: '3px 10px', borderRadius: 4, fontSize: 12,
  },
  headerBtn: {
    fontSize: 11, padding: '3px 10px',
  },
  proBadge: {
    background: 'var(--accent)', color: '#fff',
    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
    letterSpacing: '0.05em', cursor: 'pointer',
  },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  sidebar: {
    display: 'flex', flexDirection: 'column', flexShrink: 0,
    overflowY: 'auto',
  },
  dupeSection: {
    padding: '10px 12px', borderTop: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  main: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' },
  welcome: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', flex: 1, gap: 12, color: 'var(--text2)',
  },
  welcomeTitle: { fontSize: 22, fontWeight: 700, color: 'var(--text)' },
  welcomeSub: { fontSize: 14, maxWidth: 380, textAlign: 'center', lineHeight: 1.6 },
};
