# CLAUDE.md — PixelPusher

## What This Is

PixelPusher is a cross-platform Electron desktop app that scans photo/video libraries, detects duplicates using perceptual hashing, and organizes files into date-based folder structures. It handles 40K+ files without crashing.

## Tech Stack

- Electron (desktop shell)
- TypeScript (entire codebase)
- React (UI, renderer process)
- SQLite via better-sqlite3 (ALL data storage — no in-memory arrays)
- exiftool-vendored (EXIF metadata extraction)
- sharp (image processing, perceptual hashing)
- electron-builder (packaging)

## Architecture

- `src/main/` — Electron main process. ALL filesystem and database operations happen here.
- `src/renderer/` — React UI. Communicates with main process via IPC only.
- `src/shared/` — Shared TypeScript types and constants.

## Critical Rules (Learned from Crashes)

1. **SQLite is the backbone.** All file data lives in the database. Renderer holds max 100 rows. No in-memory arrays of files.
2. **Two-phase scanning.** Phase 1: discover files (fast). Phase 2: extract metadata in batches.
3. **ExifTool singleton.** ONE instance. No restart pattern (causes zombie Perl processes). Kill only when scan completes.
4. **Batch everything.** EXIF: batches of 20. Organize: batches of 100. DB writes: batches of 500.
5. **Yield to event loop.** After every batch: `await new Promise(r => setImmediate(r))`. Windows kills processes that don't pump messages.
6. **Stream to disk.** Operation logs use WriteStream. Error arrays capped at 50. Nothing grows with file count.
7. **IPC is thin.** Progress events contain numbers and one string. Never send file objects during operations.
8. **External drive awareness.** Pre-flight readiness check. Copy retry on UNKNOWN errors.

## Key Files

- `src/main/database.ts` — SQLite setup, all queries, WAL mode, 64MB cache
- `src/main/file-scanner.ts` — Recursive directory walk, inserts to DB in batches of 500
- `src/main/exif-reader.ts` — ExifTool singleton, batch extraction, proper lifecycle
- `src/main/file-mover.ts` — Batch organize from DB, WriteStream logging, safe copy/move
- `src/main/logger.ts` — Rotating file logger at ~/.photomove/logs/
- `src/main/memory-watchdog.ts` — 5-level memory monitoring
- `src/shared/pattern.ts` — Folder pattern token resolver
- `src/shared/types.ts` — All shared TypeScript interfaces

## Commands

- `npm run dev` — Launch in development mode
- `npm run test` — Run unit tests
- `npm run dist` — Build installer
- `npm run stress:ladder` — Run 5-tier stress test

## Things to NEVER Do

- Never let the renderer hold all files in memory
- Never send arrays through IPC during long operations
- Never create more than one ExifTool instance
- Never restart ExifTool mid-scan
- Never run a loop >500ms without yielding (setImmediate)
- Never accumulate an unbounded array in the main process
- Never use OFFSET pagination on large tables (use keyset)
- Never auto-delete files without explicit user confirmation
