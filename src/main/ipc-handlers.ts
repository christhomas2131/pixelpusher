import { ipcMain, dialog, shell, app, BrowserWindow, nativeTheme } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  insertScanSession, completeScanSession,
  getFilesPaginated, getFileCounts,
  getPendingCount, getUnprocessedFiles,
  updateFilesExifBatch, ExifUpdateRow,
  getFilesForOrganize, getOrganizeTotals, getDb,
  getHashableFiles, getHashableCount, updateFileHashBatch,
  getByteHashableFiles, getByteHashableCount, updateFileByteHashBatch,
  getScanSessionMode,
  getDupeGroupsPaginated, resolveDupeGroup, getDupeGroupCount,
} from './database';
import { scanDirectory, requestScanCancel } from './file-scanner';
import { readFileMeta, closeExiftool, isExiftoolDead } from './exif-reader';
import { assertDriveReady } from './drive-check';
import { getSettings, saveSettings } from './settings-manager';
import { logger } from './logger';
import { LOG_DIR } from './logger';
import { setDockProgress, clearDockProgress, setDockBadge, clearDockBadge } from './mac-dock';
import {
  ScanOptions, AppSettings, GetFilesPageRequest,
  ScanDepth, ScanSpeed, ScanProgress,
  OrganizeOptions, OrganizeProgress, OrganizeResult,
  HashProgress, DupeAction, FileCategory,
} from '../shared/types';
import {
  OperationLog, getOperationHistory, readLogEntries, getOperationMode,
} from './operation-log';
import { safeCopy, safeMove, resolveConflict, buildFullDestination, humanizeFileError } from './file-mover';
import { dryRunOrganize } from './dry-run';
import { computePHash } from './hash-engine';
import { computeByteHash } from './byte-hash-engine';
import { detectDuplicates, detectByteHashDuplicates } from './dupe-detector';
import { checkTakeout } from './takeout-detector';
import { getLicenseInfo, activateLicense, deactivateLicense, isPro } from './license-manager';
import { BATCH_SIZE_HASH } from '../shared/constants';
import { FREE_FILE_CAP, FREE_DUPE_GROUPS_CAP, proRequiredError } from '../shared/pro-features';
import { defaultCategoriesForMode, type Mode } from '../shared/mode';

let scanRunning = false;
let cancelScan = false;
let organizeRunning = false;
let cancelOrganizeFlag = false;
let hashRunning = false;
let cancelHashFlag = false;

// ── Speed presets ────────────────────────────────────────────────────────────

function getScanSpeedConfig(speed: ScanSpeed): { batchSize: number; maxProcs: number } {
  switch (speed) {
    case 'safe':     return { batchSize: 20,  maxProcs: 1 };
    case 'balanced': return { batchSize: 50,  maxProcs: 2 };
    case 'fast':     return { batchSize: 100, maxProcs: 3 };
    default:         return { batchSize: 20,  maxProcs: 1 };
  }
}

// ── Rolling rate calculator for ETA ─────────────────────────────────────────

class RateCalculator {
  private samples: Array<{ time: number; count: number }> = [];
  private readonly windowMs = 30_000;

  update(count: number) {
    const now = Date.now();
    this.samples.push({ time: now, count });
    this.samples = this.samples.filter(s => now - s.time <= this.windowMs);
  }

  getFilesPerSecond(): number {
    if (this.samples.length < 2) return 0;
    const oldest = this.samples[0];
    const newest = this.samples[this.samples.length - 1];
    const elapsed = (newest.time - oldest.time) / 1000;
    return elapsed > 0 ? (newest.count - oldest.count) / elapsed : 0;
  }

  getETA(remaining: number): number | null {
    const fps = this.getFilesPerSecond();
    return fps > 0 ? Math.round(remaining / fps) : null;
  }
}

// ── Phase 2: metadata extraction ─────────────────────────────────────────────

