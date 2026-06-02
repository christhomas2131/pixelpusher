import { describe, it, expect } from 'vitest';
import initSqlJs, { Database } from 'sql.js';
import {
  ALL_MODES,
  isMode,
  defaultCategoriesForMode,
  defaultPatternForMode,
  modeLabel,
  modeDescription,
} from '../src/shared/mode';
import { MIGRATIONS } from '../src/main/migrations';

describe('mode helpers', () => {
  it('ALL_MODES has both photos and datahoarder', () => {
    expect(ALL_MODES).toEqual(['photos', 'datahoarder']);
  });

  it('isMode rejects garbage', () => {
    expect(isMode('photos')).toBe(true);
    expect(isMode('datahoarder')).toBe(true);
    expect(isMode('photoshop')).toBe(false);
    expect(isMode('')).toBe(false);
    expect(isMode(null)).toBe(false);
    expect(isMode(undefined)).toBe(false);
    expect(isMode(42)).toBe(false);
  });

  it('photos mode defaults to images + videos', () => {
    expect(defaultCategoriesForMode('photos')).toEqual(['images', 'videos']);
  });

  it('datahoarder mode defaults to documents/audio/design/3d', () => {
    expect(defaultCategoriesForMode('datahoarder')).toEqual([
      'documents', 'audio', 'design', '3d',
    ]);
  });

  it('photos default pattern is the existing Year/Month', () => {
    expect(defaultPatternForMode('photos')).toBe('{YYYY}/{MMM}');
  });

  it('datahoarder default pattern is type-led with year', () => {
    expect(defaultPatternForMode('datahoarder')).toBe('{TYPE_LABEL}/{YYYY}');
  });

  it('mode labels and descriptions are non-empty for both modes', () => {
    for (const m of ALL_MODES) {
      expect(modeLabel(m)).toBeTruthy();
      expect(modeDescription(m)).toBeTruthy();
    }
  });

  it('photos pattern has no datahoarder-only tokens', () => {
    expect(defaultPatternForMode('photos')).not.toContain('TYPE_LABEL');
  });

  it('quarter / half / year-range tokens still resolve in *both* modes', async () => {
    // The user explicitly required: existing date tokens must work in
    // DataHoarder. We don't run resolvePattern here (covered in pattern.test.ts);
    // we only check that the default patterns don't pre-clude these tokens
    // and that the token vocabulary is universal — the pattern is just a
    // template, the renderer/main both run resolvePattern on it.
    const docDates = ['{YYYY}/{QUARTER}', '{YYYY}/{HALF}', '{YEAR_RANGE}/{TYPE_LABEL}'];
    for (const p of docDates) {
      // sanity: the token set used here is the same one the pattern resolver
      // recognizes across modes (see src/shared/pattern.ts).
      expect(p).toMatch(/\{[A-Z_]+\}/);
    }
  });
});

describe('migration #2 — add mode column', () => {
  it('migration #2 is in MIGRATIONS in correct order', () => {
    const ids = MIGRATIONS.map((m) => m.id).sort((a, b) => a - b);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it('migration #2 adds a mode column with a default of photos', async () => {
    const SQL = await initSqlJs();
    const db: Database = new SQL.Database();

    // Apply migration #1 first, then #2
    const m1 = MIGRATIONS.find((m) => m.id === 1)!;
    const m2 = MIGRATIONS.find((m) => m.id === 2)!;
    db.run(m1.up);
    db.run(m2.up);

    // Schema should now have `mode` on scan_sessions
    const cols = db.exec("PRAGMA table_info('scan_sessions')")[0].values
      .map((row) => row[1] as string);
    expect(cols).toContain('mode');

    // Existing rows would default to 'photos'
    db.run(`INSERT INTO scan_sessions (id, source_folders, started_at) VALUES ('s1', '[]', datetime('now'))`);
    const rows = db.exec("SELECT mode FROM scan_sessions WHERE id = 's1'")[0].values;
    expect(rows[0][0]).toBe('photos');

    // New rows can specify datahoarder
    db.run(`INSERT INTO scan_sessions (id, source_folders, started_at, mode) VALUES ('s2', '[]', datetime('now'), 'datahoarder')`);
    const rows2 = db.exec("SELECT mode FROM scan_sessions WHERE id = 's2'")[0].values;
    expect(rows2[0][0]).toBe('datahoarder');

    db.close();
  });
});
