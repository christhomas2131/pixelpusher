import { describe, it, expect } from 'vitest';
import { resolvePattern } from '../src/shared/pattern';

describe('resolvePattern', () => {
  const date = new Date('2024-03-15T12:00:00Z');
  const ctx = { date, cameraModel: 'iPhone 15 Pro', category: 'images' as const, format: 'jpg' };

  it('resolves {YYYY}', () => {
    expect(resolvePattern('{YYYY}', ctx)).toBe('2024');
  });

  it('resolves {YY}', () => {
    expect(resolvePattern('{YY}', ctx)).toBe('24');
  });

  it('resolves {MM}', () => {
    expect(resolvePattern('{MM}', ctx)).toBe('03');
  });

  it('resolves {MMM} as full month name', () => {
    expect(resolvePattern('{MMM}', ctx)).toBe('March');
  });

  it('resolves {DD}', () => {
    expect(resolvePattern('{DD}', ctx)).toBe('15');
  });

  it('resolves {QUARTER}', () => {
    expect(resolvePattern('{QUARTER}', ctx)).toBe('Jan - Mar 2024');
  });

  it('resolves {HALF}', () => {
    expect(resolvePattern('{HALF}', ctx)).toBe('Jan - Jun 2024');
  });

  it('resolves {YEAR_RANGE} with default 5yr window', () => {
    expect(resolvePattern('{YEAR_RANGE}', ctx)).toBe('2020 - 2024');
  });

  it('resolves {CAMERA}', () => {
    expect(resolvePattern('{CAMERA}', ctx)).toBe('iPhone 15 Pro');
  });

  it('defaults {CAMERA} to Unknown Camera when null', () => {
    expect(resolvePattern('{CAMERA}', { ...ctx, cameraModel: null })).toBe('Unknown Camera');
  });

  it('resolves {TYPE}', () => {
    expect(resolvePattern('{TYPE}', ctx)).toBe('images');
  });

  it('resolves {TYPE_LABEL}', () => {
    expect(resolvePattern('{TYPE_LABEL}', ctx)).toBe('Photos');
    expect(resolvePattern('{TYPE_LABEL}', { ...ctx, category: 'videos' })).toBe('Videos');
    expect(resolvePattern('{TYPE_LABEL}', { ...ctx, category: 'raw' })).toBe('RAW');
  });

  it('resolves {EXT} as lowercase', () => {
    expect(resolvePattern('{EXT}', ctx)).toBe('jpg');
    expect(resolvePattern('{EXT}', { ...ctx, format: '.JPG' })).toBe('jpg');
  });

  it('resolves compound pattern', () => {
    expect(resolvePattern('{YYYY}/{MMM}', ctx)).toBe('2024/March');
  });

  it('replaces all tokens with Unknown when date is null', () => {
    const result = resolvePattern('{YYYY}/{MMM}', { date: null });
    expect(result).toBe('Unknown/Unknown');
  });

  it('sanitizes camera path characters', () => {
    const result = resolvePattern('{CAMERA}', { ...ctx, cameraModel: 'Brand/Model:X' });
    expect(result).not.toContain('/');
    expect(result).not.toContain(':');
  });
});

describe('pattern — DataHoarder TYPE_LABEL bindings', () => {
  const ctx = (cat: string) => ({
    date: new Date('2024-03-15T12:00:00Z'),
    category: cat as never,
  });

  it('resolves {TYPE_LABEL} for documents', () => {
    expect(resolvePattern('{TYPE_LABEL}/{YYYY}', ctx('documents'))).toBe('Documents/2024');
  });

  it('resolves {TYPE_LABEL} for audio (Music)', () => {
    expect(resolvePattern('{TYPE_LABEL}/{YYYY}', ctx('audio'))).toBe('Music/2024');
  });

  it('resolves {TYPE_LABEL} for design', () => {
    expect(resolvePattern('{TYPE_LABEL}/{YYYY}', ctx('design'))).toBe('Design/2024');
  });

  it('resolves {TYPE_LABEL} for 3d', () => {
    expect(resolvePattern('{TYPE_LABEL}/{YYYY}', ctx('3d'))).toBe('3D/2024');
  });

  it('still resolves the existing photos / videos / raw labels', () => {
    expect(resolvePattern('{TYPE_LABEL}', ctx('images'))).toBe('Photos');
    expect(resolvePattern('{TYPE_LABEL}', ctx('videos'))).toBe('Videos');
    expect(resolvePattern('{TYPE_LABEL}', ctx('raw'))).toBe('RAW');
  });

  it('quarter / half-year tokens still resolve in DataHoarder patterns', () => {
    // Hard requirement from the user: existing date tokens must keep working
    // in DataHoarder mode. These aren't photo-only.
    expect(resolvePattern('{TYPE_LABEL}/{YYYY}/{QUARTER}', ctx('documents')))
      .toBe('Documents/2024/Jan - Mar 2024');
    expect(resolvePattern('{TYPE_LABEL}/{YYYY}/{HALF}', ctx('documents')))
      .toBe('Documents/2024/Jan - Jun 2024');
    expect(resolvePattern('{YEAR_RANGE}/{TYPE_LABEL}', ctx('audio')))
      .toBe('2020 - 2024/Music');
  });
});