async function extractMetadataPhase(
  sessionId: string,
  scanDepth: ScanDepth,
  scanSpeed: ScanSpeed,
  totalDiscovered: number,
  win: BrowserWindow,
  mode: Mode
): Promise<void> {
  const { batchSize, maxProcs } = getScanSpeedConfig(scanSpeed);
  const total = getPendingCount(sessionId);
  if (total === 0) return;

  const rate = new RateCalculator();
  let processed = 0;
  let lastId = '';
  let wave = 0;
  const totalWaves = Math.ceil(total / batchSize);

  logger.info('exif', `Starting extraction: ${total} files, depth=${scanDepth}, speed=${scanSpeed}, batch=${batchSize}`);

  while (true) {
    if (cancelScan) break;

    const batch = getUnprocessedFiles(sessionId, lastId, batchSize);
    if (batch.length === 0) break;
    wave++;

    // Read EXIF for entire batch in parallel
    const results = await Promise.allSettled(
      batch.map(f => readFileMeta(f, scanDepth, maxProcs, mode))
    );

    // Build DB update rows
    const updates: ExifUpdateRow[] = results.map((r, i) => {
      const file = batch[i];
      if (r.status === 'fulfilled') {
        const meta = r.value;
        const isJunk = meta.junk_reason !== null;
        return {
          id: file.id,
          date_taken: meta.date_taken,
          date_source: meta.date_source,
          camera_make: meta.camera_make,
          camera_model: meta.camera_model,
          gps_lat: meta.gps_lat,
          gps_lng: meta.gps_lng,
          width: meta.width,
          height: meta.height,
          extended_meta: meta.extended_meta,
          metadata_depth: scanDepth,
          status: isJunk ? 'junk' : (file.status === 'pending' ? 'ready' : file.status),
          error_message: meta.error_message,
          junk_reason: meta.junk_reason ?? file.junk_reason,
          junk_confidence: meta.junk_confidence ?? file.junk_confidence,
        };
      }
      return {
        id: file.id,
        date_taken: null,
        date_source: null,
        camera_make: null,
        camera_model: null,
        gps_lat: null,
        gps_lng: null,
        width: null,
        height: null,
        extended_meta: null,
        metadata_depth: scanDepth,
        status: 'error',
        error_message: 'extraction_failed',
        junk_reason: null,
        junk_confidence: null,
      };
    });

    updateFilesExifBatch(updates);

    processed += batch.length;
    lastId = batch[batch.length - 1].id;
    rate.update(processed);

    // Yield to prevent Windows "hung" detection
    await new Promise<void>(r => setImmediate(r));

    const fps = rate.getFilesPerSecond();
    const eta = rate.getETA(total - processed);

    if (!win.isDestroyed()) {
      const progress: ScanProgress = {
        phase: 'extracting',
        discovered: totalDiscovered,
        processed,
        total,
        eta,
        filesPerSecond: Math.round(fps),
        wave,
        totalWaves,
      };
      win.webContents.send('scan:progress', progress);
      setDockProgress(win, processed, total);
    }

    if (processed % 500 === 0) {
      const mem = process.memoryUsage();
      logger.info('exif', `${processed}/${total} | heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB rss=${Math.round(mem.rss / 1024 / 1024)}MB`);
    }
  }

  await closeExiftool();
  if (global.gc) global.gc();
  logger.info('exif', `Extraction complete: ${processed}/${total} files processed`);
}

// ── Disk space check ─────────────────────────────────────────────────────────

