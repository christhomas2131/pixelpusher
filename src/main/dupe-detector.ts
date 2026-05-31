import crypto from 'crypto';
import { getDb } from './database';

// Lookup table: popcount for a 4-bit nibble (0–15)
const POPCOUNT4 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4] as const;

function hammingDistance(a: string, b: string): number {
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += POPCOUNT4[x];
  }
  return dist;
}

// Union-Find with path compression
class UnionFind {
  private readonly parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  union(x: string, y: string): void {
    const px = this.find(x), py = this.find(y);
    if (px !== py) this.parent.set(px, py);
  }
}

function rankScore(row: {
  width: number | null; height: number | null;
  size: number;
  date_taken: string | null;
  date_source: string | null;
}): number {
  const res    = (row.width ?? 0) * (row.height ?? 0);
  const hasExif = row.date_source === 'exif' ? 1 : 0;
  const hasDate = row.date_taken ? 1 : 0;
  return res * 1000 + row.size + hasExif * 100_000_000 + hasDate * 10_000_000;
}

interface HashRow {
  id: string;
  phash: string;
  width: number | null;
  height: number | null;
  size: number;
  date_taken: string | null;
  date_source: string | null;
}

// Returns the number of dupe groups inserted.
// thresholdBits: max hamming distance to consider a match (default 5 of 64 = ~92%)
export async function detectDuplicates(
  sessionId: string,
  thresholdBits = 5
): Promise<number> {
  const db = getDb();

  const rows = db.prepare(
    "SELECT id, phash, width, height, size, date_taken, date_source FROM files WHERE scan_session_id = ? AND phash IS NOT NULL AND status = 'ready'"
  ).all(sessionId) as HashRow[];

  if (rows.length < 2) return 0;

  const uf = new UnionFind();

  // O(N²) pairwise comparison — yield every 500 outer iterations
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (hammingDistance(rows[i].phash, rows[j].phash) <= thresholdBits) {
        uf.union(rows[i].id, rows[j].id);
      }
    }
    if (i > 0 && i % 500 === 0) {
      await new Promise<void>(r => setImmediate(r));
    }
  }

  // Build cluster map
  const clusters = new Map<string, string[]>();
  for (const row of rows) {
    const root = uf.find(row.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(row.id);
  }

  const insertGroup  = db.prepare(
    "INSERT INTO dupe_groups (id, scan_session_id, member_count, status) VALUES (?, ?, ?, 'pending')"
  );
  const insertMember = db.prepare(
    'INSERT INTO dupe_group_members (group_id, file_id, is_keeper, rank) VALUES (?, ?, ?, ?)'
  );
  const deleteOldMembers = db.prepare(
    'DELETE FROM dupe_group_members WHERE group_id IN (SELECT id FROM dupe_groups WHERE scan_session_id = ?)'
  );
  const deleteOldGroups = db.prepare('DELETE FROM dupe_groups WHERE scan_session_id = ?');

  const rowMap = new Map<string, HashRow>(rows.map(r => [r.id, r]));

  // Atomic clear-and-rebuild: previous version ran the DELETEs outside the
  // transaction, so a process crash between DELETE and INSERT would leave
  // the user with zero dupe groups despite a successful hash run.
  const groupCount = db.transaction(() => {
    deleteOldMembers.run(sessionId);
    deleteOldGroups.run(sessionId);

    let count = 0;
    for (const [, members] of clusters) {
      if (members.length < 2) continue;

      const groupId = crypto.randomUUID();
      insertGroup.run(groupId, sessionId, members.length);

      // Sort descending by rank (best keeper first)
      const sorted = [...members].sort((a, b) => {
        const ra = rowMap.get(a)!;
        const rb = rowMap.get(b)!;
        return rankScore(rb) - rankScore(ra);
      });

      sorted.forEach((id, idx) => {
        insertMember.run(groupId, id, idx === 0 ? 1 : 0, idx);
      });

      count++;
    }
    return count;
  })();

  return groupCount as number;
}

