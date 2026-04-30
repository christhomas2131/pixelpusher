/**
 * Smoke test — 10 integration validation steps.
 * Runs inside Electron main process.
 * Export: run() → resolves on pass, rejects on fail.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { BrowserWindow } from 'electron';
import { getDb, insertScanSession, completeScanSession } from '../src/main/database';
import { scanDirectory } from '../src/main/file-scanner';
import { detectJunk } from '../src/main/junk-detector';
import { computePHash } from '../src/main/hash-engine';
import { buildFullDestination, resolveConflict } from '../src/main/file-mover';
import { getSettings, saveSettings } from '../src/main/settings-manager';
import { OperationLog, readLogEntries } from '../src/main/operation-log';
import { closeExiftool } from '../src/main/exif-reader';
import { resolvePattern } from '../src/shared/pattern';

// ── Minimal JPEG buffer ───────────────────────────────────────────────────────

const JPEG_BUF = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
  Buffer.alloc(2048, 0xAB),
  Buffer.from([0xFF, 0xD9]),
]);

function fakeWin(): BrowserWindow {
  return { isDestroyed: () => false, webContents: { send: () => {} } } as unknown as BrowserWindow;
}

// ── Step runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function step(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗  ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ── Exported entry point ──────────────────────────────────────────────────────

export async function run(): Promise<void> {
  console.log('PixelPusher — Smoke Test');
  console.log('='.repeat(50));

  const tmpDir    = path.join(os.tmpdir(), `pp-smoke-${crypto.randomUUID().slice(0, 8)}`);
  const destDir   = path.join(os.tmpdir(), `pp-smoke-dest-${crypto.randomUUID().slice(0, 8)}`);
  const sessionId = crypto.randomUUID();

  fs.mkdirSync(tmpDir,  { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });

  const jpgA     = path.join(tmpDir, 'IMG_20240315_120000.jpg');
  const jpgB     = path.join(tmpDir, 'IMG_20240601_090000.jpg');
  const thumbDir = path.join(tmpDir, 'Thumbnails');
  const thumbJpg = path.join(thumbDir, 'thumb.jpg');
  fs.mkdirSync(thumbDir);
  fs.writeFileSync(jpgA, JPEG_BUF);
  fs.writeFileSync(jpgB, JPEG_BUF);
  fs.writeFileSync(thumbJpg, Buffer.alloc(1024, 0x00));

  try {
    // Step 1: Scanner finds files
    await step('Scanner finds files', async () => {
      insertScanSession({ id: sessionId, sourceFolders: [tmpDir], scanDepth: 'quick', scanSpeed: 'safe' });
      const { totalFiles } = await scanDirectory([tmpDir], sessionId, 0, fakeWin(), ['images']);
      assert(totalFiles >= 2, `Expected ≥2 files, got ${totalFiles}`);
    });

    // Step 2: DB stores scanned files
    await step('DB stores scanned files', () => {
      const n = (getDb().prepare('SELECT COUNT(*) as n FROM files WHERE scan_session_id = ?').get(sessionId) as { n: number }).n;
      assert(n >= 2, `Expected ≥2 DB rows, got ${n}`);
    });

    // Step 3: Junk detection flags Thumbnails directory
    await step('Junk detection flags Thumbnails directory', () => {
      const r = detectJunk(thumbJpg.replace(/\\/g, '/'), 1024);
      assert(r.isJunk, `Expected ${thumbJpg} to be junk`);
      assert(r.reason === 'junk_directory', `Expected junk_directory, got ${r.reason}`);
    });

    // Step 4: Hashing produces consistent results
    await step('Hashing produces consistent results', async () => {
      const h1 = await computePHash(jpgA);
      const h2 = await computePHash(jpgA);
      assert(h1 === h2, `Hashes differ: ${h1} vs ${h2}`);
      assert(typeof h1 === 'string' && h1.length === 16, `Expected 16-char hash, got: "${h1}"`);
    });

    // Step 5: Organize copies to correct destination
    await step('Organize copies file to correct destination', () => {
      const db = getDb();
      db.prepare("UPDATE files SET status='ready', date_taken='2024-03-15T12:00:00.000Z' WHERE scan_session_id=? AND status='pending'").run(sessionId);
      completeScanSession(sessionId, 2, JPEG_BUF.length * 2);

      const file = db.prepare("SELECT * FROM files WHERE scan_session_id=? AND status='ready' LIMIT 1").get(sessionId) as any;
      assert(!!file, 'No ready files found');

      const destPath = buildFullDestination(destDir, '{YYYY}/{MMM}', file);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const final = resolveConflict(destPath, 'rename');
      assert(final !== null, 'resolveConflict returned null');
      fs.copyFileSync(file.source_path, final!);
      assert(fs.existsSync(final!), `Dest file not found: ${final}`);
    });

    // Step 6: Operation log is written
    await step('Operation log written to disk', () => {
      const log = new OperationLog(sessionId, destDir, '{YYYY}/{MMM}', 'copy', new Date().toISOString());
      log.write({ src: jpgA, dest: path.join(destDir, '2024', 'March', path.basename(jpgA)), status: 'ok' });
      log.close(1, 0, 0);
      const entries = readLogEntries(sessionId);
      assert(entries.length >= 1, `Expected ≥1 log entry, got ${entries.length}`);
      assert(entries[0].status === 'ok', `Expected status=ok, got ${entries[0].status}`);
    });

    // Step 7: Undo reads log entries
    await step('Undo log entries are readable', () => {
      const entries = readLogEntries(sessionId);
      const okEntries = entries.filter(e => e.status === 'ok');
      assert(okEntries.length >= 1, 'Expected ≥1 ok entry for undo');
      assert(typeof okEntries[0].src === 'string', 'src must be a string');
      assert(typeof okEntries[0].dest === 'string', 'dest must be a string');
    });

    // Step 8: Settings round-trip correctly
    await step('Settings round-trip correctly', () => {
      const original = getSettings();
      saveSettings({ ...original, folderPattern: '{YYYY}/SMOKE_TEST' });
      const loaded = getSettings();
      assert(loaded.folderPattern === '{YYYY}/SMOKE_TEST', `Settings not persisted: ${loaded.folderPattern}`);
      saveSettings(original);
    });

    // Step 9: Pattern tokens resolve
    await step('Pattern tokens resolve correctly', () => {
      const date = new Date('2024-03-15T12:00:00Z');
      assert(resolvePattern('{YYYY}',    { date }) === '2024',          '{YYYY} failed');
      assert(resolvePattern('{MMM}',     { date }) === 'March',         '{MMM} failed');
      assert(resolvePattern('{MM}',      { date }) === '03',            '{MM} failed');
      assert(resolvePattern('{DD}',      { date }) === '15',            '{DD} failed');
      assert(resolvePattern('{QUARTER}', { date }) === 'Jan - Mar 2024', '{QUARTER} failed');
      assert(resolvePattern('{HALF}',    { date }) === 'Jan - Jun 2024', '{HALF} failed');
    });

    // Step 10: Conflict resolution strategies
    await step('Conflict resolution strategies work correctly', () => {
      const f = path.join(destDir, 'conflict.jpg');
      fs.writeFileSync(f, 'x');
      assert(resolveConflict(f, 'skip')      === null,      'skip should return null');
      assert(resolveConflict(f, 'overwrite') === f,         'overwrite should return same path');
      const renamed = resolveConflict(f, 'rename');
      assert(renamed !== null && renamed !== f,              'rename should return different path');
      assert(!fs.existsSync(renamed!),                       'renamed path should not exist');
    });

  } finally {
    try {
      const db = getDb();
      db.prepare('DELETE FROM dupe_group_members WHERE group_id IN (SELECT id FROM dupe_groups WHERE scan_session_id=?)').run(sessionId);
      db.prepare('DELETE FROM dupe_groups WHERE scan_session_id=?').run(sessionId);
      db.prepare('DELETE FROM files WHERE scan_session_id=?').run(sessionId);
      db.prepare('DELETE FROM scan_sessions WHERE id=?').run(sessionId);
    } catch {}
    try { fs.rmSync(tmpDir,  { recursive: true, force: true }); } catch {}
    try { fs.rmSync(destDir, { recursive: true, force: true }); } catch {}
    await closeExiftool();
  }

  console.log('');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) throw new Error(`${failed} smoke test step(s) failed`);
  console.log('✓  ALL SMOKE TESTS PASSED');
}