function getAvailableBytes(dir: string): number | null {
  try {
    const stats = (fs as any).statfsSync(dir) as { bsize: number; bavail: number };
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

// ── Organize pipeline ────────────────────────────────────────────────────────

async function runOrganize(options: OrganizeOptions, win: BrowserWindow): Promise<void> {
  const { sessionId, destination, pattern, mode, conflictStrategy } = options;
  const db = getDb();

  await assertDriveReady(destination);
  fs.mkdirSync(destination, { recursive: true });

  const { count: total, totalSize } = getOrganizeTotals(sessionId);

  // Disk space check (copy only — move frees space from source)
  if (mode === 'copy' && totalSize > 0) {
    const available = getAvailableBytes(destination);
    if (available !== null) {
      const required = Math.floor(totalSize * 1.1); // 110% buffer
      if (available < totalSize) {
        throw new Error(`DISK_FULL: Destination has ${Math.round(available / 1024 / 1024)}MB free but needs ${Math.round(totalSize / 1024 / 1024)}MB.`);
      }
      if (available < required) {
        logger.warn('organize', `Disk space tight: ${Math.round(available / 1024 / 1024)}MB free, ${Math.round(totalSize / 1024 / 1024)}MB needed (recommend 110%)`);
      }
    }
  }

  db.prepare(
    "INSERT OR REPLACE INTO operation_progress (session_id,total_files,processed_files,successful_files,error_files,skipped_files,last_processed_id,status,updated_at) VALUES (?,?,0,0,0,0,NULL,'running',datetime('now'))"
  ).run(sessionId, total);

  // Hoist prepared statements out of the inner per-file loop. Previous version
  // called db.prepare() per row, which the cache handled — but allocating new
  // PreparedStatement wrappers per file still tax the GC on a 40 K-file run.
  const stmtSetSkipped   = db.prepare("UPDATE files SET status = 'skipped' WHERE id = ?");
  const stmtSetOrganized = db.prepare("UPDATE files SET status = 'organized' WHERE id = ?");
  const stmtSetError     = db.prepare("UPDATE files SET status = 'error', error_message = ? WHERE id = ?");
  const stmtUpdateOpProgress = db.prepare(
    "UPDATE operation_progress SET processed_files=?,successful_files=?,error_files=?,skipped_files=?,last_processed_id=?,updated_at=datetime('now') WHERE session_id=?"
  );

  const log = new OperationLog(sessionId, destination, pattern, mode, new Date().toISOString());
  const rate = new RateCalculator();
  const recentErrors: string[] = [];
  const MAX_ERRORS_CAP = 50;

  let processed     = 0;
  let successful    = 0;
  let errors        = 0;
  let skipped       = 0;
  let bytesProcessed = 0;
  let lastId: string | null = null;

  try {
    while (true) {
      if (cancelOrganizeFlag) break;

      const batch = getFilesForOrganize(sessionId, lastId, 100);
      if (batch.length === 0) break;

      // Pre-create destination directories once per unique parent — saves
      // a sync mkdirSync call per file (40K files → 40K syscalls → a few
      // hundred unique dirs).
      const destPathByFile = new Map<string, string>();
      const dirsToCreate = new Set<string>();
      for (const file of batch) {
        const dp = buildFullDestination(destination, pattern, file);
        destPathByFile.set(file.id, dp);
        dirsToCreate.add(path.dirname(dp));
      }
      for (const dir of dirsToCreate) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch { /* surfaces in per-file catch below */ }
      }

      for (const file of batch) {
        if (cancelOrganizeFlag) break;

        const destPath = destPathByFile.get(file.id)!;

        try {
          const finalDest = resolveConflict(destPath, conflictStrategy as 'rename' | 'skip' | 'overwrite');
          if (finalDest === null) {
            skipped++;
            stmtSetSkipped.run(file.id);
            log.write({ src: file.source_path, dest: destPath, status: 'skip' });
            processed++;
            continue;
          }

          if (mode === 'move') {
            await safeMove(file.source_path, finalDest);
          } else {
            await safeCopy(file.source_path, finalDest);
          }

          successful++;
          bytesProcessed += file.size || 0;
          stmtSetOrganized.run(file.id);
          log.write({ src: file.source_path, dest: finalDest, status: 'ok' });

        } catch (err: any) {
          errors++;
          const errMsg = humanizeFileError(err);
          stmtSetError.run(errMsg, file.id);
          log.write({ src: file.source_path, dest: destPath, status: 'error', error: errMsg });
          if (recentErrors.length < MAX_ERRORS_CAP) recentErrors.push(`${file.filename}: ${errMsg}`);
          logger.warn('organize', `File error: ${file.filename} → ${errMsg}`, `src=${file.source_path}`);
        }

        processed++;
      }

      lastId = batch[batch.length - 1].id;

      // Critical: yield to event loop — prevents Windows "hung" detection
      await new Promise<void>(r => setImmediate(r));

      rate.update(processed);
      const fps = rate.getFilesPerSecond();
      const eta = rate.getETA(total - processed);

      if (!win.isDestroyed()) {
        const progress: OrganizeProgress = {
          processed, total, successful, errors, skipped,
          currentFile: batch[batch.length - 1]?.filename ?? '',
          eta,
          filesPerSecond: Math.round(fps),
          bytesProcessed,
          totalBytes: totalSize,
        };
        win.webContents.send('organize:progress', progress);
        setDockProgress(win, processed, total);
      }

      if (processed % 500 === 0) {
        stmtUpdateOpProgress.run(processed, successful, errors, skipped, lastId, sessionId);
        const mem = process.memoryUsage();
        const batchNum = Math.floor(processed / 100); // batches of 100
        logger.info('organize', `${processed}/${total} batch=#${batchNum} | ok=${successful} err=${errors} skip=${skipped} | heap=${Math.round(mem.heapUsed/1024/1024)}MB rss=${Math.round(mem.rss/1024/1024)}MB`);
      }

      if (processed % 2000 === 0) {
        db.pragma('wal_checkpoint(PASSIVE)');
      }

      if (global.gc) global.gc();
    }
  } finally {
    log.close(successful, errors, skipped);

    db.prepare(
      "UPDATE operation_progress SET status=?,processed_files=?,successful_files=?,error_files=?,skipped_files=?,updated_at=datetime('now') WHERE session_id=?"
    ).run(cancelOrganizeFlag ? 'cancelled' : 'complete', processed, successful, errors, skipped, sessionId);

    logger.info('organize', `Session ${sessionId} ${cancelOrganizeFlag ? 'cancelled' : 'complete'} — ok=${successful} err=${errors} skipped=${skipped}`);

    if (!win.isDestroyed()) {
      const result: OrganizeResult = {
        sessionId, processed, total, successful, errors, skipped,
        recentErrors,
        destination,
      };
      win.webContents.send('organize:complete', result);
    }

    clearDockProgress(win);
    if (errors > 0) {
      setDockBadge(String(Math.min(errors, 99)));
    }

    organizeRunning = false;
  }
}

// ── IPC registration ─────────────────────────────────────────────────────────

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {

  ipcMain.handle('scan:start', async (_event, options: ScanOptions) => {
    if (scanRunning) throw new Error('Scan already running');
    scanRunning = true;
    cancelScan = false;
    clearDockBadge();
    const sessionId = crypto.randomUUID();

    const win = getWindow();
    if (!win) { scanRunning = false; throw new Error('No window'); }

    insertScanSession({
      id: sessionId,
      sourceFolders: options.sourceFolders,
      scanDepth: options.scanDepth,
      scanSpeed: options.scanSpeed,
      mode: options.mode,
    });

    logger.info('scan', `Session ${sessionId} — ${options.sourceFolders.length} folder(s), depth=${options.scanDepth}, speed=${options.scanSpeed}, mode=${options.mode}`);

    // Safety net: cancel scan after 30 minutes. If the underlying op is
    // stuck on a network drive (ExifTool worker hung waiting for I/O),
    // setting cancelScan alone won't unblock it — force-close ExifTool so
    // the in-flight tool.read() rejects.
    const scanTimeout = setTimeout(() => {
      logger.warn('scan', 'Scan exceeded 30-minute safety limit — cancelling');
      cancelScan = true;
      requestScanCancel();
      closeExiftool().catch(() => { /* best-effort */ });
    }, 30 * 60 * 1000);

    setImmediate(async () => {
      try {
        // Drive readiness check
        for (const folder of options.sourceFolders) {
          await assertDriveReady(folder);
        }

        // Phase 1: Discovery
        if (!win.isDestroyed()) {
          win.webContents.send('scan:progress', {
            phase: 'discovering', discovered: 0, processed: 0, total: 0,
            eta: null, filesPerSecond: 0, wave: 0, totalWaves: 0,
          } as ScanProgress);
          setDockProgress(win, 0, 0); // indeterminate while discovering
        }

        const enabledCategories = (
          options.enabledCategories ?? defaultCategoriesForMode(options.mode)
        ) as FileCategory[];
        const { totalFiles, totalSize } = await scanDirectory(options.sourceFolders, sessionId, 0, win, enabledCategories);
        logger.info('scan', `Discovery complete: ${totalFiles} files`);

        // Phase 2: Metadata extraction
        if (totalFiles > 0 && !cancelScan) {
          await extractMetadataPhase(sessionId, options.scanDepth, options.scanSpeed, totalFiles, win, options.mode);
        }

        completeScanSession(sessionId, totalFiles, totalSize);
        logger.info('scan', `Session ${sessionId} complete — ${totalFiles} files`);

        if (!win.isDestroyed()) {
          win.webContents.send('scan:complete', { sessionId, totalFiles });
        }
      } catch (err) {
        logger.error('scan', `Session ${sessionId} failed`, String(err));
        if (!win.isDestroyed()) {
          win.webContents.send('scan:error', String(err));
        }
      } finally {
        clearTimeout(scanTimeout);
        scanRunning = false;
        clearDockProgress(win);
      }
    });

    return sessionId;
  });

  ipcMain.handle('scan:cancel', async () => {
    cancelScan = true;
    requestScanCancel();
  });

  ipcMain.handle('files:getPage', async (_event, request: GetFilesPageRequest) => {
    return getFilesPaginated(request);
  });

  ipcMain.handle('files:getCounts', async (_event, sessionId: string) => {
    return getFileCounts(sessionId);
  });

  ipcMain.handle('settings:get', async () => {
    return getSettings();
  });

  ipcMain.handle('settings:save', async (_event, settings: AppSettings) => {
    saveSettings(settings);
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('shell:openLogFolder', async () => {
    await shell.openPath(LOG_DIR);
  });

  // Whitelisted prefixes the renderer is allowed to "open" via the OS. We
  // never want a compromised renderer (or stale state) to convince main to
  // shell-exec an arbitrary executable; restrict to user-facing locations
  // it touches during normal use.
  function isAllowedOpenPath(p: string): boolean {
    if (!p || typeof p !== 'string') return false;
    if (p.startsWith('http://') || p.startsWith('https://')) return true; // for openExternal-style links (purchase URL)
    const settings = getSettings();
    const homeBased = [
      app.getPath('pictures'),
      app.getPath('documents'),
      app.getPath('downloads'),
      app.getPath('home'),
      app.getPath('desktop'),
      path.join(os.homedir(), '.photomove'),
      LOG_DIR,
    ];
    const recents = settings.recentFolders ?? [];
    const lastDest = settings.lastDestination ? [settings.lastDestination] : [];
    const allowedRoots = [...homeBased, ...recents, ...lastDest].filter(Boolean);
    const resolved = path.resolve(p);
    return allowedRoots.some(root => {
      const r = path.resolve(root);
      return resolved === r || resolved.startsWith(r + path.sep);
    });
  }

  ipcMain.handle('organize:start', async (_event, options: OrganizeOptions) => {
    if (organizeRunning) throw new Error('Organize already running');
    clearDockBadge();

    if (!isPro()) {
      const { count } = getOrganizeTotals(options.sessionId);
      if (count > FREE_FILE_CAP) {
        throw proRequiredError(
          'unlimited_organize',
          `Free tier organizes up to ${FREE_FILE_CAP.toLocaleString()} files per session — this scan has ${count.toLocaleString()}. Upgrade to Pro for unlimited.`
        );
      }
    }

    organizeRunning = true;
    cancelOrganizeFlag = false;

    const win = getWindow();
    if (!win) { organizeRunning = false; throw new Error('No window'); }

    logger.info('organize', `Session ${options.sessionId} — dest="${options.destination}" pattern="${options.pattern}" mode=${options.mode}`);

    // Safety net: cancel organize after 4 hours.
    const organizeTimeout = setTimeout(() => {
      logger.warn('organize', 'Organize exceeded 4-hour safety limit — cancelling');
      cancelOrganizeFlag = true;
    }, 4 * 60 * 60 * 1000);

    // Pre-flight: if ExifTool died mid-scan, warn so the user knows some
    // files may have status='ready' with only filename/filesystem-derived
    // dates (lower accuracy than EXIF).
    if (isExiftoolDead()) {
      logger.warn('organize', `Session ${options.sessionId} starting with stale-EXIF data (worker died during scan)`);
    }

    setImmediate(async () => {
      try {
        await runOrganize(options, win);
      } catch (err) {
        organizeRunning = false;
        logger.error('organize', `Session ${options.sessionId} failed`, String(err));
        if (!win.isDestroyed()) {
          win.webContents.send('organize:error', String(err));
        }
        clearDockProgress(win);
      } finally {
        clearTimeout(organizeTimeout);
      }
    });
  });

  ipcMain.handle('organize:dryRun', async (_event, options: OrganizeOptions) => {
    // Dry-run is read-only and pre-empts any pre-organize gating decisions.
    // We deliberately do NOT enforce the FREE_FILE_CAP here — users on the
    // free tier should still be allowed to *see* the proposed tree for their
    // entire library (that's the conversion moment); the cap applies at the
    // commit step in `organize:start`.
    return dryRunOrganize(options);
  });

  ipcMain.handle('organize:cancel', async () => {
    cancelOrganizeFlag = true;
  });

  ipcMain.handle('organize:undo', async (_event, sessionId: string) => {
    const mode = getOperationMode(sessionId);
    if (!mode) return { undone: 0, errors: 1 };

    const entries = readLogEntries(sessionId);
    const okEntries = entries.filter(e => e.status === 'ok');

    // Confirm before performing destructive work. For 'copy' mode this
    // unlinks files at the destination; for 'move' it moves them back to
    // the original source path (which may overwrite anything that's there).
    // CLAUDE.md: "Never auto-delete files without explicit user confirmation."
    const win = getWindow();
    if (win) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Cancel', `Undo ${okEntries.length} file${okEntries.length !== 1 ? 's' : ''}`],
        defaultId: 0,
        cancelId: 0,
        title: 'Undo Organize',
        message: `Undo ${okEntries.length} ${mode === 'copy' ? 'copies' : 'moves'}?`,
        detail: mode === 'copy'
          ? 'PixelPusher will DELETE the organized copies from your destination folder. Your original files at the source location are untouched.'
          : 'PixelPusher will MOVE the organized files back to their original source paths. Any file currently at those paths may be overwritten.',
      });
      if (response !== 1) {
        logger.info('organize', `Undo ${sessionId} — user cancelled`);
        return { undone: 0, errors: 0, cancelled: true };
      }
    }

    let undone = 0;
    let errors = 0;

    for (const entry of okEntries) {
      try {
        if (mode === 'copy') {
          if (fs.existsSync(entry.dest)) fs.unlinkSync(entry.dest);
        } else {
          const srcDir = path.dirname(entry.src);
          fs.mkdirSync(srcDir, { recursive: true });
          await safeMove(entry.dest, entry.src);
        }
        undone++;
      } catch {
        errors++;
      }
      await new Promise<void>(r => setImmediate(r));
    }

    logger.info('organize', `Undo ${sessionId} — undone=${undone} errors=${errors}`);
    return { undone, errors };
  });

  ipcMain.handle('organize:getHistory', async () => {
    return getOperationHistory();
  });

  ipcMain.handle('dialog:getPictures', async () => {
    return app.getPath('pictures');
  });

  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    // Defense-in-depth: even with context isolation, validate the path before
    // shelling out. A compromised or stale renderer should not be able to
    // open an arbitrary executable on the user's machine.
    if (!isAllowedOpenPath(filePath)) {
      logger.warn('shell', `Refused openPath outside allowlist: ${filePath}`);
      return;
    }
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      await shell.openExternal(filePath);
    } else {
      await shell.openPath(filePath);
    }
  });

  // ── Hash ──────────────────────────────────────────────────────────────────

  ipcMain.handle('hash:start', async (_event, sessionId: string) => {
    if (hashRunning) throw new Error('Hash already running');
    hashRunning = true;
    cancelHashFlag = false;

    const win = getWindow();
    if (!win) { hashRunning = false; throw new Error('No window'); }

    // Mode-aware dispatch:
    //   photos       → perceptual hash (sharp DCT) + hamming-distance clustering
    //   datahoarder  → SHA-256 byte hash + exact-match grouping
    // Same IPC surface, same UI, different algorithms underneath.
    const sessionMode = getScanSessionMode(sessionId);
    const isByteHashMode = sessionMode === 'datahoarder';

    logger.info('hash', `Starting ${isByteHashMode ? 'byte-hash (SHA-256)' : 'pHash'} for session ${sessionId}`);

    setImmediate(async () => {
      try {
        const total = isByteHashMode
          ? getByteHashableCount(sessionId)
          : getHashableCount(sessionId);
        const rate  = new RateCalculator();
        let processed = 0;
        let lastId    = '';

        while (true) {
          if (cancelHashFlag) break;

          const batch = isByteHashMode
            ? getByteHashableFiles(sessionId, lastId, BATCH_SIZE_HASH)
            : getHashableFiles(sessionId, lastId, BATCH_SIZE_HASH);
          if (batch.length === 0) break;

          if (isByteHashMode) {
            const results = await Promise.allSettled(
              batch.map(f => computeByteHash(f.source_path))
            );
            const updates = results.map((r, i) => ({
              id: batch[i].id,
              byte_hash: r.status === 'fulfilled' ? r.value : null,
            }));
            updateFileByteHashBatch(updates);
            // Mark unreadable files as 'error' so they aren't retried on
            // the next hash run (getByteHashableFiles filters status='ready').
            // Without this, a permanently broken file would loop forever
            // through the hash queue.
            const failedIds = updates.filter(u => u.byte_hash === null).map(u => u.id);
            if (failedIds.length > 0) {
              const db = getDb();
              const stmt = db.prepare("UPDATE files SET status = 'error', error_message = 'byte_hash_failed' WHERE id = ?");
              db.transaction(() => { for (const id of failedIds) stmt.run(id); })();
            }
          } else {
            const results = await Promise.allSettled(
              batch.map(f => computePHash(f.source_path))
            );
            const updates = results.map((r, i) => ({
              id: batch[i].id,
              phash: r.status === 'fulfilled' ? r.value : null,
            }));
            updateFileHashBatch(updates);
            const failedIds = updates.filter(u => u.phash === null).map(u => u.id);
            if (failedIds.length > 0) {
              const db = getDb();
              const stmt = db.prepare("UPDATE files SET status = 'error', error_message = 'phash_failed' WHERE id = ?");
              db.transaction(() => { for (const id of failedIds) stmt.run(id); })();
            }
          }

          processed += batch.length;
          lastId     = batch[batch.length - 1].id;
          rate.update(processed);

          await new Promise<void>(r2 => setImmediate(r2));

          if (!win.isDestroyed()) {
            const progress: HashProgress = {
              processed,
              total,
              filesPerSecond: Math.round(rate.getFilesPerSecond()),
              eta: rate.getETA(total - processed),
            };
            win.webContents.send('hash:progress', progress);
            setDockProgress(win, processed, total);
          }

          if (processed % 500 === 0) {
            const mem = process.memoryUsage();
            logger.info('hash', `${processed}/${total} | heap=${Math.round(mem.heapUsed/1024/1024)}MB`);
            if (global.gc) global.gc();
          }
        }

        // Auto-run dupe detection after hashing — same routine for both modes,
        // different scorer inside.
        const dupeGroups = cancelHashFlag
          ? 0
          : isByteHashMode
            ? await detectByteHashDuplicates(sessionId)
            : await detectDuplicates(sessionId);
        logger.info('hash', `Hashing complete: ${processed} hashed, ${dupeGroups} dupe groups (mode=${sessionMode})`);

        if (!win.isDestroyed()) {
          win.webContents.send('hash:complete', { sessionId, hashed: processed, dupeGroups });
        }
      } catch (err) {
        logger.error('hash', `Hash session ${sessionId} failed`, String(err));
        if (!win.isDestroyed()) {
          win.webContents.send('hash:error', String(err));
        }
      } finally {
        hashRunning = false;
        clearDockProgress(win);
      }
    });
  });

  ipcMain.handle('hash:cancel', async () => {
    cancelHashFlag = true;
  });

  // ── Dupes ─────────────────────────────────────────────────────────────────

  ipcMain.handle('dupe:getGroups', async (_event, sessionId: string, page: number, pageSize: number) => {
    const result = await getDupeGroupsPaginated(sessionId, page, pageSize);
    if (!isPro()) {
      // Free-tier slicing. Enforce the cap so a hand-crafted page request
      // (e.g. page=9999, pageSize=1) can never read past index FREE_DUPE_GROUPS_CAP.
      const offset = (page - 1) * pageSize;
      const remaining = Math.max(0, FREE_DUPE_GROUPS_CAP - offset);
      result.total = Math.min(result.total, FREE_DUPE_GROUPS_CAP);
      result.groups = result.groups.slice(0, Math.min(remaining, result.groups.length));
    }
    return result;
  });

  ipcMain.handle('dupe:resolveGroup', async (_event, groupId: string, keeperId: string, action: DupeAction) => {
    const db = getDb();

    let nonKeeperPaths: string[] = [];
    if (action === 'quarantine' || action === 'delete') {
      const rows = db.prepare(
        'SELECT f.source_path FROM files f JOIN dupe_group_members m ON m.file_id = f.id WHERE m.group_id = ? AND m.file_id != ?'
      ).all(groupId, keeperId) as { source_path: string }[];
      nonKeeperPaths = rows.map(r => r.source_path);
    }

    resolveDupeGroup(groupId, keeperId, action);

    if (action === 'quarantine' && nonKeeperPaths.length > 0) {
      const group = db.prepare('SELECT scan_session_id FROM dupe_groups WHERE id = ?').get(groupId) as { scan_session_id: string } | undefined;
      const quarantineDir = path.join(os.homedir(), '.photomove', 'quarantine', group?.scan_session_id ?? 'misc');
      fs.mkdirSync(quarantineDir, { recursive: true });
      for (const src of nonKeeperPaths) {
        try {
          const name = path.basename(src);
          const dest = resolveConflict(path.join(quarantineDir, name), 'rename') ?? path.join(quarantineDir, name);
          await safeMove(src, dest);
          logger.info('dupes', `Quarantined: ${name}`);
        } catch (err) {
          logger.warn('dupes', `Quarantine failed: ${path.basename(src)}`, String(err));
        }
      }
    } else if (action === 'delete' && nonKeeperPaths.length > 0) {
      for (const src of nonKeeperPaths) {
        try {
          if (fs.existsSync(src)) fs.unlinkSync(src);
          logger.info('dupes', `Deleted: ${path.basename(src)}`);
        } catch (err) {
          logger.warn('dupes', `Delete failed: ${path.basename(src)}`, String(err));
        }
      }
    }
  });

  ipcMain.handle('dupe:autoResolveAll', async (_event, sessionId: string, action: DupeAction) => {
    const db = getDb();
    const groups = db.prepare(
      "SELECT id FROM dupe_groups WHERE scan_session_id = ? AND status = 'pending'"
    ).all(sessionId) as { id: string }[];

    // Destructive actions get a final confirmation in main, regardless of
    // what the renderer did. CLAUDE.md: "Never auto-delete files without
    // explicit user confirmation."
    if ((action === 'delete' || action === 'quarantine') && groups.length > 0) {
      const win = getWindow();
      if (win) {
        const verb = action === 'delete' ? 'PERMANENTLY DELETE' : 'move to quarantine';
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Cancel', `Yes, ${action === 'delete' ? 'delete' : 'quarantine'} duplicates`],
          defaultId: 0,
          cancelId: 0,
          title: `Auto-resolve ${groups.length} duplicate groups`,
          message: `${verb.charAt(0).toUpperCase() + verb.slice(1)} non-keeper files in ${groups.length} duplicate groups?`,
          detail: action === 'delete'
            ? 'Files will be removed from your disk and cannot be recovered. The "best" file in each group is kept.'
            : 'Non-keeper files will be moved to ~/.photomove/quarantine — recoverable, but they won\'t appear in your library again.',
        });
        if (response !== 1) {
          logger.info('dupes', `Auto-resolve ${sessionId} (action=${action}) cancelled by user`);
          return { resolved: 0, cancelled: true };
        }
      }
    }

    const quarantineDir = path.join(os.homedir(), '.photomove', 'quarantine', sessionId);
    if (action === 'quarantine') fs.mkdirSync(quarantineDir, { recursive: true });

    let resolved = 0;
    for (const { id: groupId } of groups) {
      const keeper = db.prepare(
        'SELECT file_id FROM dupe_group_members WHERE group_id = ? ORDER BY rank LIMIT 1'
      ).get(groupId) as { file_id: string } | undefined;
      if (!keeper) continue;

      if (action === 'quarantine' || action === 'delete') {
        const nonKeepers = db.prepare(
          'SELECT f.source_path FROM files f JOIN dupe_group_members m ON m.file_id = f.id WHERE m.group_id = ? AND m.file_id != ?'
        ).all(groupId, keeper.file_id) as { source_path: string }[];
        for (const { source_path: src } of nonKeepers) {
          if (action === 'quarantine') {
            try {
              const name = path.basename(src);
              const dest = resolveConflict(path.join(quarantineDir, name), 'rename') ?? path.join(quarantineDir, name);
              await safeMove(src, dest);
            } catch (err) {
              logger.warn('dupes', `Auto-quarantine failed: ${path.basename(src)}`, String(err));
            }
          } else {
            try {
              if (fs.existsSync(src)) fs.unlinkSync(src);
            } catch (err) {
              logger.warn('dupes', `Auto-delete failed: ${path.basename(src)}`, String(err));
            }
          }
        }
      }

      resolveDupeGroup(groupId, keeper.file_id, action);
      resolved++;
      await new Promise<void>(r => setImmediate(r));
    }

    logger.info('dupes', `Auto-resolved ${resolved} groups for session ${sessionId}, action=${action}`);
    return { resolved };
  });

  // ── Takeout ───────────────────────────────────────────────────────────────

  ipcMain.handle('takeout:check', async (_event, folder: string) => {
    return checkTakeout(folder);
  });

  // ── License ───────────────────────────────────────────────────────────────

  ipcMain.handle('license:get', async () => {
    return getLicenseInfo();
  });

  ipcMain.handle('license:activate', async (_event, key: string, email: string) => {
    return activateLicense(key, email);
  });

  ipcMain.handle('license:deactivate', async () => {
    deactivateLicense();
  });

  // ── Report export ─────────────────────────────────────────────────────────

  ipcMain.handle('report:export', async (_event, sessionId: string) => {
    const win = getWindow();
    if (!win) throw new Error('No window');

    const result = await dialog.showSaveDialog(win, {
      defaultPath: `PixelPusher-Report-${sessionId.slice(0, 8)}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return;

    const db = getDb();
    const counts = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN date_taken IS NOT NULL AND date_taken != 'unknown' THEN 1 ELSE 0 END) AS withDate,
        SUM(CASE WHEN status = 'junk' THEN 1 ELSE 0 END) AS junk,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN status = 'organized' THEN 1 ELSE 0 END) AS organized
      FROM files WHERE scan_session_id = ?
    `).get(sessionId) as Record<string, number>;

    const byFormat = db.prepare(`
      SELECT format, COUNT(*) AS cnt FROM files WHERE scan_session_id = ? GROUP BY format ORDER BY cnt DESC LIMIT 20
    `).all(sessionId) as Array<{ format: string; cnt: number }>;

    const byYear = db.prepare(`
      SELECT substr(date_taken, 1, 4) AS yr, COUNT(*) AS cnt
      FROM files WHERE scan_session_id = ? AND date_taken IS NOT NULL AND date_taken != 'unknown'
      GROUP BY yr ORDER BY yr
    `).all(sessionId) as Array<{ yr: string; cnt: number }>;

    const errors = db.prepare(`
      SELECT filename, error_message FROM files
      WHERE scan_session_id = ? AND status = 'error' LIMIT 50
    `).all(sessionId) as Array<{ filename: string; error_message: string }>;

    const html = generateReportHtml(sessionId, counts, byFormat, byYear, errors);

    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    try {
      await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdfData = await printWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      fs.writeFileSync(result.filePath, pdfData);
      logger.info('report', `PDF exported to ${result.filePath}`);
    } finally {
      printWin.close();
    }
  });

  // ── Thumbnails ────────────────────────────────────────────────────────────
  // Renderer can't <img src="file://…"> because the CSP locks img-src to
  // 'self' data: blob:. We serve thumbnails through IPC instead: main reads
  // the file, downsamples via sharp, returns a data: URL the renderer can
  // drop straight into an <img>.
  ipcMain.handle('image:getThumbnail', async (_event, filePath: string, maxSize = 240) => {
    if (!filePath || typeof filePath !== 'string') return null;
    const allowed = isAllowedOpenPath(filePath) || (() => {
      // Also allow any file in a recent source folder (typical scan location)
      const settings = getSettings();
      const r = path.resolve(filePath);
      return (settings.lastSourceFolders ?? []).some(src => {
        const sr = path.resolve(src);
        return r === sr || r.startsWith(sr + path.sep);
      });
    })();
    if (!allowed) return null;
    try {
      // Lazy-require sharp so loading the IPC module doesn't drag it in
      // on app startup.
      const sharp = require('sharp');
      const size = Math.max(32, Math.min(512, Math.floor(maxSize) || 240));
      const out = await sharp(filePath)
        .rotate() // honor EXIF orientation
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
      return `data:image/jpeg;base64,${out.toString('base64')}`;
    } catch {
      return null;
    }
  });

  // ── Native theme ──────────────────────────────────────────────────────────

  nativeTheme.on('updated', () => {
    getWindow()?.webContents.send('native:themeChanged');
  });
}

