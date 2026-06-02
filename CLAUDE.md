# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

PixelPusher is a cross-platform Electron desktop app (macOS + Windows) that scans
photo/video/document libraries, detects duplicates (perceptual + byte-exact), and
organizes files into date- or type-based folder structures. Stable on 40K+ file
libraries.

Two profiles share the same plumbing:
- **PixelPusher** mode — photos, videos, RAW (default, free tier)
- **DataHoarder** mode — PDFs, docs, audio, design, 3D (Pro feature)

## Tech Stack

- Electron + TypeScript + React (renderer)
- SQLite via better-sqlite3 (ALL data storage — no in-memory arrays)
- exiftool-vendored (EXIF metadata)
- sharp (image processing, perceptual hashing)
- @sentry/electron (opt-in crash reporting)
- electron-builder (packaging — per-arch macOS, NSIS Windows)
- vitest (unit) + @playwright/test (e2e smoke)

## Architecture

- `src/main/` — Electron main process. ALL filesystem and database operations live here.
- `src/renderer/` — React UI. Communicates with main via IPC only.
- `src/shared/` — Shared types, mode definitions, pro-feature gating.

The main process gates ALL destructive operations through `dialog.showMessageBox`
regardless of what the renderer did — never trust the renderer to have confirmed.

## Critical Rules (Learned from Crashes & Audits)

1. **SQLite is the backbone.** All file data lives in the DB. Renderer holds max 100 rows.
2. **Two-phase scanning.** Phase 1: discover (fast). Phase 2: extract metadata in batches.
3. **ExifTool singleton + sticky-death.** ONE instance. If a worker dies mid-scan, set the
   sticky flag — do NOT re-instantiate. `closeExiftool()` only runs at end-of-scan or
   app shutdown (resets the flag for the next scan).
4. **Batch everything.** Discovery: 500. EXIF: 20/50/100 (speed config). Hash: 20.
   Organize: 100. DB writes: 500.
5. **Yield to event loop.** After every batch: `await new Promise(r => setImmediate(r))`.
   Windows kills processes that don't pump messages.
6. **Stream to disk.** Operation logs use WriteStream. Error arrays capped at 50.
7. **IPC is thin.** Progress events: numbers + one string. Never file objects.
8. **External drive awareness.** Pre-flight readiness check; copy retry on UNKNOWN.
9. **Destructive ops gate on `dialog.showMessageBox`.** `organize:undo`,
   `dupe:autoResolveAll`, "Clear Database" all confirm in main.
10. **Settings merge, never overwrite.** Spread the current settings object first.
11. **HTML-escape** user-derived strings (filenames, EXIF errors) in any HTML/PDF report.
12. **Renderer CSP locks `img-src` to `'self' data: blob:`.** No `file://` URLs from the
    renderer — use the `image:getThumbnail` IPC channel.
13. **Pro gating via `license.tier === 'pro'`**, NOT `status === 'valid'`.
14. **Mode-aware code.** Pattern defaults, file categories, dedup strategy (pHash vs
    byte-hash), and EXIF interpretation all branch on `Mode` (`src/shared/mode.ts`).
15. **OFFSET pagination capped at MAX_PAGE = 1000.** Deeper requests throw.

## Key Files

