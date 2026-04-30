import fs from 'fs';
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

let cancelRequested = false;

export function requestScanCancel() {
  cancelRequested = true;
}

export async function scanDirectory(
  sourceFolders: string[],
  sessionId: string,
  sourceIndex: number,
  win: BrowserWindow,
  enabledCategories: FileCategory[] = ['images', 'videos', 'raw']
): Promise<{ totalFiles: number; totalSize: number }> {
  cancelRequested = false;
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
      await walkDir(folder, folder, sessionId, sourceIndex, sourceLabel, enabledSet, batch, async () => {
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
    if (cancelRequested) break;
  }

  totalFiles += batch.length;
  totalSize  += batch.reduce((s, f) => s + f.size, 0);
  await flush();

  logger.info('scanner', `Discovery complete  total=${totalFiles}  size=${Math.round(totalSize/1024/1024)}MB  batches=${batchNum}`);
  return { totalFiles, totalSize };
}

async function walkDir(
  baseDir: string,
  currentDir: string,
  sessionId: string,
  sourceIndex: number,
  sourceLabel: string,
  enabledSet: Set<FileCategory>,
  batch: Omit<FileRecord, 'created_at'>[],
  onBatchReady: () => Promise<void>
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch (err) {
    logger.warn('scanner', `Cannot read directory: ${currentDir}`, String(err));
    return;
  }

  for (const entry of entries) {
    if (cancelRequested) return;
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await walkDir(baseDir, fullPath, sessionId, sourceIndex, sourceLabel, enabledSet, batch, onBatchReady);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_FORMATS.has(ext)) continue;

    const category = getCategory(ext);
    if (!enabledSet.has(category)) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch (err) {
      logger.warn('scanner', `stat failed: ${fullPath}`, String(err));
      continue;
    }

    const junk = detectJunk(fullPath, stat.size);

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

function getCategory(ext: string): FileCategory {
  if (SUPPORTED_RAW_FORMATS.includes(ext))      return 'raw';
  if (SUPPORTED_VIDEO_FORMATS.includes(ext))    return 'videos';
  if (SUPPORTED_DOCUMENT_FORMATS.includes(ext)) return 'documents';
  if (SUPPORTED_AUDIO_FORMATS.includes(ext))    return 'audio';
  if (SUPPORTED_DESIGN_FORMATS.includes(ext))   return 'design';
  if (SUPPORTED_3D_FORMATS.includes(ext))       return '3d';
  return 'images';
}
