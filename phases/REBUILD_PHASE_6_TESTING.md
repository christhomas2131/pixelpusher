# PixelPusher — Rebuild Phase 6: Testing + Stress Tests + Hardening

## Context

Phases 1-5 complete: full app with all features, UI polish, and monetization. This phase validates everything works under stress and adds final hardening.

## Part 1: Unit Tests

Install: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitest/coverage-v8`

package.json scripts:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

IMPORTANT: These must be SEPARATE entries in package.json, not concatenated.

Write tests for:

**pattern.test.ts:**
- {YYYY}, {MM}, {MMM}, {DD} resolve correctly
- {QUARTER} maps to "Jan - Mar 2025" through "Oct - Dec 2025"
- {HALF} maps to "Jan - Jun 2025" and "Jul - Dec 2025"
- {YEAR_RANGE} groups correctly with configurable range size
- Unknown date produces "Unknown Date" folder
- Null date strips date tokens cleanly

**database.test.ts:**
- Insert batch of files
- Paginated query returns correct page
- Count queries return correct totals
- Keyset pagination works

**junk-detector.test.ts:**
- Flags files in Thumbnails/ directory
- Flags Thumbs.db
- Flags images under 200x200
- Does NOT flag normal photos

**file-mover.test.ts:**
- Copy to correct destination
- Conflict resolution: skip, rename, overwrite
- Human-readable error messages

## Part 2: Stress Test Ladder

Create `scripts/stress-ladder.ts`:

Five tiers run sequentially. Each must pass before the next starts.

Tier 1: 1,000 files — warmup
Tier 2: 5,000 files — small
Tier 3: 10,000 files — medium
Tier 4: 25,000 files — large
Tier 5: 50,000 files — stress

For each tier:
1. Create N temporary files (1KB each with fake dates)
2. Include 5% junk files, 10% duplicates
3. Run scan pipeline (discovery + EXIF extraction)
4. Run organize pipeline
5. Assert file counts, memory limits
6. Clean up

Memory limits:
- Tier 1: RSS < 300 MB
- Tier 2: RSS < 400 MB
- Tier 3: RSS < 500 MB
- Tier 4: RSS < 700 MB
- Tier 5: RSS < 1000 MB

Memory growth analysis: per-file cost should NOT accelerate. Tier 5 per-file cost should be <= Tier 1 per-file cost.

IMPORTANT: The stress test needs to run inside Electron (for better-sqlite3 native module compatibility). Create a runner script that boots Electron in headless mode.

Also run GC + db.pragma('shrink_memory') between scan and organize phases to get accurate organize-only memory readings.

package.json: `"stress:ladder": "node scripts/_run-stress.cjs scripts/stress-ladder.ts"`

## Part 3: Smoke Test

Create `scripts/smoke-test.ts`:

Quick 10-step validation:
1. Scanner finds files
2. EXIF extraction returns dates
3. Junk detection flags thumbnails
4. Hashing produces consistent results
5. Dupe detection finds known dupes
6. Date-based organization copies correctly
7. Operation log written
8. Undo reverses operation
9. Settings round-trip correctly
10. Pattern tokens resolve

Run with: `npm run smoke`
Exit 0 on pass, 1 on fail.

## Part 4: Final Hardening

### Input Sanitization
- Sanitize all file paths before operations
- Escape SQL parameters (parameterized queries everywhere)
- Validate folder pattern tokens

### Process Safety
- Single instance lock (app.requestSingleInstanceLock)
- Graceful shutdown: close exiftool, checkpoint DB, kill workers on app.on('before-quit')
- Timeout safety net: max 30min for scan discovery, 4hr for organize

### Database Resilience
- Health check on startup (pragma quick_check)
- WAL checkpoint every 60 seconds during operations
- Auto-create database if missing
- Handle corrupt DB: backup corrupt file, create fresh, warn user

### Disk Space Check
- Before organize: estimate required space from SUM(size)
- Warn if destination has less than 110% of required
- Block if less than 100%

## Done Criteria

1. All unit tests pass
2. Stress ladder passes 5/5 tiers
3. Memory growth analysis shows no linear leak
4. Smoke test passes all 10 steps
5. Input sanitization in place
6. Database health check on startup
7. Disk space check before organize
8. Graceful shutdown handlers registered
9. `npm run dist` produces installer
10. App handles 50K files without crashing in stress test
