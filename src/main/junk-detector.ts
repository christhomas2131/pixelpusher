import path from 'path';
import type { FileCategory } from '../shared/types';

export interface JunkResult {
  isJunk: boolean;
  reason: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
}

const PHOTO_CATEGORIES = new Set<FileCategory>(['images', 'videos', 'raw']);

// Document-class files (DataHoarder mode) — Office locks, OS metadata, temp files.
// These are high-confidence regardless of size.
const DATAHOARDER_FILENAME_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^~\$/, reason: 'office_lock' },              // ~$Document.docx
  { pattern: /^\._/, reason: 'macos_metadata' },           // ._foo.pdf (macOS resource fork)
  { pattern: /\.tmp$/i, reason: 'temp_file' },
  { pattern: /\.crdownload$/i, reason: 'incomplete_download' },
  { pattern: /\.partial$/i, reason: 'incomplete_download' },
  { pattern: /\.[a-f0-9]{8,}\.tmp$/i, reason: 'temp_file' },
];

const HIGH_CONFIDENCE_DIR_SEGMENTS = new Set([
  'Thumbnails', 'thumbnails', '.thumbnails',
  'Faces', 'Face Recognition',
  'iPod Photo Cache',
  'Previews.lrdata',
  '.picasa_originals',
  'Thumbs',
  '@eaDir',
  'SYNOFILE_THUMB',
  '__MACOSX',
  'AlbumArtSmall',
]);

const HIGH_CONFIDENCE_FILENAMES: RegExp[] = [
  /^thumbs\.db$/i,
  /^\.picasa\.ini$/i,
  /^desktop\.ini$/i,
  /^\.ds_store$/i,
  /^folder\.(jpg|jpeg|png)$/i,
];

const HIGH_CONFIDENCE_SUFFIXES: RegExp[] = [
  /_thumb\./i,
  /_small\./i,
  /_preview\./i,
  /_thumbnail\./i,
];

const PHOTO_JUNK_SIZE_THRESHOLD = 50_000;   // 50KB — tiny photos are almost always thumbs
const DOC_JUNK_SIZE_THRESHOLD = 100;        // 100B — only catch truly broken/empty doc files

export function detectJunk(filePath: string, size: number, category?: FileCategory): JunkResult {
  const filename = path.basename(filePath);
  const parts = filePath.split(/[/\\]/);
  const dirParts = parts.slice(0, -1);

  // Path-based (high confidence) — applies in every mode
  for (const seg of dirParts) {
    if (HIGH_CONFIDENCE_DIR_SEGMENTS.has(seg)) {
      return { isJunk: true, reason: 'junk_directory', confidence: 'high' };
    }
    if (seg.startsWith('SYNOFILE_THUMB') || seg.startsWith('.thumbnail')) {
      return { isJunk: true, reason: 'junk_directory', confidence: 'high' };
    }
  }

  // Universal filename junk (Thumbs.db etc.) regardless of category
  for (const re of HIGH_CONFIDENCE_FILENAMES) {
    if (re.test(filename)) {
      return { isJunk: true, reason: 'system_file', confidence: 'high' };
    }
  }

  const isPhotoLike = !category || PHOTO_CATEGORIES.has(category);

  if (isPhotoLike) {
    // Photos / videos / RAW: existing thumbnail-suffix detection + 50KB threshold.
    for (const re of HIGH_CONFIDENCE_SUFFIXES) {
      if (re.test(filename)) {
        return { isJunk: true, reason: 'thumbnail_suffix', confidence: 'high' };
      }
    }
    if (size < PHOTO_JUNK_SIZE_THRESHOLD) {
      return { isJunk: true, reason: 'tiny_file', confidence: 'medium' };
    }
    return { isJunk: false, reason: null, confidence: null };
  }

  // DataHoarder categories (documents, audio, design, 3d): different patterns.
  for (const { pattern, reason } of DATAHOARDER_FILENAME_PATTERNS) {
    if (pattern.test(filename)) {
      return { isJunk: true, reason, confidence: 'high' };
    }
  }
  // Genuinely empty/broken files only — don't flag legitimately small docs.
  if (size < DOC_JUNK_SIZE_THRESHOLD) {
    return { isJunk: true, reason: 'empty_file', confidence: 'high' };
  }
  return { isJunk: false, reason: null, confidence: null };
}

export function detectJunkByDimensions(
  width: number | null,
  height: number | null
): JunkResult {
  if (width !== null && height !== null && width < 200 && height < 200) {
    return { isJunk: true, reason: 'small_dimensions', confidence: 'medium' };
  }
  return { isJunk: false, reason: null, confidence: null };
}
