import fs from 'fs';
import path from 'path';
import { resolvePattern, PatternContext } from '../shared/pattern';
import { FileRecord } from '../shared/types';

export async function safeCopy(src: string, dest: string): Promise<void> {
  const safeSrc  = process.platform === 'win32' ? '\\\\?\\' + path.resolve(src)  : src;
  const safeDest = process.platform === 'win32' ? '\\\\?\\' + path.resolve(dest) : dest;

  try {
    fs.copyFileSync(safeSrc, safeDest);
    const { atime, mtime } = fs.statSync(safeSrc);
    fs.utimesSync(safeDest, atime, mtime);
  } catch (err: any) {
    if (err.code === 'UNKNOWN') {
      await new Promise(r => setTimeout(r, 15_000));
      fs.copyFileSync(safeSrc, safeDest);
      const { atime, mtime } = fs.statSync(safeSrc);
      fs.utimesSync(safeDest, atime, mtime);
    } else {
      throw err;
    }
  }
}

export async function safeMove(src: string, dest: string): Promise<void> {
  try {
    fs.renameSync(src, dest);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      await safeCopy(src, dest);
      fs.unlinkSync(src);
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
  const date = file.date_taken ? new Date(file.date_taken) : null;
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