// Byte-exact dupe detection for DataHoarder mode. SHA-256 collisions are
// effectively impossible for real-world content, so we group by exact hash
// match — no thresholds, no union-find, no pairwise comparison. The work is
// "GROUP BY byte_hash HAVING COUNT(*) > 1".
//
// Keeper choice: prefer the file with the shortest source_path (less buried
// in nested folders), then alphabetical filename as tiebreaker. The user can
// always override in the dupe-review UI.
export interface ByteHashRow {
  id: string;
  source_path: string;
  filename: string;
  size: number;
  byte_hash?: string;
}

// Pure helper: takes already-fetched rows (with byte_hash), returns the
// groups that have ≥2 members, with each group sorted in keeper-first order.
// Exported for unit testing — `detectByteHashDuplicates` wraps it with the
// DB read+write side-effects.
export function groupByByteHash(rows: ByteHashRow[]): ByteHashRow[][] {
  const byHash = new Map<string, ByteHashRow[]>();
  for (const row of rows) {
    if (!row.byte_hash) continue;
    const list = byHash.get(row.byte_hash);
    if (list) list.push(row);
    else byHash.set(row.byte_hash, [row]);
  }
  const groups: ByteHashRow[][] = [];
  for (const list of byHash.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => {
      const da = a.source_path.split(/[/\\]/).length;
      const db = b.source_path.split(/[/\\]/).length;
      if (da !== db) return da - db;
      return a.filename.localeCompare(b.filename);
    });
    groups.push(list);
  }
  return groups;
}

export async function detectByteHashDuplicates(sessionId: string): Promise<number> {
  const db = getDb();

  // SQL pre-filter: only fetch rows whose byte_hash actually has duplicates.
  // Previous version pulled every hashed file into memory (~20 MB for 100K
  // DataHoarder files) and grouped in JS. With this query, an attic with
  // 100K unique-hash files yields zero rows — bounded memory regardless of
  // library size.
  const rows = db.prepare(
    `SELECT id, source_path, filename, size, byte_hash FROM files
     WHERE scan_session_id = ?
       AND byte_hash IS NOT NULL
       AND status = 'ready'
       AND byte_hash IN (
         SELECT byte_hash FROM files
         WHERE scan_session_id = ? AND byte_hash IS NOT NULL AND status = 'ready'
         GROUP BY byte_hash HAVING COUNT(*) > 1
       )
     ORDER BY byte_hash`
  ).all(sessionId, sessionId) as ByteHashRow[];

  const groups = groupByByteHash(rows);
  if (groups.length === 0) return 0;

  const insertGroup = db.prepare(
    "INSERT INTO dupe_groups (id, scan_session_id, member_count, status) VALUES (?, ?, ?, 'pending')"
  );
  const insertMember = db.prepare(
    'INSERT INTO dupe_group_members (group_id, file_id, is_keeper, rank) VALUES (?, ?, ?, ?)'
  );
  const deleteOldMembers = db.prepare(
    'DELETE FROM dupe_group_members WHERE group_id IN (SELECT id FROM dupe_groups WHERE scan_session_id = ?)'
  );
  const deleteOldGroups = db.prepare('DELETE FROM dupe_groups WHERE scan_session_id = ?');

  // Atomic clear-and-rebuild (see detectDuplicates comment).
  const groupCount = db.transaction(() => {
    deleteOldMembers.run(sessionId);
    deleteOldGroups.run(sessionId);

    let count = 0;
    for (const members of groups) {
      const groupId = crypto.randomUUID();
      insertGroup.run(groupId, sessionId, members.length);
      members.forEach((m, idx) => {
        insertMember.run(groupId, m.id, idx === 0 ? 1 : 0, idx);
      });
      count++;
    }
    return count;
  })();

  return groupCount as number;
}
