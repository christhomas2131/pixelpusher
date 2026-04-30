import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import initSqlJs from 'sql.js';
import { computeByteHash } from '../src/main/byte-hash-engine';
import { groupByByteHash, type ByteHashRow } from '../src/main/dupe-detector';
import { MIGRATIONS } from '../src/main/migrations';

describe('computeByteHash', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelpusher-bytehash-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function expectedHash(content: string | Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  it('matches the canonical SHA-256 for a known string', async () => {
    const file = path.join(tmpDir, 'small.txt');
    const content = 'PixelPusher rules\n';
    fs.writeFileSync(file, content);
    const hash = await computeByteHash(file);
    expect(hash).toBe(expectedHash(content));
  });

  it('produces a different hash for different content', async () => {
    const f1 = path.join(tmpDir, 'a.txt');
    const f2 = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(f1, 'one');
    fs.writeFileSync(f2, 'two');
    expect(await computeByteHash(f1)).not.toBe(await computeByteHash(f2));
  });

  it('produces the same hash for byte-identical files in different paths', async () => {
    const dir1 = path.join(tmpDir, 'dir1');
    const dir2 = path.join(tmpDir, 'sub', 'dir2');
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });
    const content = Buffer.from('identical bytes regardless of path\n');
    const f1 = path.join(dir1, 'doc.pdf');
    const f2 = path.join(dir2, 'doc.pdf');
    fs.writeFileSync(f1, content);
    fs.writeFileSync(f2, content);
    expect(await computeByteHash(f1)).toBe(await computeByteHash(f2));
  });

  it('returns null for a missing file', async () => {
    const hash = await computeByteHash(path.join(tmpDir, 'does-not-exist.bin'));
    expect(hash).toBeNull();
  });

  it('streams a file larger than the buffer chunk size correctly', async () => {
    // Default highWaterMark is 256 KB; write 1 MB to force multiple chunks.
    const file = path.join(tmpDir, 'big.bin');
    const buf = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < buf.length; i++) buf[i] = i & 0xff;
    fs.writeFileSync(file, buf);
    expect(await computeByteHash(file)).toBe(expectedHash(buf));
  });
});

describe('groupByByteHash', () => {
  function row(id: string, sourcePath: string, byteHash?: string): ByteHashRow {
    return {
      id,
      source_path: sourcePath,
      filename: sourcePath.split('/').pop() ?? '',
      size: 1000,
      byte_hash: byteHash,
    };
  }

  it('returns empty when no row has a byte_hash', () => {
    expect(groupByByteHash([row('a', '/a.pdf'), row('b', '/b.pdf')])).toEqual([]);
  });

  it('returns empty when all hashes are unique', () => {
    expect(
      groupByByteHash([
        row('a', '/a.pdf', 'hash-a'),
        row('b', '/b.pdf', 'hash-b'),
        row('c', '/c.pdf', 'hash-c'),
      ])
    ).toEqual([]);
  });

  it('groups rows that share a byte_hash', () => {
    const rows = [
      row('a', '/docs/a.pdf', 'h1'),
      row('b', '/old/copy.pdf', 'h1'),
      row('c', '/x.pdf', 'h2'),
    ];
    const groups = groupByByteHash(rows);
    expect(groups.length).toBe(1);
    expect(groups[0].map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('sorts each group keeper-first by shortest path, then filename', () => {
    const rows = [
      row('deep', '/very/deep/nested/folder/report.pdf', 'h1'),
      row('top', '/report.pdf', 'h1'),
      row('mid', '/inbox/report.pdf', 'h1'),
    ];
    const [group] = groupByByteHash(rows);
    expect(group.map((r) => r.id)).toEqual(['top', 'mid', 'deep']);
  });

  it('breaks ties on path depth via alphabetical filename', () => {
    const rows = [
      row('z', '/folder/zeta.pdf', 'h1'),
      row('a', '/folder/alpha.pdf', 'h1'),
    ];
    const [group] = groupByByteHash(rows);
    expect(group.map((r) => r.id)).toEqual(['a', 'z']);
  });

  it('handles many independent groups', () => {
    const rows = [
      row('a1', '/a/1', 'A'), row('a2', '/a/2', 'A'),
      row('b1', '/b/1', 'B'), row('b2', '/b/2', 'B'), row('b3', '/b/3', 'B'),
      row('lonely', '/x', 'C'),
    ];
    const groups = groupByByteHash(rows);
    expect(groups.length).toBe(2);
    expect(groups.find((g) => g.length === 2)?.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(groups.find((g) => g.length === 3)?.map((r) => r.id)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('migration #3 — add byte_hash column', () => {
  it('adds byte_hash to files when applied after #1 and #2', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    for (const m of MIGRATIONS) db.run(m.up);

    const cols = db.exec("PRAGMA table_info('files')")[0].values
      .map((row) => row[1] as string);
    expect(cols).toContain('byte_hash');

    // A row with byte_hash NULL should be allowed (nullable column).
    db.run(
      `INSERT INTO files (id, filename, source_path, size, format, status, scan_session_id)
       VALUES ('f1', 'a.pdf', '/a.pdf', 100, '.pdf', 'ready', 's1')`
    );
    const rows = db.exec("SELECT byte_hash FROM files WHERE id = 'f1'")[0].values;
    expect(rows[0][0]).toBeNull();

    // Insert a row with byte_hash set.
    db.run(
      `INSERT INTO files (id, filename, source_path, size, format, status, scan_session_id, byte_hash)
       VALUES ('f2', 'b.pdf', '/b.pdf', 100, '.pdf', 'ready', 's1', 'abc123')`
    );
    const rows2 = db.exec("SELECT byte_hash FROM files WHERE id = 'f2'")[0].values;
    expect(rows2[0][0]).toBe('abc123');

    db.close();
  });
});
