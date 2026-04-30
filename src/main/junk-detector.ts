import path from 'path';

export interface JunkResult {
  isJunk: boolean;
  reason: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
}

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

const JUNK_SIZE_THRESHOLD = 50_000; // 50KB

export function detectJunk(filePath: string, size: number): JunkResult {
  const filename = path.basename(filePath);
  const parts = filePath.split(/[/\\]/);
  const dirParts = parts.slice(0, -1);

  // Path-based (high confidence)
  for (const seg of dirParts) {
    if (HIGH_CONFIDENCE_DIR_SEGMENTS.has(seg)) {
      return { isJunk: true, reason: 'junk_directory', confidence: 'high' };
    }
    // Partial match for things like SYNOFILE_THUMB_1920x1080
    if (seg.startsWith('SYNOFILE_THUMB') || seg.startsWith('.thumbnail')) {
      return { isJunk: true, reason: 'junk_directory', confidence: 'high' };
    }
  }

  // Filename-based (high confidence)
  for (const re of HIGH_CONFIDENCE_FILENAMES) {
    if (re.test(filename)) {
      return { isJunk: true, reason: 'system_file', confidence: 'high' };
    }
  }
  for (const re of HIGH_CONFIDENCE_SUFFIXES) {
    if (re.test(filename)) {
      return { isJunk: true, reason: 'thumbnail_suffix', confidence: 'high' };
    }
  }

  // Size-based (medium confidence)
  if (size < JUNK_SIZE_THRESHOLD) {
    return { isJunk: true, reason: 'tiny_file', confidence: 'medium' };
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
