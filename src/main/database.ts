import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { FileRecord, FileCounts, GetFilesPageRequest, GetFilesPageResponse, DupeGroup, DupeGroupMember, DupeAction } from '../shared/types';
import { runMigrations } from './migrations';
import { logger } from './logger';

const DB_DIR = path.join(os.homedir(), '.photomove');
const DB_PATH = path.join(DB_DIR, 'library.db');

const ALLOWED_SORT_COLS = new Set([
  'filename', 'size', 'date_taken', 'status', 'file_category',
  'camera_model', 'source_path', 'created_at',
]);

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = openDb(DB_PATH);
  }
  return db;
}

function applyPragmas(instance: Database.Database): void {
  instance.pragma('journal_mode = WAL');
  instance.pragma('synchronous = NORMAL');
  instance.pragma('cache_size = -64000');
  instance.pragma('foreign_keys = ON');
  instance.pragma('busy_timeout = 10000');
}

function openDb(dbPath: string): Database.Database {
  let instance: Database.Database;
  try {
    instance = new Database(dbPath);
    applyPragmas(instance);

    // Health check: detect corruption before applying migrations
    const check = instance.pragma('quick_check', { simple: true }) as string;
    if (check !== 'ok') {
      instance.close();
      throw new Error(`quick_check: ${check}`);
    }

    runMigrations(instance, undefined, logger);
    return instance;
  } catch (err: any) {
    // Attempt to back up the corrupt file and start fresh
    if (fs.existsSync(dbPath)) {
      const corruptPath = dbPath + `.corrupt.${Date.now()}`;
      try { fs.renameSync(dbPath, corruptPath); } catch {}
      console.error(`[database] Corrupt DB backed up to ${corruptPath}, creating fresh.`);
    }
    const fresh = new Database(dbPath);
    applyPragmas(fresh);
    runMigrations(fresh, undefined, logger);
    return fresh;
  }
}

export function checkpointDb(): void {
  try { db?.pragma('wal_checkpoint(PASSIVE)'); } catch {}
}

export function closeDb(): void {
  try { db?.pragma('wal_checkpoint(TRUNCATE)'); db?.close(); } catch {}
  db = null;
}


export function insertScanSession(session: {
  id: string;
  sourceFolders: string[];
  scanDepth: string;
  scanSpeed: string;
  mode: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO scan_sessions (id, source_folders, started_at, scan_depth, scan_speed, status, mode)
    VALUES (?, ?, datetime('now'), ?, ?, 'running', ?)
  `).run(session.id, JSON.stringify(session.sourceFolders), session.scanDepth, session.scanSpeed, session.mode);
}

export function completeScanSession(id: string, totalFiles: number, totalSize: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE scan_sessions
    SET completed_at = datetime('now'), total_files = ?, total_size = ?, status = 'complete'
    WHERE id = ?
  `).run(totalFiles, totalSize, id);
}

