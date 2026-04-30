# PixelPusher — Master Rebuild Plan

## Overview

PixelPusher is a cross-platform Electron desktop app that scans photo/video libraries, detects duplicates using perceptual hashing, and organizes files into date-based folder structures. It handles 40K+ files without crashing.

This is a REBUILD from scratch incorporating every architectural lesson learned from the original build. Every bug fix, memory optimization, and stability improvement is baked in as the original design.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron |
| Language | TypeScript (entire codebase) |
| UI Framework | React |
| Database | SQLite via better-sqlite3 (NOT in-memory arrays) |
| EXIF Extraction | exiftool-vendored |
| Image Processing | sharp |
| Build/Bundle | electron-builder |

## Critical Architecture Rules (Learned the Hard Way)

1. **SQLite is the backbone from day one.** All file data lives in the database. The renderer holds max 100 rows at a time. No in-memory arrays of files. Ever.

2. **Two-phase scanning.** Phase 1: discover files (fast, filesystem only). Phase 2: extract metadata in batches (slow, exiftool). Never mix them.

3. **ExifTool singleton.** ONE instance, maxProcs: 1 in Safe mode. No restart-every-N-files pattern (causes zombie Perl processes). Kill it ONLY when scan completes.

4. **Batch everything.** EXIF extraction: batches of 20. Organize: batches of 100. Database writes: batches of 500 in transactions.

5. **Yield to event loop.** After every batch in every long loop: `await new Promise(resolve => setImmediate(resolve))`. Windows kills processes that don't pump messages.

6. **Stream to disk, never accumulate.** Operation logs use WriteStream. Error arrays capped at 50. No array grows proportionally to file count.

7. **IPC is thin.** Progress events contain numbers and one string. Never send file objects or arrays through IPC during operations.

8. **External drive awareness.** Pre-flight drive readiness check. Copy retry with 15s delay on UNKNOWN errors (drive spin-down).

## Rebuild Phases

### Phase 1: Foundation (scaffold + database + scanner)
- Project scaffold: Electron + TypeScript + React
- SQLite database with full schema from day one
- File discovery (Phase 1 scan) — filesystem walk, insert to DB
- Preview table with pagination from DB
- IPC architecture with thin messages
- Memory monitoring and logging system

### Phase 2: Metadata Extraction
- Two-phase scan architecture
- ExifTool singleton with proper lifecycle
- Batch-of-20 extraction with yields
- Date fallback chain: EXIF → filename parsing → filesystem dates
- Junk file detection
- Quick Scan (date only) and Full Scan modes
- Safe/Balanced/Fast speed presets

### Phase 3: Organization Engine
- Batch organize from database (100 at a time)
- Operation log via WriteStream
- Copy/Move with conflict resolution
- External drive detection and retry
- Configurable folder patterns with all tokens
- Resume after interruption

### Phase 4: Duplicate Detection
- Perceptual hashing via sharp
- LSH bucket indexing for efficient comparison
- Dupe group display with side-by-side review
- Quarantine system

### Phase 5: Multi-Source + Advanced Features
- Multi-source scanning with unified progress
- Cross-source dupe detection
- Merge to single destination
- Sort by Type mode
- Google Photos Takeout parsing
- Watch folders

### Phase 6: UI Polish + Monetization
- Collapsible panels
- Dark/light/system theme
- Application menus (File, View, Tools)
- Before/after visualization
- PDF export reports
- License key system (PXLP prefix)
- Landing page
- Stripe/Gumroad integration

### Phase 7: Stability + Testing
- Comprehensive file-based logging
- Stress test ladder (1K → 50K)
- Memory watchdog
- Crash recovery with resume
- Error boundaries in React
- 111+ automated tests
