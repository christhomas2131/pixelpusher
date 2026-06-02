import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { insertFilesBatch } from './database';
import { detectJunk } from './junk-detector';
import { logger } from './logger';
import {
  SUPPORTED_FORMATS,
  SUPPORTED_RAW_FORMATS, SUPPORTED_VIDEO_FORMATS,
  SUPPORTED_DOCUMENT_FORMATS, SUPPORTED_AUDIO_FORMATS,
  SUPPORTED_DESIGN_FORMATS, SUPPORTED_3D_FORMATS,
  SKIP_DIRS, BATCH_SIZE_INSERT,
} from '../shared/constants';
import { FileRecord, FileCategory } from '../shared/types';

// Cancel token threaded into each scan, replacing the prior module-level
// `cancelRequested` flag that aliased across concurrent invocations (single
// active scan today, but the gate is in ipc-handlers and not in the
// scanner — easier to reason about with explicit ownership).
export interface ScanCancelToken {
  cancelled: boolean;
}

const sharedToken: ScanCancelToken = { cancelled: false };

export function requestScanCancel() {
  sharedToken.cancelled = true;
}

export async function scanDirectory(
  sourceFolders: string[],
  sessionId: string,
  sourceIndex: number,
  win: BrowserWindow,
  enabledCategories: FileCategory[] = ['images', 'videos', 'raw'],
  token: ScanCancelToken = sharedToken,
): Promise<{ totalFiles: number; totalSize: number }> {
  token.cancelled = false;
  // Reset the shared token if we're using it — otherwise leave the caller's
  // token alone (their job to reset between runs).
  if (token === sharedToken) sharedToken.cancelled = false;

  let totalFiles = 0;
  let totalSize  = 0;
  let batch: Omit<FileRecord, 'created_at'>[] = [];
  let batchNum   = 0;

  const enabledSet = new Set<FileCategory>(enabledCategories);

  logger.info('scanner', `Starting scan  session=${sessionId}  folders=${sourceFolders.length}  categories=${[...enabledSet].join(',')}`);
  for (const f of sourceFolders) logger.info('scanner', `  Source: ${f}`);

  const flush = async () => {
    if (batch.length > 0) {
      insertFilesBatch(batch);
      batch.length = 0; // mutate in-place so walkDir's parameter reference stays valid
      await new Promise<void>(r => setImmediate(r));
    }
  };

  const sourceLabel = sourceFolders.length === 1
    ? path.basename(sourceFolders[0])
    : `Source ${String.fromCharCode(65 + sourceIndex)}`;

  for (const folder of sourceFolders) {
    const folderStart = Date.now();
    logger.info('scanner', `Walking: ${folder}`);
    try {
      await walkDir(folder, folder, sessionId, sourceIndex, sourceLabel, enabledSet, batch, token, async () => {
        if (batch.length >= BATCH_SIZE_INSERT) {
          batchNum++;
          totalFiles += batch.length;
          totalSize  += batch.reduce((s, f) => s + f.size, 0);
          const mem = process.memoryUsage();
          logger.debug('scanner', `Batch #${batchNum} flushed — discovered=${totalFiles} heap=${Math.round(mem.heapUsed/1024/1024)}MB`);
          if (!win.isDestroyed()) {
            win.webContents.send('scan:progress', {
              phase: 'discovering',
              discovered: totalFiles,
              processed: 0,
              total: 0,
            });
          }
          await flush();
        }
      });
    } catch (err) {
      const mem = process.memoryUsage();
      logger.logError('scanner', `Walk failed: ${folder}  discovered=${totalFiles}  batch=${batchNum}  heap=${Math.round(mem.heapUsed/1024/1024)}MB`, err);
    }
    const elapsed = ((Date.now() - folderStart) / 1000).toFixed(1);
    logger.info('scanner', `Finished: ${folder}  elapsed=${elapsed}s`);
    if (token.cancelled) break;
  }

  const tailBatch = batch.slice();
  await flush();
  if (tailBatch.length > 0) {
    totalFiles += tailBatch.length;
    totalSize  += tailBatch.reduce((s, f) => s + f.size, 0);
  }

  logger.info('scanner', `Discovery complete  total=${totalFiles}  size=${Math.round(totalSize/1024/1024)}MB  batches=${batchNum}`);
  return { totalFiles, totalSize };
}

// Iterative directory walker. Async readdir/stat keep the event loop alive
// (sync versions stalled it on deep trees, tripping Windows' "hung process"
// heuristic). Iterative beats recursive because pathological deep trees
// (40+ levels) used to risk stack overflow on Node's default stack budget.
async function walkDir(
  baseDir: string,
  startDir: string,
  sessionId: string,
  sourceIndex: number,
  sourceLabel: string,
  enabledSet: Set<FileCategory>,
  batch: Omit<FileRecord, 'created_at'>[],
  token: ScanCancelToken,
  onBatchReady: () => Promise<void>,
): Promise<void> {
  const queue: string[] = [startDir];
  while (queue.length > 0) {
    if (token.cancelled) return;
    const currentDir = queue.pop()!;

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      logger.warn('scanner', `Cannot read directory: ${currentDir}`, String(err));
      continue;
    }

    for (const entry of entries) {
      if (token.cancelled) return;
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_FORMATS.has(ext)) continue;

      const category = getCategory(ext);
      if (!enabledSet.has(category)) continue;

      let stat: fs.Stats;
      try {
        stat = await fsp.stat(fullPath);
      } catch (err) {
        logger.warn('scanner', `stat failed: ${fullPath}`, String(err));
        continue;
      }

      const junk = detectJunk(fullPath, stat.size, category);

      const record: Omit<FileRecord, 'created_at'> = {
        id: crypto.randomUUID(),
        filename: entry.name,
        source_path: fullPath,
        proposed_destination: null,
        size: stat.size,
        date_source: null,
        date_taken: null,
        camera_make: null,
        camera_model: null,
        gps_lat: null,
        gps_lng: null,
        width: null,
        height: null,
        format: ext,
        status: junk.isJunk ? 'junk' : 'pending',
        junk_reason: junk.reason,
        junk_confidence: junk.confidence,
        phash: null,
        file_category: category,
        extended_meta: null,
        metadata_depth: 'quick',
        error_message: null,
        source_index: sourceIndex,
        source_label: sourceLabel,
        scan_session_id: sessionId,
      };

      batch.push(record);
      if (batch.length >= BATCH_SIZE_INSERT) {
        await onBatchReady();
      }
    }
  }
}

function getCategory(ext: string): FileCategory {
  if (SUPPORTED_RAW_FORMATS.includes(ext))      return 'raw';
  if (SUPPORTED_VIDEO_FORMATS.includes(ext))    return 'videos';
  if (SUPPORTED_DOCUMENT_FORMATS.includes(ext)) return 'documents';
  if (SUPPORTED_AUDIO_FORMATS.includes(ext))    return 'audio';
  if (SUPPORTED_DESIGN_FORMATS.includes(ext))   return 'design';
  if (SUPPORTED_3D_FORMATS.includes(ext))       return '3d';
  return 'images';
}
