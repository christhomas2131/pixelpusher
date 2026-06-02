import { describe, it, expect } from 'vitest';
import initSqlJs, { Database } from 'sql.js';
import { planMigrations, MIGRATIONS, type Migration } from '../src/main/migrations';

describe('planMigrations', () => {
  const m1: Migration = { id: 1, name: 'one', up: 'SELECT 1' };
  const m2: Migration = { id: 2, name: 'two', up: 'SELECT 1' };
  const m3: Migration = { id: 3, name: 'three', up: 'SELECT 1' };

  it('returns all migrations on a fresh DB (version 0)', () => {
    const pending = planMigrations(0, [m1, m2, m3]);
    expect(pending.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('returns nothing when DB is at the latest version', () => {
    expect(planMigrations(3, [m1, m2, m3])).toEqual([]);
  });

  it('skips already-applied migrations', () => {
    const pending = planMigrations(2, [m1, m2, m3]);
    expect(pending.map((m) => m.id)).toEqual([3]);
  });

  it('sorts migrations by id even when registered out of order', () => {
    const pending = planMigrations(0, [m3, m1, m2]);
    expect(pending.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('throws on gap in pending sequence', () => {
    // current=0 expects 1,2,3... but only 1 and 3 are present
    expect(() => planMigrations(0, [m1, m3])).toThrow(/Migration gap/);
  });

  it('throws if first pending migration is not currentVersion + 1', () => {
    // current=1, [m1,m3] → m1 already applied, m3 is the only pending, but expected next is 2
    expect(() => planMigrations(1, [m1, m3])).toThrow(/expected next id=2 but found 3/);
  });

  it('the bundled MIGRATIONS list is gap-free from a fresh DB', () => {
    expect(() => planMigrations(0, MIGRATIONS)).not.toThrow();
  });
});

describe('Migration 1 SQL (run against sql.js)', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;
  let db: Database;

  it('creates all expected tables and indexes', async () => {
    if (!SQL) SQL = await initSqlJs();
    db = new SQL.Database();
    db.run(MIGRATIONS[0].up);

    const tableRows = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )[0].values.map((row) => row[0] as string);
    expect(tableRows).toEqual(
      expect.arrayContaining([
        'scan_sessions',
        'files',
        'dupe_groups',
        'dupe_group_members',
        'operation_progress',
      ])
    );

    const indexRows = db.exec(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    )[0].values.map((row) => row[0] as string);
    expect(indexRows).toEqual(
      expect.arrayContaining([
        'idx_files_session',
        'idx_files_session_status',
        'idx_files_session_id',
        'idx_files_phash',
        'idx_files_date',
        'idx_dupe_groups_session',
        'idx_dupe_members_group',
        'idx_dupe_members_file',
      ])
    );

    db.close();
  });

  it('is idempotent (re-running on an already-migrated DB does not throw)', async () => {
    if (!SQL) SQL = await initSqlJs();
    db = new SQL.Database();
    db.run(MIGRATIONS[0].up);
    expect(() => db.run(MIGRATIONS[0].up)).not.toThrow();
    db.close();
  });
});
