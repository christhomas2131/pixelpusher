/**
 * Stress ladder — runs inside Electron main process for native module access.
 * Five tiers: 1K → 5K → 10K → 25K → 50K files.
 * Export: run() → resolves on pass, rejects on fail.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { BrowserWindow } from 'electron';
import { getDb, insertScanSession, completeScanSession, getFilesForOrganize, getOrganizeTotals } from '../src/main/database';
import { scanDirectory } from '../src/main/file-scanner';
import { closeExiftool } from '../src/main/exif-reader';
import { resolveConflict, buildFullDestination } from '../src/main/file-mover';

// ── Minimal valid JPEG (~1KB) ─────────────────────────────────────────────────

function makeJpegBuffer(size = 1024): Buffer {
  const pad = Buffer.alloc(Math.max(0, size - 4), 0xAB);
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), pad, Buffer.from([0xFF, 0xD9])]);
}

// ── Fake BrowserWindow ────────────────────────────────────────────────────────

function fakeWin(): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { send: () => {} },
  } as unknown as BrowserWindow;
}

// ── Tier config ───────────────────────────────────────────────────────────────

const TIERS: Array<{ n: number; rssLimitMB: number }> = [
  { n:  1_000, rssLimitMB:  300 },
  { n:  5_000, rssLimitMB:  400 },
  { n: 10_000, rssLimitMB:  500 },
  { n: 25_000, rssLimitMB:  700 },
  { n: 50_000, rssLimitMB: 1_000 },
];

// ── File creation ─────────────────────────────────────────────────────────────

function createTierFiles(dir: string, n: number): void {
  const junkDir = path.join(dir, 'Thumbnails');
  const dupeDir = path.join(dir, 'duplicates');
  const mainDir = path.join(dir, 'main');
  fs.mkdirSync(junkDir,  { recursive: true });
  fs.mkdirSync(dupeDir,  { recursive: true });
  fs.mkdirSync(mainDir,  { recursive: true });

  const junkCount = Math.floor(n * 0.05);
  const dupeCount = Math.floor(n * 0.10);
  const mainCount = n - junkCount - dupeCount;
  const mainBuf   = makeJpegBuffer(1024);
  const dupeBuf   = makeJpegBuffer(1024);

  for (let i = 0; i < mainCount; i++) {
    const y  = 2020 + (i % 5);
    const m  = String((i % 12) + 1).padStart(2, '0');
    const d  = String((i % 28) + 1).padStart(2, '0');
    const nm = `IMG_${y}${m}${d}_${String(i).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(mainDir, nm), mainBuf);
  }
  for (let i = 0; i < junkCount; i++) {
    fs.writeFileSync(path.join(junkDir, `thumb_${i}.jpg`), makeJpegBuffer(512));
  }
  for (let i = 0; i < dupeCount; i++) {
    fs.writeFileSync(path.join(dupeDir, `dupe_${i}.jpg`), dupeBuf);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rssMB(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function forceGc(): void {
  if ((global as any).gc) (global as any).gc();
  try { getDb().pragma('shrink_memory'); } catch {}
}

function cleanupSession(sessionId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM dupe_group_members WHERE group_id IN (SELECT id FROM dupe_groups WHERE scan_session_id = ?)').run(sessionId);
  db.prepare('DELETE FROM dupe_groups WHERE scan_session_id = ?').run(sessionId);
  db.prepare('DELETE FROM files WHERE scan_session_id = ?').run(sessionId);
  db.prepare('DELETE FROM scan_sessions WHERE id = ?').run(sessionId);
  db.prepare('DELETE FROM operation_progress WHERE session_id = ?').run(sessionId);
  db.pragma('wal_checkpoint(PASSIVE)');
}

// ── Single tier ───────────────────────────────────────────────────────────────

async function runTier(
  tierIndex: number,
  n: number,
  rssLimitMB: number,
  prevPerFileMB: number
): Promise<number> {
  const label = `Tier ${tierIndex + 1} (${n.toLocaleString()} files, limit=${rssLimitMB}MB)`;
  console.log(`\n${'─'.repeat(62)}`);
  console.log(`▶  ${label}`);

  const tmpRoot  = path.join(os.tmpdir(), `pp-stress-${tierIndex}-${crypto.randomUUID().slice(0, 8)}`);
  const destDir  = path.join(os.tmpdir(), `pp-stress-dest-${tierIndex}-${crypto.randomUUID().slice(0, 8)}`);
  const sessionId = crypto.randomUUID();

  try {
    // 1. Create test files
    process.stdout.write(`   Creating files…`);
    const t0 = Date.now();
    createTierFiles(tmpRoot, n);
    process.stdout.write(` done (${Date.now() - t0}ms)\n`);

    // 2. Scan (discovery phase only — no ExifTool to keep test fast)
    insertScanSession({ id: sessionId, sourceFolders: [tmpRoot], scanDepth: 'quick', scanSpeed: 'fast' });

    process.stdout.write(`   Scanning…`);
    const t1 = Date.now();
    const { totalFiles, totalSize } = await scanDirectory([tmpRoot], sessionId, 0, fakeWin(), ['images']);
    process.stdout.write(` ${totalFiles.toLocaleString()} discovered (${Date.now() - t1}ms)\n`);

    // Skip ExifTool (stress test focus is memory/DB, not EXIF accuracy).
    // Promote pending → ready and set a fake date so organize works.
    getDb().prepare(
      "UPDATE files SET status='ready', date_taken='2024-03-15T12:00:00.000Z' WHERE scan_session_id=? AND status='pending'"
    ).run(sessionId);
    completeScanSession(sessionId, totalFiles, totalSize);

    forceGc();
    const rssScan = rssMB();
    console.log(`   RSS after scan:     ${rssScan} MB`);

    // 3. Organize — sample up to 500 files to avoid excessive disk I/O
    fs.mkdirSync(destDir, { recursive: true });
    const sample = Math.min(500, (getOrganizeTotals(sessionId) as { count: number }).count);
    let organized = 0;
    let lastId: string | null = null;
    let remaining = sample;

    while (remaining > 0) {
      const batch = getFilesForOrganize(sessionId, lastId, Math.min(100, remaining));
      if (batch.length === 0) break;
      for (const file of batch) {
        const dest   = buildFullDestination(destDir, '{YYYY}/{MMM}', file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const final = resolveConflict(dest, 'rename');
        if (final) { fs.copyFileSync(file.source_path, final); organized++; }
      }
      lastId    = batch[batch.length - 1].id;
      remaining -= batch.length;
      await new Promise<void>(r => setImmediate(r));
    }

    forceGc();
    const rssOrg = rssMB();
    console.log(`   Organized:          ${organized} sampled`);
    console.log(`   RSS after organize: ${rssOrg} MB`);

    // 4. Assert memory limit
    if (rssOrg > rssLimitMB) {
      throw new Error(`${label}: RSS ${rssOrg}MB exceeds limit ${rssLimitMB}MB`);
    }

    // 5. Memory growth check
    const perFileMB = rssOrg / n;
    if (prevPerFileMB > 0 && perFileMB > prevPerFileMB * 3) {
      throw new Error(
        `${label}: per-file cost grew from ${(prevPerFileMB * 1000).toFixed(2)} to ` +
        `${(perFileMB * 1000).toFixed(2)} KB/file (>3× acceleration — possible leak)`
      );
    }
    console.log(`   Per-file cost:      ${(perFileMB * 1000).toFixed(2)} KB/file`);
    console.log(`✓  ${label} PASSED`);

    return perFileMB;
  } finally {
    cleanupSession(sessionId);
    try { fs.rmSync(tmpRoot,  { recursive: true, force: true }); } catch {}
    try { fs.rmSync(destDir,  { recursive: true, force: true }); } catch {}
  }
}

// ── Exported entry point ──────────────────────────────────────────────────────

export async function run(): Promise<void> {
  console.log('PixelPusher — Stress Ladder');
  console.log('='.repeat(62));
  console.log(`Baseline RSS: ${rssMB()} MB`);

  let prevPerFileMB = 0;
  for (let i = 0; i < TIERS.length; i++) {
    const { n, rssLimitMB } = TIERS[i];
    prevPerFileMB = await runTier(i, n, rssLimitMB, prevPerFileMB);
  }

  await closeExiftool();
  console.log('\n' + '='.repeat(62));
  console.log('✓  ALL TIERS PASSED');
}
