export const SUPPORTED_IMAGE_FORMATS = [
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.heic', '.heif',
  '.webp', '.bmp', '.gif',
];

export const SUPPORTED_RAW_FORMATS = [
  '.cr2', '.nef', '.arw', '.dng', '.orf', '.rw2', '.pef',
  '.raf', '.sr2', '.mrw',
];

export const SUPPORTED_VIDEO_FORMATS = [
  '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm',
  '.m4v', '.3gp', '.mts', '.m2ts',
];

export const SUPPORTED_DOCUMENT_FORMATS = [
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.txt', '.rtf', '.csv',
];

export const SUPPORTED_AUDIO_FORMATS = [
  '.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma', '.m4a',
];

export const SUPPORTED_DESIGN_FORMATS = [
  '.psd', '.ai', '.svg', '.eps', '.indd', '.sketch', '.fig', '.xd',
];

export const SUPPORTED_3D_FORMATS = [
  '.stl', '.obj', '.fbx', '.gltf', '.step', '.blend', '.dxf',
];

export const ALL_EXTENDED_FORMATS = new Set([
  ...SUPPORTED_DOCUMENT_FORMATS,
  ...SUPPORTED_AUDIO_FORMATS,
  ...SUPPORTED_DESIGN_FORMATS,
  ...SUPPORTED_3D_FORMATS,
]);

export const SUPPORTED_FORMATS = new Set([
  ...SUPPORTED_IMAGE_FORMATS,
  ...SUPPORTED_RAW_FORMATS,
  ...SUPPORTED_VIDEO_FORMATS,
  ...SUPPORTED_DOCUMENT_FORMATS,
  ...SUPPORTED_AUDIO_FORMATS,
  ...SUPPORTED_DESIGN_FORMATS,
  ...SUPPORTED_3D_FORMATS,
]);

export const HASHABLE_FORMATS = new Set([
  ...SUPPORTED_IMAGE_FORMATS,
  ...SUPPORTED_RAW_FORMATS,
]);

export const SKIP_DIRS = new Set([
  'node_modules',
  '$RECYCLE.BIN',
  '.Trash',
  '@eaDir',
  '__MACOSX',
  '.Spotlight-V100',
  '.fseventsd',
  'System Volume Information',
  '_PixelPusher_Quarantine',
]);

export const JUNK_FILENAME_PATTERNS: RegExp[] = [
  /^thumbs\.db$/i,
  /^\.ds_store$/i,
  /^desktop\.ini$/i,
  /^album_art/i,
  /^folder\.(jpg|jpeg|png)$/i,
];

export const JUNK_DIR_NAMES = new Set([
  '.thumbnails',
  '@eaDir',
  '.cache',
  '__MACOSX',
  'AlbumArtSmall',
]);

export const BATCH_SIZE_INSERT  = 500;
export const BATCH_SIZE_EXIF    = 20;
export const BATCH_SIZE_ORGANIZE = 100;
export const BATCH_SIZE_HASH    = 20;
export const MAX_ERRORS         = 50;
export const DB_VERSION         = 1;
export const TINY_FILE_THRESHOLD = 5000;

export const DEFAULT_FOLDER_PATTERN = '{YYYY}/{MMM}';

export const CATEGORY_EXTENSIONS: Record<string, string[]> = {
  images:    SUPPORTED_IMAGE_FORMATS,
  raw:       SUPPORTED_RAW_FORMATS,
  videos:    SUPPORTED_VIDEO_FORMATS,
  documents: SUPPORTED_DOCUMENT_FORMATS,
  audio:     SUPPORTED_AUDIO_FORMATS,
  design:    SUPPORTED_DESIGN_FORMATS,
  '3d':      SUPPORTED_3D_FORMATS,
};

export const DEFAULT_ENABLED_CATEGORIES = ['images', 'videos'] as const;

export const SOURCE_BADGE_COLORS = [
  '#4f8ef7', // A – blue (accent)
  '#9b59b6', // B – purple
  '#e67e22', // C – orange
  '#27ae60', // D – green
  '#e74c3c', // E – red
  '#16a085', // F – teal
];
