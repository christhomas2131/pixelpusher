import { describe, it, expect } from 'vitest';
import { detectJunk, detectJunkByDimensions } from '../src/main/junk-detector';

describe('detectJunk — path-based', () => {
  it('flags files inside Thumbnails directory', () => {
    const r = detectJunk('/photos/Thumbnails/img.jpg', 500_000);
    expect(r.isJunk).toBe(true);
    expect(r.reason).toBe('junk_directory');
    expect(r.confidence).toBe('high');
  });

  it('flags files inside .thumbnails directory', () => {
    const r = detectJunk('/home/user/.thumbnails/cache.jpg', 200_000);
    expect(r.isJunk).toBe(true);
    expect(r.confidence).toBe('high');
  });

  it('flags files inside @eaDir (Synology)', () => {
    const r = detectJunk('/volume1/photos/@eaDir/img.jpg', 100_000);
    expect(r.isJunk).toBe(true);
  });

  it('flags files inside __MACOSX resource fork directories', () => {
    const r = detectJunk('/downloads/__MACOSX/image.jpg', 80_000);
    expect(r.isJunk).toBe(true);
  });

  it('flags files in SYNOFILE_THUMB variants', () => {
    const r = detectJunk('/photos/SYNOFILE_THUMB_1920x1080/img.jpg', 200_000);
    expect(r.isJunk).toBe(true);
  });
});

describe('detectJunk — filename-based', () => {
  it('flags Thumbs.db (case-insensitive)', () => {
    const r = detectJunk('/photos/Thumbs.db', 10_000);
    expect(r.isJunk).toBe(true);
    expect(r.reason).toBe('system_file');
  });

  it('flags THUMBS.DB (uppercase)', () => {
    const r = detectJunk('/photos/THUMBS.DB', 5_000);
    expect(r.isJunk).toBe(true);
  });

  it('flags .DS_Store', () => {
    const r = detectJunk('/photos/.DS_Store', 8_192);
    expect(r.isJunk).toBe(true);
  });

  it('flags folder.jpg', () => {
    const r = detectJunk('/photos/Album/folder.jpg', 300_000);
    expect(r.isJunk).toBe(true);
  });

  it('flags files with _thumb suffix', () => {
    const r = detectJunk('/photos/img_thumb.jpg', 300_000);
    expect(r.isJunk).toBe(true);
    expect(r.reason).toBe('thumbnail_suffix');
  });

  it('flags files with _preview suffix', () => {
    const r = detectJunk('/photos/img_preview.jpg', 300_000);
    expect(r.isJunk).toBe(true);
  });
});

describe('detectJunk — size-based', () => {
  it('flags files under 50KB', () => {
    const r = detectJunk('/photos/normal_path/photo.jpg', 30_000);
    expect(r.isJunk).toBe(true);
    expect(r.reason).toBe('tiny_file');
    expect(r.confidence).toBe('medium');
  });

  it('does not flag files exactly at 50KB threshold', () => {
    const r = detectJunk('/photos/normal_path/photo.jpg', 50_000);
    expect(r.isJunk).toBe(false); // threshold is strict < 50_000
  });

  it('does not flag normal-sized photos', () => {
    const r = detectJunk('/photos/vacations/IMG_1234.jpg', 3_500_000);
    expect(r.isJunk).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.confidence).toBeNull();
  });

  it('does not flag RAW files in normal directories', () => {
    const r = detectJunk('/photos/2024/DSC_0001.NEF', 25_000_000);
    expect(r.isJunk).toBe(false);
  });
});

describe('detectJunkByDimensions', () => {
  it('flags images under 200x200', () => {
    const r = detectJunkByDimensions(100, 100);
    expect(r.isJunk).toBe(true);
    expect(r.reason).toBe('small_dimensions');
    expect(r.confidence).toBe('medium');
  });

  it('flags 1x1 pixel images', () => {
    const r = detectJunkByDimensions(1, 1);
    expect(r.isJunk).toBe(true);
  });

  it('flags 199x199 images', () => {
    const r = detectJunkByDimensions(199, 199);
    expect(r.isJunk).toBe(true);
  });

  it('does NOT flag 200x200 images', () => {
    const r = detectJunkByDimensions(200, 200);
    expect(r.isJunk).toBe(false);
  });

  it('does NOT flag normal photos (4032x3024)', () => {
    const r = detectJunkByDimensions(4032, 3024);
    expect(r.isJunk).toBe(false);
  });

  it('does NOT flag when dimensions are null', () => {
    const r = detectJunkByDimensions(null, null);
    expect(r.isJunk).toBe(false);
  });

  it('does NOT flag when only one dimension is known and small', () => {
    const r = detectJunkByDimensions(100, null);
    expect(r.isJunk).toBe(false);
  });
});