export function insertFilesBatch(files: Omit<FileRecord, 'created_at'>[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO files (
      id, filename, source_path, proposed_destination, size,
      date_source, date_taken, camera_make, camera_model,
      gps_lat, gps_lng, width, height, format, status,
      junk_reason, junk_confidence, phash, file_category,
      extended_meta, metadata_depth, error_message,
      source_index, source_label, scan_session_id
    ) VALUES (
      @id, @filename, @source_path, @proposed_destination, @size,
      @date_source, @date_taken, @camera_make, @camera_model,
      @gps_lat, @gps_lng, @width, @height, @format, @status,
      @junk_reason, @junk_confidence, @phash, @file_category,
      @extended_meta, @metadata_depth, @error_message,
      @source_index, @source_label, @scan_session_id
    )
  `);
  const insertMany = db.transaction((rows: Omit<FileRecord, 'created_at'>[]) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(files);
}

export function getFilesPaginated(request: GetFilesPageRequest): GetFilesPageResponse {
  const db = getDb();
  const { sessionId, page, pageSize, sortBy, sortDir, filters } = request;
  const safeSortCol = ALLOWED_SORT_COLS.has(sortBy) ? sortBy : 'created_at';
  const safeSortDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  const conditions: string[] = ['scan_session_id = @sessionId'];
  const params: Record<string, unknown> = { sessionId };

  if (filters?.status) {
    conditions.push('status = @status');
    params.status = filters.status;
  }
  if (filters?.category) {
    conditions.push('file_category = @category');
    params.category = filters.category;
  }
  if (filters?.search) {
    conditions.push('(filename LIKE @search OR source_path LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  const totalCount = (db.prepare(`SELECT COUNT(*) as n FROM files WHERE ${where}`).get(params) as { n: number }).n;
  const files = db.prepare(`
    SELECT * FROM files WHERE ${where}
    ORDER BY ${safeSortCol} ${safeSortDir}
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: pageSize, offset }) as FileRecord[];

  return {
    files,
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

export function getHashableFiles(sessionId: string, lastId: string, limit: number): FileRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM files
    WHERE scan_session_id = ? AND phash IS NULL AND status = 'ready'
      AND file_category IN ('images','raw') AND id > ?
    ORDER BY id LIMIT ?
  `).all(sessionId, lastId, limit) as FileRecord[];
}

export function getHashableCount(sessionId: string): number {
  const db = getDb();
  return (db.prepare(
    "SELECT COUNT(*) as n FROM files WHERE scan_session_id = ? AND phash IS NULL AND status = 'ready' AND file_category IN ('images','raw')"
  ).get(sessionId) as { n: number }).n;
}

export function updateFileHashBatch(updates: { id: string; phash: string | null }[]): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE files SET phash = @phash WHERE id = @id');
  const run = db.transaction((rows: { id: string; phash: string | null }[]) => {
    for (const row of rows) stmt.run(row);
  });
  run(updates);
}

// ── Byte-hash variants (DataHoarder) ─────────────────────────────────────────
// Mirror of the phash flow above for non-photo categories. Keeps the queries
// surface-level identical so ipc-handlers.ts can dispatch on mode without
// branching on schema specifics.

export function getByteHashableFiles(sessionId: string, lastId: string, limit: number): FileRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM files
    WHERE scan_session_id = ? AND byte_hash IS NULL AND status = 'ready'
      AND file_category IN ('documents','audio','design','3d') AND id > ?
    ORDER BY id LIMIT ?
  `).all(sessionId, lastId, limit) as FileRecord[];
}

export function getByteHashableCount(sessionId: string): number {
  const db = getDb();
  return (db.prepare(
    "SELECT COUNT(*) as n FROM files WHERE scan_session_id = ? AND byte_hash IS NULL AND status = 'ready' AND file_category IN ('documents','audio','design','3d')"
  ).get(sessionId) as { n: number }).n;
}

export function updateFileByteHashBatch(updates: { id: string; byte_hash: string | null }[]): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE files SET byte_hash = @byte_hash WHERE id = @id');
  const run = db.transaction((rows: { id: string; byte_hash: string | null }[]) => {
    for (const row of rows) stmt.run(row);
  });
  run(updates);
}

export function getScanSessionMode(sessionId: string): string {
  const db = getDb();
  const row = db.prepare('SELECT mode FROM scan_sessions WHERE id = ?').get(sessionId) as { mode: string } | undefined;
  return row?.mode ?? 'photos';
}

export function getDupeGroupCount(sessionId: string): number {
  const db = getDb();
  return (db.prepare(
    "SELECT COUNT(*) as n FROM dupe_groups WHERE scan_session_id = ? AND status = 'pending'"
  ).get(sessionId) as { n: number }).n;
}

export interface DupeGroupRow {
  id: string;
  scan_session_id: string;
  member_count: number;
  status: string;
  file_id: string;
  is_keeper: number;
  rank: number;
}

