import type Database from 'better-sqlite3';

export interface Migration {
  id: number;
  name: string;
  up: string;
}

// Migrations run in order. Each migration's `id` becomes the new user_version.
// Never edit a migration after it ships — append a new one to the end instead.
// (planMigrations sorts by id, but keeping the array in chronological order
// keeps diffs sane when adding new entries.)
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS scan_sessions (
        id TEXT PRIMARY KEY,
        source_folders TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        total_files INTEGER DEFAULT 0,
        total_size INTEGER DEFAULT 0,
        scan_depth TEXT DEFAULT 'quick',
        scan_speed TEXT DEFAULT 'safe',
        status TEXT DEFAULT 'running'
      );

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        source_path TEXT NOT NULL,
        proposed_destination TEXT,
        size INTEGER NOT NULL,
        date_source TEXT,
        date_taken TEXT,
        camera_make TEXT,
        camera_model TEXT,
        gps_lat REAL,
        gps_lng REAL,
        width INTEGER,
        height INTEGER,
        format TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        junk_reason TEXT,
        junk_confidence TEXT,
        phash TEXT,
        file_category TEXT DEFAULT 'images',
        extended_meta TEXT,
        metadata_depth TEXT DEFAULT 'quick',
        error_message TEXT,
        source_index INTEGER DEFAULT 0,
        source_label TEXT DEFAULT 'Source A',
        scan_session_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_files_session ON files(scan_session_id);
      CREATE INDEX IF NOT EXISTS idx_files_session_status ON files(scan_session_id, status);
      CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(scan_session_id, id);
      CREATE INDEX IF NOT EXISTS idx_files_phash ON files(phash) WHERE phash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_files_date ON files(scan_session_id, date_taken);

      CREATE TABLE IF NOT EXISTS dupe_groups (
        id TEXT PRIMARY KEY,
        scan_session_id TEXT NOT NULL,
        member_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_dupe_groups_session ON dupe_groups(scan_session_id);

      CREATE TABLE IF NOT EXISTS dupe_group_members (
        group_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        is_keeper INTEGER NOT NULL DEFAULT 0,
        rank INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, file_id)
      );

      CREATE INDEX IF NOT EXISTS idx_dupe_members_group ON dupe_group_members(group_id);
      CREATE INDEX IF NOT EXISTS idx_dupe_members_file  ON dupe_group_members(file_id);

      CREATE TABLE IF NOT EXISTS operation_progress (
        session_id TEXT PRIMARY KEY,
        total_files INTEGER,
        processed_files INTEGER DEFAULT 0,
        successful_files INTEGER DEFAULT 0,
        error_files INTEGER DEFAULT 0,
        skipped_files INTEGER DEFAULT 0,
        last_processed_id TEXT,
        status TEXT DEFAULT 'running',
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `,
  },
  {
    id: 2,
    name: 'add_mode_to_scan_sessions',
    up: `
      ALTER TABLE scan_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'photos';
    `,
  },
];

export interface MigrationLogger {
  info(category: string, message: string): void;
  error(category: string, message: string, extra?: string): void;
}

export function planMigrations(currentVersion: number, all: Migration[] = MIGRATIONS): Migration[] {
  const pending = all.filter((m) => m.id > currentVersion).sort((a, b) => a.id - b.id);
  for (let i = 0; i < pending.length; i++) {
    const expected = currentVersion + i + 1;
    if (pending[i].id !== expected) {
      throw new Error(
        `Migration gap: at user_version=${currentVersion}, expected next id=${expected} but found ${pending[i].id}`
      );
    }
  }
  return pending;
}

export function runMigrations(
  db: Database.Database,
  migrations: Migration[] = MIGRATIONS,
  log?: MigrationLogger
): { from: number; to: number; applied: number[] } {
  const before = db.pragma('user_version', { simple: true }) as number;
  const pending = planMigrations(before, migrations);

  if (pending.length === 0) {
    log?.info('db', `Schema up-to-date at v${before}`);
    return { from: before, to: before, applied: [] };
  }

  const applied: number[] = [];
  for (const m of pending) {
    const tx = db.transaction(() => {
      db.exec(m.up);
      db.pragma(`user_version = ${m.id}`);
    });
    try {
      tx();
      applied.push(m.id);
      log?.info('db', `Applied migration ${m.id}: ${m.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error('db', `Migration ${m.id} (${m.name}) failed`, msg);
      throw err;
    }
  }

  const after = db.pragma('user_version', { simple: true }) as number;
  return { from: before, to: after, applied };
}
