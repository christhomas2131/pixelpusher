// Profile / mode-of-operation for the app.
//
//   photos      — the original PixelPusher product. Images, RAW, video.
//                 Date-driven organization. Free tier.
//   datahoarder — documents, audio, design files, 3D, etc. — the rest of
//                 your digital life. Type-driven organization. Pro feature.
//
// Both modes share the same scan/organize/dupe/migration plumbing; only the
// mode-specific defaults below differ. New tokens (e.g. {DOCTYPE}, {AUTHOR})
// added in later milestones layer in here without breaking existing patterns.
//
// IMPORTANT: every existing date-based pattern token ({YYYY}, {QUARTER},
// {HALF}, {YEAR_RANGE}, {MMM}, {DD}, etc.) works in *both* modes. DataHoarder
// just binds them to a doc's modified-date / embedded-created-date instead
// of a photo's EXIF date.

import type { FileCategory } from './types';

export type Mode = 'photos' | 'datahoarder';

export const ALL_MODES: Mode[] = ['photos', 'datahoarder'];

export function isMode(value: unknown): value is Mode {
  return value === 'photos' || value === 'datahoarder';
}

export function defaultCategoriesForMode(mode: Mode): FileCategory[] {
  return mode === 'photos'
    ? ['images', 'videos']
    : ['documents', 'audio', 'design', '3d'];
}

export function defaultPatternForMode(mode: Mode): string {
  return mode === 'photos'
    ? '{YYYY}/{MMM}'
    : '{TYPE_LABEL}/{YYYY}';
}

export function modeLabel(mode: Mode): string {
  return mode === 'photos' ? 'PixelPusher' : 'DataHoarder';
}

export function modeDescription(mode: Mode): string {
  return mode === 'photos'
    ? 'Photos, videos, and RAW.'
    : 'Documents, audio, design files, and 3D — the rest of your digital life.';
}
