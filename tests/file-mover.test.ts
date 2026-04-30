import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { resolveConflict, buildFullDestination, humanizeFileError } from '../src/main/file-mover';
import { FileRecord } from '../src/shared/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `pp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(p: string, content = 'data'): void {
  fs.writeFileSync(p, content, 'utf8');
}

function makeFileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: crypto.randomUUID(),
    filename: 'photo.jpg',
    source_path: '/source/photo.jpg',
    proposed_destination: null,
    size: 1024,
    date_source: 'exif',
    date_taken: '2024-03-15T12:00:00.000Z',
    camera_make: 'Apple',
    camera_model: 'iPhone 15 Pro',
    gps_lat: null,
    gps_lng: null,
    width: 4032,
    height: 3024,
    format: '.jpg',
    status: 'ready',
    junk_reason: null,
    junk_confidence: null,
    phash: null,
    file_category: 'images',
    extended_meta: null,
    metadata_depth: 'quick',
    error_message: null,
    source_index: 0,
    source_label: 'Source A',
    scan_session_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── resolveConflict ───────────────────────────────────────────────────────────

describe('resolveConflict', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns path unchanged when no conflict exists', () => {
    const dest = path.join(dir, 'photo.jpg');
    expect(resolveConflict(dest, 'rename')).toBe(dest);
  });

  it('returns null when strategy is skip and file exists', () => {
    const dest = path.join(dir, 'photo.jpg');
    writeFile(dest);
    expect(resolveConflict(dest, 'skip')).toBeNull();
  });

  it('returns original path when strategy is overwrite and file exists', () => {
    const dest = path.join(dir, 'photo.jpg');
    writeFile(dest);
    expect(resolveConflict(dest, 'overwrite')).toBe(dest);
  });

  it('appends _1 suffix on rename conflict', () => {
    const dest = path.join(dir, 'photo.jpg');
    writeFile(dest);
    const result = resolveConflict(dest, 'rename');
    expect(result).toBe(path.join(dir, 'photo_1.jpg'));
    expect(fs.existsSync(result!)).toBe(false);
  });

  it('increments suffix until a free name is found', () => {
    const dest = path.join(dir, 'photo.jpg');
    writeFile(dest);
    writeFile(path.join(dir, 'photo_1.jpg'));
    writeFile(path.join(dir, 'photo_2.jpg'));
    const result = resolveConflict(dest, 'rename');
    expect(result).toBe(path.join(dir, 'photo_3.jpg'));
  });

  it('returns path for new non-existent file regardless of strategy', () => {
    const dest = path.join(dir, 'new.jpg');
    expect(resolveConflict(dest, 'skip')).toBe(dest);
    expect(resolveConflict(dest, 'rename')).toBe(dest);
    expect(resolveConflict(dest, 'overwrite')).toBe(dest);
  });
});

// ── buildFullDestination ──────────────────────────────────────────────────────

describe('buildFullDestination', () => {
  it('builds correct date-based path', () => {
    const file = makeFileRecord({
      filename: 'IMG_1234.jpg',
      date_taken: '2024-03-15T12:00:00.000Z',
    });
    const result = buildFullDestination('/photos', '{YYYY}/{MMM}', file);
    expect(result).toContain('2024');
    expect(result).toContain('March');
    expect(result).toContain('IMG_1234.jpg');
  });

  it('falls back to "Unknown Date" when no date', () => {
    const file = makeFileRecord({ filename: 'mystery.jpg', date_taken: null });
    const result = buildFullDestination('/photos', '{YYYY}/{MMM}', file);
    expect(result).toContain('Unknown Date');
    expect(result).toContain('mystery.jpg');
  });

  it('uses camera model in pattern', () => {
    const file = makeFileRecord({
      filename: 'shot.jpg',
      date_taken: '2024-06-01T00:00:00.000Z',
      camera_model: 'Nikon Z6',
    });
    const result = buildFullDestination('/dest', '{YYYY}/{CAMERA}', file);
    expect(result).toContain('2024');
    expect(result).toContain('Nikon Z6');
  });

  it('places file directly inside destination with single-level pattern', () => {
    const file = makeFileRecord({
      filename: 'a.jpg',
      date_taken: '2023-01-10T00:00:00.000Z',
    });
    const result = buildFullDestination('/out', '{YYYY}', file);
    expect(path.dirname(result)).toBe(path.join('/out', '2023'));
    expect(path.basename(result)).toBe('a.jpg');
  });
});

// ── humanizeFileError ─────────────────────────────────────────────────────────

describe('humanizeFileError', () => {
  const cases: [string, string][] = [
    ['EACCES',  'Permission denied'],
    ['ENOENT',  'File not found'],
    ['ENOSPC',  'Disk full'],
    ['EPERM',   'Operation not permitted'],
    ['EBUSY',   'File in use'],
    ['UNKNOWN', 'Drive not ready'],
  ];

  for (const [code, expected] of cases) {
    it(`maps ${code} → "${expected}"`, () => {
      expect(humanizeFileError({ code })).toBe(expected);
    });
  }

  it('falls back to err.message for unknown codes', () => {
    expect(humanizeFileError({ code: 'WEIRD', message: 'weird error' })).toBe('weird error');
  });

  it('handles error with no message', () => {
    const result = humanizeFileError({ code: 'UNRECOGNIZED' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