function generateReportHtml(
  sessionId: string,
  counts: Record<string, number>,
  byFormat: Array<{ format: string; cnt: number }>,
  byYear: Array<{ yr: string; cnt: number }>,
  errors: Array<{ filename: string; error_message: string }>
): string {
  const fmt = (n: number) => (n ?? 0).toLocaleString();
  const now = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  // HTML-escape any user-derived text before injecting into the report — a
  // filename like `<script>x</script>.jpg` or an EXIF error containing
  // markup would otherwise execute when the PDF renderer loads the page.
  const esc = (s: string | null | undefined): string =>
    String(s ?? '').replace(/[&<>"']/g, ch => (
      ch === '&' ? '&amp;' :
      ch === '<' ? '&lt;'  :
      ch === '>' ? '&gt;'  :
      ch === '"' ? '&quot;': '&#39;'
    ));

  const formatRows = byFormat.map(r =>
    `<tr><td>${esc(r.format).toUpperCase()}</td><td style="text-align:right">${fmt(r.cnt)}</td></tr>`
  ).join('');

  const yearRows = byYear.map(r =>
    `<tr><td>${esc(r.yr)}</td><td style="text-align:right">${fmt(r.cnt)}</td></tr>`
  ).join('');

  const errorRows = errors.map(r =>
    `<tr><td style="font-family:monospace;font-size:11px">${esc(r.filename)}</td><td>${esc(r.error_message)}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; color: #1a1a2e; margin: 0; padding: 40px; }
  h1 { font-size: 28px; color: #4f8ef7; margin-bottom: 4px; }
  h2 { font-size: 16px; color: #333; margin: 24px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 32px; }
  .stats { display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0; }
  .stat { background: #f4f4f8; padding: 16px 24px; border-radius: 8px; text-align: center; min-width: 100px; }
  .stat-value { font-size: 28px; font-weight: 700; color: #4f8ef7; }
  .stat-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 6px 10px; background: #f4f4f8; }
  td { padding: 5px 10px; border-bottom: 1px solid #eee; }
  .no-errors { color: #4caf7d; font-style: italic; }
</style>
</head><body>
<h1>PixelPusher — Organization Report</h1>
<div class="meta">Generated ${esc(now)} &nbsp;·&nbsp; Session ${esc(sessionId.slice(0, 8))}…</div>

<h2>Summary</h2>
<div class="stats">
  <div class="stat"><div class="stat-value">${fmt(counts.total)}</div><div class="stat-label">Total Files</div></div>
  <div class="stat"><div class="stat-value">${fmt(counts.withDate)}</div><div class="stat-label">With Date</div></div>
  <div class="stat"><div class="stat-value">${fmt(counts.organized)}</div><div class="stat-label">Organized</div></div>
  <div class="stat"><div class="stat-value">${fmt(counts.junk)}</div><div class="stat-label">Junk</div></div>
  <div class="stat"><div class="stat-value">${fmt(counts.errors)}</div><div class="stat-label">Errors</div></div>
</div>

<h2>Date Distribution by Year</h2>
${byYear.length === 0 ? '<p style="color:#999;font-style:italic">No dated files.</p>' : `<table><tr><th>Year</th><th style="text-align:right">Files</th></tr>${yearRows}</table>`}

<h2>Format Breakdown</h2>
${byFormat.length === 0 ? '<p style="color:#999;font-style:italic">No files.</p>' : `<table><tr><th>Format</th><th style="text-align:right">Files</th></tr>${formatRows}</table>`}

<h2>Errors</h2>
${errors.length === 0
  ? '<p class="no-errors">No errors — clean run!</p>'
  : `<table><tr><th>File</th><th>Error</th></tr>${errorRows}</table>`}
</body></html>`;
}
