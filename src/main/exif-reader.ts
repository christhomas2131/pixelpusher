import { ExifTool, Tags } from 'exiftool-vendored';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { ScanDepth, DateSource } from '../shared/types';
import { findSidecarForFile, parseTakeoutSidecar, extractDateFromSidecar } from './takeout-detector';

let _exiftool: ExifTool | null = null;

function getExiftool(maxProcs = 1): ExifTool {
  if (!_exiftool) {
    _exiftool = new ExifTool({ maxProcs, taskTimeoutMillis: 10_000 });
  }
  return _exiftool;
}

export async function closeExiftool(): Promise<void> {
  const et = _exiftool;
  _exiftool = null; // null FIRST to prevent races
  if (et) {
    try {
      await et.end();
    } catch (err) {
      logger.warn('exif', 'Error ending ExifTool', String(err));
    }
    if (process.platform === 'win32') {
      try { execSync('taskkill /F /IM perl.exe /T', { stdio: 'ignore' }); } catch {}
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

export interface ExifResult {
  id: string;
  date_taken: string | null;
  date_source: DateSource;
  camera_make: string | null;
  camera_model: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  width: number | null;
  height: number | null;
  status: 'ready' | 'error';
  error_message: string | null;
  junk_reason: string | null;
  junk_confidence: 'high' | 'medium' | 'low' | null;
}

export async function readFileMeta(
  file: { id: string; source_path: string; filename: string; status: string },
  scanDepth: ScanDepth,
  maxProcs = 1
): Promise<ExifResult> {
  const tool = getExiftool(maxProcs);
  const args = scanDepth === 'quick' ? ['-fast2'] : [];

  let tags: Tags | null = null;
  try {
    tags = await tool.read(file.source_path, args);
  } catch (err: unknown) {
    const msg = String(err);
    // If workers all died, reset singleton so next call gets a fresh instance
    if (msg.includes('worker') || msg.includes('exiftool') || msg.includes('ended')) {
      logger.warn('exif', 'ExifTool worker died, resetting singleton', msg);
      _exiftool = null;
      await new Promise(r => setTimeout(r, 1000));
    } else {
      logger.warn('exif', `Read failed: ${file.source_path}`, msg);
    }
  }

  const result: ExifResult = {
    id: file.id,
    date_taken: null,
    date_source: 'unknown',
    camera_make: null,
    camera_model: null,
    gps_lat: null,
    gps_lng: null,
    width: null,
    height: null,
    status: 'ready',
    error_message: null,
    junk_reason: null,
    junk_confidence: null,
  };

  // Date fallback chain (Takeout sidecar takes priority when present)
  const { date, source } = extractDate(tags, file.filename, file.source_path);
  result.date_taken = date;
  result.date_source = source;

  if (tags && scanDepth === 'full') {
    if (tags.Make) result.camera_make = String(tags.Make).trim();
    if (tags.Model) result.camera_model = String(tags.Model).trim();

    const w = tags.ImageWidth ?? tags.ExifImageWidth ?? (tags as Record<string, unknown>).SourceImageWidth;
    const h = tags.ImageHeight ?? tags.ExifImageHeight ?? (tags as Record<string, unknown>).SourceImageHeight;
    if (typeof w === 'number') result.width = w;
    if (typeof h === 'number') result.height = h;

    if (typeof tags.GPSLatitude === 'number') result.gps_lat = tags.GPSLatitude;
    if (typeof tags.GPSLongitude === 'number') result.gps_lng = tags.GPSLongitude;
  } else if (tags) {
    // Quick scan: still grab dimensions if available (needed for junk detection)
    const w = tags.ImageWidth ?? tags.ExifImageWidth;
    const h = tags.ImageHeight ?? tags.ExifImageHeight;
    if (typeof w === 'number') result.width = w;
    if (typeof h === 'number') result.height = h;
  }

  // Post-EXIF dimension-based junk detection
  if (result.width !== null && result.height !== null) {
    if (result.width < 200 && result.height < 200) {
      result.junk_reason = 'small_dimensions';
      result.junk_confidence = 'medium';
    }
  }

  return result;
}

// ── Date extraction ──────────────────────────────────────────────────────────

function extractDate(
  tags: Tags | null,
  filename: string,
  filePath: string
): { date: string | null; source: DateSource } {
  // 0. Google Photos Takeout JSON sidecar (highest priority)
  const sidecarPath = findSidecarForFile(filePath);
  if (sidecarPath) {
    const sidecar = parseTakeoutSidecar(sidecarPath);
    if (sidecar) {
      const takeoutDate = extractDateFromSidecar(sidecar);
      if (takeoutDate) return { date: takeoutDate, source: 'takeout' };
    }
  }

  // 1. EXIF dates
  if (tags) {
    const candidates = [
      tags.DateTimeOriginal,
      tags.CreateDate,
      (tags as Record<string, unknown>).MediaCreateDate,
      (tags as Record<string, unknown>).TrackCreateDate,
    ];
    for (const dt of candidates) {
      const iso = exifValToISO(dt);
      if (iso) return { date: iso, source: 'exif' };
    }
  }

  // 2. Filename date patterns
  const fnDate = parseDateFromFilename(filename);
  if (fnDate) return { date: fnDate, source: 'filename' };

  // 3. Filesystem dates
  try {
    const stat = fs.statSync(filePath);
    if (stat.mtime && !isNaN(stat.mtime.getTime()) && stat.mtime.getTime() > 0) {
      return { date: stat.mtime.toISOString(), source: 'modified' };
    }
    if (stat.birthtime && !isNaN(stat.birthtime.getTime()) && stat.birthtime.getTime() > 0) {
      return { date: stat.birthtime.toISOString(), source: 'created' };
    }
  } catch {
    // file unreadable
  }

  return { date: null, source: 'unknown' };
}

function exifValToISO(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'object' && 'toDate' in (val as object)) {
    try {
      const d = (val as { toDate: () => Date }).toDate();
      if (!isNaN(d.getTime()) && d.getFullYear() > 1970) return d.toISOString();
    } catch {}
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1970) return d.toISOString();
  }
  return null;
}

const FILENAME_DATE_PATTERNS: Array<(name: string) => Date | null> = [
  // Screenshot 2025-03-25 / 2025-03-25
  (n) => {
    const m = n.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return makeDate(+m[1], +m[2], +m[3]);
  },
  // 2025_03_25
  (n) => {
    const m = n.match(/(\d{4})_(\d{2})_(\d{2})/);
    if (!m) return null;
    return makeDate(+m[1], +m[2], +m[3]);
  },
  // IMG_20250325 / VID_20250325 / WA20250325
  (n) => {
    const m = n.match(/(?:IMG|VID|WA)_?(\d{4})(\d{2})(\d{2})/i);
    if (!m) return null;
    return makeDate(+m[1], +m[2], +m[3]);
  },
  // Plain YYYYMMDD — must be standalone 8-digit group
  (n) => {
    const m = n.match(/(?<!\d)(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/);
    if (!m) return null;
    return makeDate(+m[1], +m[2], +m[3]);
  },
];

function parseDateFromFilename(filename: string): string | null {
  const name = path.basename(filename, path.extname(filename));
  for (const parser of FILENAME_DATE_PATTERNS) {
    const d = parser(name);
    if (d && !isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function makeDate(y: number, mo: number, d: number): Date | null {
  if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d);
}
