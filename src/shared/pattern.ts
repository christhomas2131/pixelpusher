export type FileCategory = 'images' | 'videos' | 'raw' | 'documents' | 'audio' | 'design' | '3d';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const QUARTER_RANGES = [
  'Jan - Mar', 'Jan - Mar', 'Jan - Mar',
  'Apr - Jun', 'Apr - Jun', 'Apr - Jun',
  'Jul - Sep', 'Jul - Sep', 'Jul - Sep',
  'Oct - Dec', 'Oct - Dec', 'Oct - Dec',
];

const HALF_RANGES = [
  'Jan - Jun','Jan - Jun','Jan - Jun','Jan - Jun','Jan - Jun','Jan - Jun',
  'Jul - Dec','Jul - Dec','Jul - Dec','Jul - Dec','Jul - Dec','Jul - Dec',
];

const TYPE_LABELS: Record<string, string> = {
  images: 'Photos',
  videos: 'Videos',
  raw: 'RAW',
  documents: 'Documents',
  audio: 'Music',
  design: 'Design',
  '3d': '3D',
};

export interface PatternContext {
  date?: Date | null;
  cameraModel?: string | null;
  category?: FileCategory | string | null;
  format?: string | null;
  yearRangeSize?: number;
}

export function resolvePattern(pattern: string, ctx: PatternContext): string {
  if (!pattern) return 'Unknown';

  const { date, cameraModel, category, format, yearRangeSize = 5 } = ctx;
  const d = date ?? null;

  if (!d) {
    return pattern.replace(/\{[^}]+\}/g, 'Unknown');
  }

  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  const day = d.getDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  const camera = sanitizePart(cameraModel ?? 'Unknown Camera');
  const ext = (format ?? '').replace(/^\./, '').toLowerCase();
  const cat = (category as string) ?? 'images';

  const rangeStart = Math.floor(year / yearRangeSize) * yearRangeSize;
  const rangeEnd = rangeStart + yearRangeSize - 1;

  return pattern
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, String(year).slice(-2))
    .replace(/\{MM\}/g, pad(month + 1))
    .replace(/\{MMM\}/g, MONTH_NAMES[month])
    .replace(/\{DD\}/g, pad(day))
    .replace(/\{QUARTER\}/g, `${QUARTER_RANGES[month]} ${year}`)
    .replace(/\{HALF\}/g, `${HALF_RANGES[month]} ${year}`)
    .replace(/\{YEAR_RANGE\}/g, `${rangeStart} - ${rangeEnd}`)
    .replace(/\{CAMERA\}/g, camera)
    .replace(/\{TYPE\}/g, cat)
    .replace(/\{TYPE_LABEL\}/g, TYPE_LABELS[cat] ?? cat)
    .replace(/\{EXT\}/g, ext)
    .replace(/\{TAG\}/g, 'Untagged');
}

function sanitizePart(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Unknown';
}

export function getPatternTokens(): Array<{ token: string; description: string; example: string }> {
  return [
    { token: '{YYYY}',       description: 'Four-digit year',           example: '2024' },
    { token: '{YY}',         description: 'Two-digit year',            example: '24' },
    { token: '{MM}',         description: 'Month number (padded)',      example: '03' },
    { token: '{MMM}',        description: 'Full month name',            example: 'March' },
    { token: '{DD}',         description: 'Day (padded)',               example: '15' },
    { token: '{QUARTER}',    description: 'Quarter range',              example: 'Jan - Mar 2024' },
    { token: '{HALF}',       description: 'Half-year range',            example: 'Jan - Jun 2024' },
    { token: '{YEAR_RANGE}', description: 'Multi-year group (5yr)',     example: '2020 - 2024' },
    { token: '{CAMERA}',     description: 'Camera model',               example: 'iPhone 15 Pro' },
    { token: '{TYPE}',       description: 'File category',              example: 'images' },
    { token: '{TYPE_LABEL}', description: 'File category label',        example: 'Photos' },
    { token: '{EXT}',        description: 'File extension',             example: 'jpg' },
  ];
}
