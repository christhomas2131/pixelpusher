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
    // Attempt to back up the corrupt file and start fresh. We log loudly
    // (logger + console + a sentinel file) so the user can find the backup
    // — auto-recovery without a breadcrumb made data loss easy to miss.
    if (fs.existsSync(dbPath)) {
      const corruptPath = dbPath + `.corrupt.${Date.now()}`;
      try { fs.renameSync(dbPath, corruptPath); } catch {}
      const msg = `Corrupt DB detected at ${dbPath}. Backed up to ${corruptPath}. A fresh database has been created — your original files are NOT affected, but scan history is lost.`;
      console.error(`[database] ${msg}`);
      try {
        logger.error('database', msg, String(err?.message ?? err));
        // Drop a marker the next startup can surface to the user.
        fs.writeFileSync(
          path.join(DB_DIR, 'last-corruption.txt'),
          `${new Date().toISOString()}\n${msg}\n`,
          'utf8',
        );
      } catch { /* best-effort */ }
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

// Hard cap on page-number to keep OFFSET cheap. The indexes added in
// migration 1 (idx_files_session_status, idx_files_session_id,
// idx_files_date) make OFFSET fast up to a few thousand rows, but jumping
// to page 10,000 would scan-and-discard millions of index entries.
// CLAUDE.md: "Never use OFFSET pagination on large tables (use keyset)."
// The renderer never exposes a "jump to page" UI — only prev/next — so
// realistic page numbers stay under 100. We cap an order of magnitude
// higher than that and throw on overshoot so a buggy renderer can't tank
// the main process.
const MAX_PAGE = 1000;

// Escape a user-supplied search term for use in `LIKE … ESCAPE '\'`. Without
// this, '_' acts as a single-char wildcard and '%' as a multi-char wildcard,
// which over-matches when a user pastes a path containing those chars.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, ch => '\\' + ch);
}

export function getFilesPaginated(request: GetFilesPageRequest): GetFilesPageResponse {
  const db = getDb();
  const { sessionId, page, pageSize, sortBy, sortDir, filters } = request;
  const safeSortCol = ALLOWED_SORT_COLS.has(sortBy) ? sortBy : 'created_at';
  const safeSortDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  if (page > MAX_PAGE) {
    throw new Error(`Page ${page} exceeds MAX_PAGE=${MAX_PAGE}. Use filters to narrow the result set.`);
  }

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
    conditions.push("(filename LIKE @search ESCAPE '\\' OR source_path LIKE @search ESCAPE '\\')");
    params.search = `%${escapeLike(filters.search)}%`;
  }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  const totalCount = (db.prepare(`SELECT COUNT(*) as n FROM files WHERE ${where}`).get(params) as { n: number }).n;
  // Stable secondary sort by id keeps page boundaries deterministic when the
  // primary sort column has ties (e.g. many files at the same date_taken).
  const files = db.prepare(`
    SELECT * FROM files WHERE ${where}
    ORDER BY ${safeSortCol} ${safeSortDir}, id ASC
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

// Cap members fetched per group. Visually reviewing 50 dupes side-by-side is
// already absurd; one group with 5000 members would otherwise balloon the IPC
// response and stall the renderer.
const MAX_MEMBERS_PER_GROUP = 50;

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
  // ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY rank) keeps the top-N
  // members per group at SQL level — bounded response size regardless of
  // how many files clustered together.
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT g.id as group_id, g.scan_session_id, g.member_count, g.status,
             m.file_id, m.is_keeper, m.rank,
             f.filename, f.source_path, f.size, f.date_taken, f.camera_model,
             f.width, f.height, f.format, f.file_category, f.date_source,
             f.scan_session_id as file_session_id, f.source_label, f.source_index,
             ROW_NUMBER() OVER (PARTITION BY g.id ORDER BY m.rank) AS rn
      FROM dupe_groups g
      JOIN dupe_group_members m ON m.group_id = g.id
      JOIN files f ON f.id = m.file_id
      WHERE g.id IN (${placeholders})
    )
    WHERE rn <= ${MAX_MEMBERS_PER_GROUP}
    ORDER BY group_id, rank
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

    // Mark non-keepers according to action. Encode the *destiny* in
    // junk_reason so a later debug session can tell the difference between
    // a file that was deleted from disk vs one that was moved to quarantine
    // (source_path is stale either way, but they're different operations).
    if (action !== 'ignore') {
      const reason = action === 'quarantine' ? 'duplicate_quarantined' : 'duplicate_deleted';
      db.prepare(
        "UPDATE files SET status = 'junk', junk_reason = ?, junk_confidence = 'high' WHERE id IN (SELECT file_id FROM dupe_group_members WHERE group_id = ? AND file_id != ?)"
      ).run(reason, groupId, keeperId);
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
  // Initialize every FileCategory key to 0 so DataHoarder categories
  // (documents/audio/design/3d) don't return `undefined` and break
  // arithmetic in the renderer (e.g. `counts.byCategory.documents + 1` → NaN).
  const byCategory: Record<string, number> = {
    images: 0, videos: 0, raw: 0,
    documents: 0, audio: 0, design: 0, '3d': 0,
  };
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

