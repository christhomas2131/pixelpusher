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

  // Clear stale groups for this session
  db.prepare(
    'DELETE FROM dupe_group_members WHERE group_id IN (SELECT id FROM dupe_groups WHERE scan_session_id = ?)'
  ).run(sessionId);
  db.prepare('DELETE FROM dupe_groups WHERE scan_session_id = ?').run(sessionId);

  const insertGroup  = db.prepare(
    "INSERT INTO dupe_groups (id, scan_session_id, member_count, status) VALUES (?, ?, ?, 'pending')"
  );
  const insertMember = db.prepare(
    'INSERT INTO dupe_group_members (group_id, file_id, is_keeper, rank) VALUES (?, ?, ?, ?)'
  );

  const rowMap = new Map<string, HashRow>(rows.map(r => [r.id, r]));

  const groupCount = db.transaction(() => {
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
