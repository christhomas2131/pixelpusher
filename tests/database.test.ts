import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import initSqlJs, { Database } from 'sql.js';
import crypto from 'crypto';
import { MIGRATIONS } from '../src/main/migrations';

// Tests use sql.js (pure JS SQLite) to verify query logic without native modules.
// Production code uses better-sqlite3 rebuilt for Electron at runtime.
// Schema is sourced from MIGRATIONS so the test fixture cannot drift from prod.

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

async function createTestDb(): Promise<Database> {
  if (!SQL) SQL = await initSqlJs();
  const db = new SQL.Database();
  for (const m of MIGRATIONS) db.run(m.up);
  return db;
}

function getInt(db: Database, sql: string, ...params: unknown[]): number {
  const stmt = db.prepare(sql);
  stmt.bind(params as unknown[]);
  stmt.step();
  const row = stmt.getAsObject() as { n?: number };
  stmt.free();
  return row.n ?? 0;
}

describe('Database SQL logic', () => {
  let db: Database;
  let sessionId: string;

  beforeEach(async () => {
    db = await createTestDb();
    sessionId = crypto.randomUUID();
    db.run(
      `INSERT INTO scan_sessions (id, source_folders, started_at) VALUES (?, ?, datetime('now'))`,
      [sessionId, JSON.stringify(['/test'])]
    );
  });

  afterEach(() => {
    db.close();
  });

  it('inserts multiple files', () => {
    for (let i = 0; i < 5; i++) {
      db.run(
        `INSERT INTO files (id, filename, source_path, size, format, status, scan_session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), `photo_${i}.jpg`, `/test/photo_${i}.jpg`, 1024 * (i + 1), '.jpg', 'pending', sessionId]
      );
    }
    const n = getInt(db, 'SELECT COUNT(*) as n FROM files WHERE scan_session_id = ?', sessionId);
    expect(n).toBe(5);
  });

  it('counts files by status', () => {
    for (const status of ['ready', 'junk', 'ready']) {
      db.run(
        `INSERT INTO files (id, filename, source_path, size, format, status, scan_session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), `${status}.jpg`, `/${status}.jpg`, 1000, '.jpg', status, sessionId]
      );
    }
    const total = getInt(db, 'SELECT COUNT(*) as n FROM files WHERE scan_session_id = ?', sessionId);
    const ready = getInt(db, "SELECT COUNT(*) as n FROM files WHERE scan_session_id = ? AND status = 'ready'", sessionId);
    const junk = getInt(db, "SELECT COUNT(*) as n FROM files WHERE scan_session_id = ? AND status = 'junk'", sessionId);
    expect(total).toBe(3);
    expect(ready).toBe(2);
    expect(junk).toBe(1);
  });

  it('paginates with LIMIT/OFFSET', () => {
    for (let i = 0; i < 10; i++) {
      db.run(
        `INSERT INTO files (id, filename, source_path, size, format, status, scan_session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), `file_${String(i).padStart(2, '0')}.jpg`, `/test/file_${i}.jpg`, 1000, '.jpg', 'pending', sessionId]
      );
    }
    const p1stmt = db.prepare('SELECT id FROM files WHERE scan_session_id = ? ORDER BY filename LIMIT 5 OFFSET 0');
    p1stmt.bind([sessionId]);
    const page1: string[] = [];
    while (p1stmt.step()) page1.push((p1stmt.getAsObject() as { id: string }).id);
    p1stmt.free();

    const p2stmt = db.prepare('SELECT id FROM files WHERE scan_session_id = ? ORDER BY filename LIMIT 5 OFFSET 5');
    p2stmt.bind([sessionId]);
    const page2: string[] = [];
    while (p2stmt.step()) page2.push((p2stmt.getAsObject() as { id: string }).id);
    p2stmt.free();

    expect(page1.length).toBe(5);
    expect(page2.length).toBe(5);
    expect(new Set([...page1, ...page2]).size).toBe(10);
  });

  it('updates file metadata', () => {
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO files (id, filename, source_path, size, format, status, scan_session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, 'test.jpg', '/test.jpg', 5000, '.jpg', 'pending', sessionId]
    );
    db.run(
      `UPDATE files SET date_taken = ?, camera_model = ?, metadata_depth = 'full' WHERE id = ?`,
      ['2024-03-15T10:00:00.000Z', 'iPhone 15', id]
    );
    const stmt = db.prepare('SELECT date_taken, camera_model, metadata_depth FROM files WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject() as { date_taken: string; camera_model: string; metadata_depth: string };
    stmt.free();
    expect(row.date_taken).toBe('2024-03-15T10:00:00.000Z');
    expect(row.camera_model).toBe('iPhone 15');
    expect(row.metadata_depth).toBe('full');
  });

  it('filters by category', () => {
    for (const [fmt, cat] of [['.jpg', 'images'], ['.mp4', 'videos'], ['.cr2', 'raw']]) {
      db.run(
        `INSERT INTO files (id, filename, source_path, size, format, status, file_category, scan_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), `file${fmt}`, `/test${fmt}`, 1000, fmt, 'pending', cat, sessionId]
      );
    }
    const imgs = getInt(db, "SELECT COUNT(*) as n FROM files WHERE scan_session_id = ? AND file_category = 'images'", sessionId);
    expect(imgs).toBe(1);
  });

  it('computes total size with SUM', () => {
    db.run(`INSERT INTO files (id, filename, source_path, size, format, status, scan_session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), 'a.jpg', '/a.jpg', 1000, '.jpg', 'pending', sessionId]);
    db.run(`INSERT INTO files (id, filename, source_path, size, format, status, scan_session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), 'b.jpg', '/b.jpg', 2500, '.jpg', 'pending', sessionId]);
    const stmt = db.prepare('SELECT SUM(size) as n FROM files WHERE scan_session_id = ?');
    stmt.bind([sessionId]);
    stmt.step();
    const row = stmt.getAsObject() as { n: number };
    stmt.free();
    expect(row.n).toBe(3500);
  });
});