### Main process
- `src/main/database.ts` — SQLite setup, WAL mode, 64MB cache, all queries, ALLOWED_SORT_COLS guard
- `src/main/migrations.ts` — user_version-based migration runner; append-only, strict gap-check
- `src/main/file-scanner.ts` — Async fs/promises iterative walker; thread-local cancel token
- `src/main/exif-reader.ts` — ExifTool singleton + sticky-death; mode-aware metadata
- `src/main/hash-engine.ts` — Perceptual hash (sharp DCT) for images
- `src/main/byte-hash-engine.ts` — SHA-256 streaming hash for non-photo files
- `src/main/dupe-detector.ts` — pHash union-find + SQL-filtered byte-hash grouping
- `src/main/dry-run.ts` — Streaming destination-tree preview (5000 nodes / 2000 existence checks max)
- `src/main/file-mover.ts` — Async safeCopy/safeMove with Windows long-path `\\?\` prefix
- `src/main/operation-log.ts` — Per-session JSONL log + meta; undo source of truth
- `src/main/logger.ts` — Rotating file logger at `~/.photomove/logs/`
- `src/main/memory-watchdog.ts` — 5-level memory monitoring
- `src/main/ipc-handlers.ts` — All IPC channel registrations (largest file in main)
- `src/main/preload.ts` — Context-isolated bridge
- `src/main/license-manager.ts` — HMAC license keys; dev keys for unpackaged builds
- `src/main/settings-manager.ts` — Schema-validated, atomic settings.json read/write
- `src/main/mac-dock.ts` — Dock progress + badge (no-op off macOS)
- `src/main/menu.ts` — Native menu (separate macOS branch)
- `src/main/auto-update.ts` — electron-updater wiring (mac .zip, win .exe)

### Shared
- `src/shared/types.ts` — All shared interfaces + ElectronAPI surface
- `src/shared/constants.ts` — Batch sizes, supported formats, skip dirs
- `src/shared/pattern.ts` — Folder pattern token resolver
- `src/shared/mode.ts` — Mode type + per-mode defaults (categories, patterns)
- `src/shared/pro-features.ts` — Pro feature matrix, FREE_FILE_CAP, FREE_DUPE_GROUPS_CAP, requiresPro

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Concurrent tsc-watch + webpack-dev-server + electron |
| `npm run build` | Production build (main + renderer) |
| `npm test` | Run vitest unit suite |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Coverage report |
| `npm run test:e2e` | Playwright smoke (pretest:e2e runs build first) |
| `npm run smoke` | One-shot smoke test (`scripts/smoke-test.ts`) |
| `npm run stress:ladder` | 5-tier stress test |
| `npm run dist` | Build installer (predist runs ensure:mac-arches on macOS) |
| `npm run icons` | Regenerate platform icon files |

Run a single test file: `npx vitest run tests/database.test.ts`
Filter by name: `npx vitest run -t "byte-hash grouping"`

## Build / Packaging

- **macOS:** separate per-arch builds (`release/mac-arm64/`, `release/mac/`), NOT
  universal — `@electron/universal` v2 chokes on Sentry's transitive deps.
  Artifacts: `PixelPusher-1.0.0-{arm64,x64}.{dmg,zip}`.
- **Windows:** NSIS installer.
- `scripts/ensure-mac-arches.js` installs the missing arch's sharp prebuild on demand.
- Code signing not yet wired (`mac.identity: null`). README documents the Gatekeeper /
  SmartScreen workaround.

## Environment Variables

- `SENTRY_DSN` — opt-in crash reporting (main + renderer). Unset in dev/CI.
- `PIXELPUSHER_HARD_KILL_PERL=1` — Windows only. Restores legacy `taskkill /F /IM perl.exe`
  after closeExiftool. Off by default (reaps unrelated Perl processes).
- `NODE_ENV=development` — enables devtools menu and dev-license auto-activation.

## CI

`.github/workflows/ci.yml` runs on `macos-latest` (arm64). Steps: `npm ci` → typecheck →
`npm test` → `npm run build` → `npx playwright test` → `npm run dist` → per-arch
`lipo -info` verification (asserts each .app is single-arch, NOT universal) → upload
`.dmg` + `.zip` artifacts on master.

## Things to NEVER Do

- Never let the renderer hold all files in memory
- Never send arrays through IPC during long operations
- Never create more than one ExifTool instance OR re-instantiate after worker death mid-scan
- Never run a loop >500ms without yielding (`setImmediate`)
- Never accumulate an unbounded array in the main process
- Never use OFFSET pagination on large tables (or jump past `MAX_PAGE = 1000`)
- Never auto-delete files without explicit user confirmation via `dialog.showMessageBox`
- Never overwrite `settings.json` with hardcoded values — always merge
- Never interpolate user-derived strings (filenames, EXIF errors) into HTML/PDF reports without escaping
- Never derive Pro state from `license.status === 'valid'` — use `license.tier === 'pro'`
- Never emit `file://` URLs from the renderer — CSP blocks `img-src`. Use the thumbnail IPC channel.