export function getDupeGroupsPaginated(
  sessionId: string,
  page: number,
  pageSize: number
): { groups: DupeGroup[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  const total = (db.prepare(
    "SELECT COUNT(*) as n FROM dupe_groups WHERE scan_session_id = ? AND status = 'pending'"
  ).get(sessionId) as { n: number }).n;

  const groupIds = (db.prepare(
    "SELECT id FROM dupe_groups WHERE scan_session_id = ? AND status = 'pending' ORDER BY created_at LIMIT ? OFFSET ?"
  ).all(sessionId, pageSize, offset) as { id: string }[]).map(r => r.id);

  if (groupIds.length === 0) return { groups: [], total };

  const placeholders = groupIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT g.id as group_id, g.scan_session_id, g.member_count, g.status,
           m.file_id, m.is_keeper, m.rank,
           f.filename, f.source_path, f.size, f.date_taken, f.camera_model,
           f.width, f.height, f.format, f.file_category, f.date_source,
           f.scan_session_id as file_session_id, f.source_label, f.source_index
    FROM dupe_groups g
    JOIN dupe_group_members m ON m.group_id = g.id
    JOIN files f ON f.id = m.file_id
    WHERE g.id IN (${placeholders})
    ORDER BY g.id, m.rank
  `).all(...groupIds) as any[];

  // Reassemble into DupeGroup[]
  const groupMap = new Map<string, import('../shared/types').DupeGroup>();
  for (const row of rows) {
    if (!groupMap.has(row.group_id)) {
      groupMap.set(row.group_id, {
        id: row.group_id,
        scan_session_id: row.scan_session_id,
        member_count: row.member_count,
        status: row.status,
        members: [],
      });
    }
    groupMap.get(row.group_id)!.members.push({
      group_id: row.group_id,
      file_id:  row.file_id,
      is_keeper: row.is_keeper,
      rank:     row.rank,
      file: {
        id:              row.file_id,
        filename:        row.filename,
        source_path:     row.source_path,
        proposed_destination: null,
        size:            row.size,
        date_taken:      row.date_taken,
        date_source:     row.date_source,
        camera_make:     null,
        camera_model:    row.camera_model,
        gps_lat:         null,
        gps_lng:         null,
        width:           row.width,
        height:          row.height,
        format:          row.format,
        status:          'ready' as const,
        junk_reason:     null,
        junk_confidence: null,
        phash:           null,
        file_category:   row.file_category,
        extended_meta:   null,
        metadata_depth:  'quick' as const,
        error_message:   null,
        source_index:    row.source_index,
        source_label:    row.source_label,
        scan_session_id: row.file_session_id,
        created_at:      '',
      },
    });
  }

  return {
    groups: groupIds.map(id => groupMap.get(id)!).filter(Boolean),
    total,
  };
}

export function resolveDupeGroup(
  groupId: string,
  keeperId: string,
  action: DupeAction
): void {
  const db = getDb();
  db.transaction(() => {
    // Update keeper flag
    db.prepare('UPDATE dupe_group_members SET is_keeper = CASE WHEN file_id = ? THEN 1 ELSE 0 END WHERE group_id = ?')
      .run(keeperId, groupId);

    // Mark non-keepers according to action
    if (action !== 'ignore') {
      db.prepare(
        "UPDATE files SET status = 'junk', junk_reason = 'duplicate', junk_confidence = 'high' WHERE id IN (SELECT file_id FROM dupe_group_members WHERE group_id = ? AND file_id != ?)"
      ).run(groupId, keeperId);
    }

    // Resolve group
    db.prepare("UPDATE dupe_groups SET status = 'resolved' WHERE id = ?").run(groupId);
  })();
}

export function autoResolveDupeGroups(
  sessionId: string,
  action: DupeAction
): number {
  const db = getDb();
  const groups = db.prepare(
    "SELECT id FROM dupe_groups WHERE scan_session_id = ? AND status = 'pending'"
  ).all(sessionId) as { id: string }[];

  let resolved = 0;
  db.transaction(() => {
    for (const { id: groupId } of groups) {
      const keeper = db.prepare(
        'SELECT file_id FROM dupe_group_members WHERE group_id = ? ORDER BY rank LIMIT 1'
      ).get(groupId) as { file_id: string } | undefined;
      if (!keeper) continue;
      resolveDupeGroup(groupId, keeper.file_id, action);
      resolved++;
    }
  })();
  return resolved;
}

export function getFileCounts(sessionId: string): FileCounts {
  const db = getDb();
  const total    = (db.prepare('SELECT COUNT(*) as n FROM files WHERE scan_session_id = ?').get(sessionId) as { n: number }).n;
  const ready    = (db.prepare("SELECT COUNT(*) as n FROM files WHERE scan_session_id = ? AND status = 'ready'").get(sessionId) as { n: number }).n;
  const withDate = (db.prepare("SELECT COUNT(*) as n FROM files WHERE scan_session_id = ? AND date_taken IS NOT NULL AND date_taken != ''").get(sessionId) as { n: number }).n;
  const junk     = (db.prepare("SELECT COUNT(*) as n FROM files WHERE scan_session_id = ? AND status = 'junk'").get(sessionId) as { n: number }).n;

  const catRows = db.prepare('SELECT file_category, COUNT(*) as n FROM files WHERE scan_session_id = ? GROUP BY file_category').all(sessionId) as { file_category: string; n: number }[];
  const byCategory = { images: 0, videos: 0, raw: 0 } as Record<string, number>;
  for (const row of catRows) byCategory[row.file_category] = row.n;

  const dupes = getDupeGroupCount(sessionId);
  const totalSize = (db.prepare('SELECT COALESCE(SUM(size), 0) as n FROM files WHERE scan_session_id = ?').get(sessionId) as { n: number }).n;

  return {
    total,
    ready,
    withDate,
    unknownDate: total - withDate,
    junk,
    dupes,
    totalSize,
    byCategory: byCategory as FileCounts['byCategory'],
  };
}

export function getOrganizeTotals(sessionId: string): { count: number; totalSize: number } {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM files WHERE scan_session_id = ? AND status = 'ready'"
  ).get(sessionId) as { count: number; totalSize: number };
  return row;
}

export function getPendingCount(sessionId: string): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as n FROM files WHERE scan_session_id = ? AND status = 'pending'").get(sessionId) as { n: number }).n;
}

export function getUnprocessedFiles(sessionId: string, lastId: string, limit: number): FileRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM files
    WHERE scan_session_id = ? AND status = 'pending' AND id > ?
    ORDER BY id LIMIT ?
  `).all(sessionId, lastId, limit) as FileRecord[];
}

