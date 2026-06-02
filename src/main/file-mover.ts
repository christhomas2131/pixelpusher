import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { resolvePattern, PatternContext } from '../shared/pattern';
import { FileRecord } from '../shared/types';
import { logger } from './logger';

export async function safeCopy(src: string, dest: string): Promise<void> {
  const safeSrc  = process.platform === 'win32' ? '\\\\?\\' + path.resolve(src)  : src;
  const safeDest = process.platform === 'win32' ? '\\\\?\\' + path.resolve(dest) : dest;

  const copyOnce = async () => {
    await fsp.copyFile(safeSrc, safeDest);
    const { atime, mtime } = await fsp.stat(safeSrc);
    await fsp.utimes(safeDest, atime, mtime);
  };

  try {
    await copyOnce();
  } catch (err: any) {
    if (err.code === 'UNKNOWN') {
      await new Promise(r => setTimeout(r, 15_000));
      await copyOnce();
    } else {
      throw err;
    }
  }
}

export async function safeMove(src: string, dest: string): Promise<void> {
  try {
    await fsp.rename(src, dest);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      await safeCopy(src, dest);
      await fsp.unlink(src);
    } else {
      throw err;
    }
  }
}

export function resolveConflict(
  dest: string,
  strategy: 'rename' | 'skip' | 'overwrite'
): string | null {
  if (!fs.existsSync(dest)) return dest;
  if (strategy === 'skip') return null;
  if (strategy === 'overwrite') return dest;

  const ext  = path.extname(dest);
  const base = dest.slice(0, -ext.length);
  for (let i = 1; i <= 9999; i++) {
    const candidate = `${base}_${i}${ext}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  logger.warn('file-mover', `resolveConflict: exhausted 9999 candidates for ${dest}`);
  return null;
}

const KNOWN_TOKENS = new Set([
  '{YYYY}','{YY}','{MM}','{MMM}','{DD}',
  '{QUARTER}','{HALF}','{YEAR_RANGE}',
  '{CAMERA}','{TYPE}','{TYPE_LABEL}','{EXT}',
]);

export function validatePattern(pattern: string): { valid: boolean; unknown: string[] } {
  const found = pattern.match(/\{[A-Z_]+\}/g) ?? [];
  const unknown = found.filter(t => !KNOWN_TOKENS.has(t));
  return { valid: unknown.length === 0, unknown };
}

export function buildFullDestination(destination: string, pattern: string, file: FileRecord): string {
  const rawDate = file.date_taken ? new Date(file.date_taken) : null;
  const date = rawDate && !isNaN(rawDate.getTime()) ? rawDate : null;
  const ctx: PatternContext = {
    date,
    cameraModel: file.camera_model,
    category: file.file_category,
    format: file.format,
  };
  const folder = date ? resolvePattern(pattern, ctx) : 'Unknown Date';
  return path.join(destination, folder, file.filename);
}

export function humanizeFileError(err: any): string {
  switch (err.code) {
    case 'EACCES':  return 'Permission denied';
    case 'ENOENT':  return 'File not found';
    case 'ENOSPC':  return 'Disk full';
    case 'EPERM':   return 'Operation not permitted';
    case 'EBUSY':   return 'File in use';
    case 'UNKNOWN': return 'Drive not ready';
    default:        return err.message || 'Unknown error';
  }
}
