import { ExifTool, Tags } from 'exiftool-vendored';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { ScanDepth, DateSource } from '../shared/types';
import type { Mode } from '../shared/mode';
import { findSidecarForFile, parseTakeoutSidecar, extractDateFromSidecar } from './takeout-detector';

let _exiftool: ExifTool | null = null;
// Sticky death flag: once an ExifTool worker dies mid-scan we DO NOT
// re-instantiate the singleton (CLAUDE.md: "Never restart ExifTool mid-scan"
// — the no-zombie-perl rule). Subsequent readFileMeta calls in this scan
// fall back to filename/filesystem date sources. closeExiftool() resets
// both fields so the next scan starts fresh.
let _exiftoolDead = false;

class ExiftoolDeadError extends Error {
  constructor() { super('ExifTool worker died earlier in this scan'); }
}

function getExiftool(maxProcs = 1): ExifTool {
  if (_exiftoolDead) throw new ExiftoolDeadError();
  if (!_exiftool) {
    _exiftool = new ExifTool({ maxProcs, taskTimeoutMillis: 10_000 });
  }
  return _exiftool;
}

export function isExiftoolDead(): boolean {
  return _exiftoolDead;
}

export async function closeExiftool(): Promise<void> {
  const et = _exiftool;
  _exiftool = null; // null FIRST to prevent races
  _exiftoolDead = false; // next scan gets a fresh singleton
  if (et) {
    try {
      await et.end();
    } catch (err) {
      logger.warn('exif', 'Error ending ExifTool', String(err));
    }
    // Hammer mode (opt-in). Previous versions unconditionally ran
    // `taskkill /F /IM perl.exe /T` here on Windows, which killed every
    // perl process on the machine — fine when ExifTool was the only Perl
    // around, but it would also reap Strawberry Perl, Git's bundled perl,
    // etc. Now off by default; set PIXELPUSHER_HARD_KILL_PERL=1 to restore
    // the old behavior for cases where exiftool-vendored's end() hangs.
    if (process.platform === 'win32' && process.env.PIXELPUSHER_HARD_KILL_PERL === '1') {
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
  extended_meta: string | null;
  status: 'ready' | 'error';
  error_message: string | null;
  junk_reason: string | null;
  junk_confidence: 'high' | 'medium' | 'low' | null;
}

export async function readFileMeta(
  file: { id: string; source_path: string; filename: string; status: string },
  scanDepth: ScanDepth,
  maxProcs = 1,
  mode: Mode = 'photos'
): Promise<ExifResult> {
  const args = scanDepth === 'quick' ? ['-fast2'] : [];

  let tags: Tags | null = null;
  try {
    const tool = getExiftool(maxProcs);
    tags = await tool.read(file.source_path, { readArgs: args });
  } catch (err: unknown) {
    if (err instanceof ExiftoolDeadError) {
      // Singleton is dead for the rest of this scan — fall through to
      // filename/filesystem date extraction without retrying ExifTool.
    } else {
      const msg = String(err);
      // Worker died for the first time — set sticky flag, do NOT recreate.
      if (msg.includes('worker') || msg.includes('exiftool') || msg.includes('ended')) {
        logger.warn('exif', 'ExifTool worker died — disabling for rest of scan', msg);
        _exiftoolDead = true;
      } else {
        logger.warn('exif', `Read failed: ${file.source_path}`, msg);
      }
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
    extended_meta: null,
    status: 'ready',
    error_message: null,
    junk_reason: null,
    junk_confidence: null,
  };

  // Date fallback chain (Takeout sidecar takes priority when present)
  const { date, source } = extractDate(tags, file.filename, file.source_path);
  result.date_taken = date;
  result.date_source = source;

  if (mode === 'datahoarder' && tags) {
    // Document/Office/audio/design/3D files: re-purpose camera_make / camera_model
    // for the document's source. Author goes to camera_make so the existing
    // {CAMERA} pattern token shows it; Creator/Producer goes to camera_model
    // (e.g. "Microsoft Word", "Adobe Acrobat", "Pages").
    const t = tags as Record<string, unknown>;
    const author = coerceMetaString(t.Author);
    const creator = coerceMetaString(t.Creator)
      ?? coerceMetaString(t.Producer)
      ?? coerceMetaString(t.CreatorTool)
      ?? coerceMetaString(t.Application);
    if (author) result.camera_make = author;
    if (creator) result.camera_model = creator;
    // Capture the doc title (and a few cousins) for later use in clustering
    // and search. JSON keeps the column flexible without a schema migration.
    const extras: Record<string, unknown> = {};
    const title    = coerceMetaString(t.Title);
    const subject  = coerceMetaString(t.Subject);
    const keywords = coerceMetaString(t.Keywords);
    const pageCount = t.PageCount;
    if (title)    extras.title    = title;
    if (subject)  extras.subject  = subject;
    if (keywords) extras.keywords = keywords;
    if (typeof pageCount === 'number') extras.pageCount = pageCount;
    if (Object.keys(extras).length > 0) {
      result.extended_meta = JSON.stringify(extras);
    }
  } else if (tags && scanDepth === 'full') {
    if (tags.Make) result.camera_make = String(tags.Make).trim();
    if (tags.Model) result.camera_model = String(tags.Model).trim();

    const w = tags.ImageWidth ?? tags.ExifImageWidth ?? (tags as Record<string, unknown>).SourceImageWidth;
    const h = tags.ImageHeight ?? tags.ExifImageHeight ?? (tags as Record<string, unknown>).SourceImageHeight;
    if (typeof w === 'number') result.width = w;
    if (typeof h === 'number') result.height = h;

    if (typeof tags.GPSLatitude === 'number') result.gps_lat = tags.GPSLatitude;
    if (typeof tags.GPSLongitude === 'number') result.gps_lng = tags.GPSLongitude;
  } else if (tags) {
    // Quick scan (photos): still grab dimensions if available (needed for junk detection)
    const w = tags.ImageWidth ?? tags.ExifImageWidth;
    const h = tags.ImageHeight ?? tags.ExifImageHeight;
    if (typeof w === 'number') result.width = w;
    if (typeof h === 'number') result.height = h;
  }

  // Post-EXIF dimension-based junk detection (photos only — docs don't have meaningful dims)
  if (mode === 'photos' && result.width !== null && result.height !== null) {
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

// Coerce an EXIF tag value to a clean string. Handles arrays (multi-author PDFs
// return Author as ['A','B','C']) and caps the length so a 10MB doc title
// can't bloat the row.
const META_MAX_CHARS = 256;
function coerceMetaString(val: unknown): string | null {
  if (val == null) return null;
  if (Array.isArray(val)) {
    const joined = val.filter(v => v != null).map(v => String(v).trim()).filter(Boolean).join(', ');
    return joined ? joined.slice(0, META_MAX_CHARS) : null;
  }
  if (typeof val === 'string') {
    const t = val.trim();
    return t ? t.slice(0, META_MAX_CHARS) : null;
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val).slice(0, META_MAX_CHARS);
  }
  return null;
}

function exifValToISO(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'object' && 'toDate' in (val as object)) {
    try {
      const d = (val as { toDate: () => Date }).toDate();
      // Allow pre-1970 dates (film scans, archival photos) — previous >1970
      // threshold excluded legitimate captures. 1900 is a safer floor.
      if (!isNaN(d.getTime()) && d.getFullYear() >= 1900) return d.toISOString();
    } catch {}
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 1900) return d.toISOString();
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
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d);
}