export function updateFileExif(id: string, data: Partial<FileRecord>): void {
  const db = getDb();
  const fields = Object.keys(data).filter(k => k !== 'id');
  if (fields.length === 0) return;
  const sets = fields.map(f => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE files SET ${sets} WHERE id = @id`).run({ ...data, id });
}

export interface ExifUpdateRow {
  id: string;
  date_taken: string | null;
  date_source: string | null;
  camera_make: string | null;
  camera_model: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  width: number | null;
  height: number | null;
  extended_meta: string | null;
  metadata_depth: string;
  status: string;
  error_message: string | null;
  junk_reason: string | null;
  junk_confidence: string | null;
}

export function updateFilesExifBatch(updates: ExifUpdateRow[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE files SET
      date_taken      = @date_taken,
      date_source     = @date_source,
      camera_make     = @camera_make,
      camera_model    = @camera_model,
      gps_lat         = @gps_lat,
      gps_lng         = @gps_lng,
      width           = @width,
      height          = @height,
      extended_meta   = @extended_meta,
      metadata_depth  = @metadata_depth,
      status          = @status,
      error_message   = @error_message,
      junk_reason     = @junk_reason,
      junk_confidence = @junk_confidence
    WHERE id = @id
  `);
  const runAll = db.transaction((rows: ExifUpdateRow[]) => {
    for (const row of rows) stmt.run(row);
  });
  runAll(updates);
}

export function getFilesForOrganize(sessionId: string, lastId: string | null, limit: number): FileRecord[] {
  const db = getDb();
  if (lastId) {
    return db.prepare(`
      SELECT * FROM files
      WHERE scan_session_id = ? AND id > ? AND status = 'ready'
      ORDER BY id LIMIT ?
    `).all(sessionId, lastId, limit) as FileRecord[];
  }
  return db.prepare(`
    SELECT * FROM files
    WHERE scan_session_id = ? AND status = 'ready'
    ORDER BY id LIMIT ?
  `).all(sessionId, limit) as FileRecord[];
}

