# PixelPusher — Rebuild Phase 2: Metadata Extraction

## Context

Phase 1 is complete: Electron app with SQLite database, file scanner that inserts to DB in batches, paginated preview table, logger, menus, and memory watchdog. The scanner discovers files but doesn't extract metadata yet.

## What to Build

### 1. Two-Phase Scan Architecture

The scan MUST be two distinct phases with a clear boundary:

**Phase 1 — File Discovery (already built in Rebuild Phase 1):**
- Walk directories, insert files to DB with: path, filename, size, extension, category
- Fast, no exiftool, low memory

**Phase 2 — Metadata Extraction (this phase):**
- Query unprocessed files from DB in batches
- Extract metadata via exiftool (or lightweight fallback)
- Update DB rows with results
- Stream progress to renderer

The renderer shows:
"Discovering files... 40,000 found" → then → "Extracting metadata... 14,000 / 40,000 (Wave 14/40)"

### 2. ExifTool Singleton (exif-reader.ts)

CRITICAL RULES (these were discovered through crashes):

```typescript
let _exiftool: ExifTool | null = null;

function getExiftool(maxProcs: number = 1): ExifTool {
  if (!_exiftool) {
    _exiftool = new ExifTool({ 
      maxProcs,
      taskTimeoutMillis: 10000  // 10 second timeout per file
    });
  }
  return _exiftool;
}

async function closeExiftool(): Promise<void> {
  const et = _exiftool;
  _exiftool = null;  // Null FIRST to prevent races
  if (et) {
    await et.end();
    // Safety net: force kill any lingering Perl processes
    if (process.platform === 'win32') {
      try { execSync('taskkill /F /IM perl.exe /T 2>nul', { stdio: 'ignore' }); } catch {}
    }
    await new Promise(r => setTimeout(r, 500)); // Let OS reclaim memory
  }
}
```

NEVER:
- Create more than one ExifTool instance
- Restart exiftool mid-scan (causes zombie Perl processes — this was the #1 crash cause)
- Queue more than batchSize files at once

ALWAYS:
- Call closeExiftool() and AWAIT it when scan completes
- Null the reference before calling .end()
- Handle exiftool death: if all Perl workers die, set _exiftool = null, wait 1s, create new instance, skip the file that killed it

### 3. Batch EXIF Extraction in ipc-handlers.ts

```typescript
async function extractMetadataPhase(sessionId: string, scanDepth: string, scanSpeed: string) {
  const db = getDb();
  const { batchSize, maxProcs } = getScanSpeedConfig(scanSpeed);
  
  // Get total unprocessed count
  const total = db.prepare(
    "SELECT COUNT(*) as count FROM files WHERE scan_session_id = ? AND status = 'pending'"
  ).get(sessionId).count;
  
  let processed = 0;
  let lastId = '';
  
  while (true) {
    // Query next batch from DB
    const batch = db.prepare(
      "SELECT * FROM files WHERE scan_session_id = ? AND status = 'pending' AND id > ? ORDER BY id LIMIT ?"
    ).all(sessionId, lastId, batchSize);
    
    if (batch.length === 0) break;
    
    // Process batch through exiftool
    const results = await Promise.allSettled(
      batch.map(file => extractSingleFile(file, scanDepth))
    );
    
    // Update DB with results (in transaction)
    const updateStmt = db.prepare("UPDATE files SET date_taken=?, date_source=?, camera_make=?, camera_model=?, gps_lat=?, gps_lng=?, width=?, height=?, metadata_depth=?, status=?, error_message=? WHERE id=?");
    const updateBatch = db.transaction((updates) => {
      for (const u of updates) updateStmt.run(...u);
    });
    // ... build updates array from results, call updateBatch(updates)
    
    processed += batch.length;
    lastId = batch[batch.length - 1].id;
    
    // CRITICAL: Yield to event loop — prevents Windows from killing us as "hung"
    await new Promise(r => setImmediate(r));
    
    // Send progress (just numbers, never file objects)
    sendProgress({ processed, total, filesPerSecond: calculateRate() });
    
    // Log every 500 files
    if (processed % 500 === 0) {
      const mem = process.memoryUsage();
      logger.info('exif', `${processed}/${total} | heap=${Math.round(mem.heapUsed/1024/1024)}MB rss=${Math.round(mem.rss/1024/1024)}MB`);
    }
  }
  
  // CRITICAL: Close exiftool after scan, AWAIT it
  await closeExiftool();
  
  // Force GC to release exiftool memory
  if (global.gc) global.gc();
}
```

### 4. Date Fallback Chain

For each file, try dates in this order:

1. EXIF DateTimeOriginal
2. EXIF CreateDate
3. Google JSON sidecar `photoTakenTime` (if Takeout detected)
4. **Filename date parsing** — regex patterns:
   - `YYYY-MM-DD` (e.g., 2025-03-25)
   - `YYYYMMDD` (e.g., 20250325)
   - `YYYY_MM_DD` (e.g., 2025_03_25)
   - `IMG_YYYYMMDD` (e.g., IMG_20250325)
   - `Screenshot YYYY-MM-DD` (e.g., Screenshot 2025-03-25)
5. File modification date (fs.stat mtime) — **this MUST work, every file has mtime**
6. File creation date (fs.stat birthtime)
7. "Unknown Date" (only if fs.stat itself fails)

Set `dateSource` accordingly: 'exif', 'filename', 'modified', 'created', 'unknown'

### 5. Quick Scan vs Full Scan

**Quick Scan (default):**
- Pass `-fast2` flag to exiftool (skips MakerNotes, much faster)
- Only populate: dateTaken, dateSource
- Leave null: cameraMake, cameraModel, gps, width, height
- Set metadata_depth = 'quick'

**Full Scan:**
- Extract all tags
- Populate all fields
- Set metadata_depth = 'full'

### 6. Speed Presets

```typescript
function getScanSpeedConfig(speed: string) {
  switch (speed) {
    case 'safe':     return { batchSize: 20,  maxProcs: 1 };
    case 'balanced': return { batchSize: 50,  maxProcs: 2 };
    case 'fast':     return { batchSize: 100, maxProcs: 3 };
    default:         return { batchSize: 20,  maxProcs: 1 };
  }
}
```

### 7. Junk Detection (junk-detector.ts)

Flag files as junk if ANY match:

**Path-based (high confidence):**
- `**/Thumbnails/**`, `**/Faces/**`, `**/Face Recognition/**`
- `**/iPod Photo Cache/**`, `**/Previews.lrdata/**`
- `**/.picasa_originals/**`, `**/Thumbs/**`
- `**/@eaDir/**`, `**/SYNOFILE_THUMB*/**`, `**/.thumbnails/**`

**Filename-based (high confidence):**
- `Thumbs.db`, `.picasa.ini`, `desktop.ini`
- `*_thumb.*`, `*_small.*`, `*_preview.*`

**Dimension-based (medium confidence):**
- Image under 200x200 pixels

**File size (medium confidence):**
- Image under 50KB

Junk files are FLAGGED, never auto-deleted. Status set to 'junk'.

### 8. Scan UI

The scan screen should show:

```
SOURCE FOLDERS                           + Add Source
┌─────────────────────────────────────────────────────┐
│ 1  D:\Photos\Library                             × │
└─────────────────────────────────────────────────────┘

Scan Depth:  [Quick Scan]  [Full Scan]
Extracts dates only. Fast. Best for large libraries.

Scan Speed:  [Safe]  [Balanced]  [Fast]
Recommended for large libraries or older machines.

[Scan Folder]
```

Progress during scan:
```
[===========--------------------------] 34%
5,900 / 17,446 files — ~12 min remaining
Extracting metadata... Source 2 of 2
```

Unified progress across multiple sources (never resets between sources).
ETA calculated from rolling 30-second average.

### 9. Collapsible Panels

Source, Destination, and Organize Config sections are collapsible:
- Chevron arrow toggle
- Auto-collapse after scan completes
- Collapsed summary: "Source: D:\Photos (8,230 files)"
- 200ms CSS transition
- Collapse All / Expand All button

### 10. External Drive Awareness

Before scan or organize on an external drive:
```typescript
async function assertDriveReady(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.readFileSync(filePath, { flag: 'r', encoding: null }).slice(0, 1);
      return; // Drive is ready
    } catch (err) {
      if (attempt < 2) {
        logger.warn('drive', `Drive not ready, retrying in 15s...`, filePath);
        await new Promise(r => setTimeout(r, 15000));
      }
    }
  }
  throw new Error('Source drive is not ready. Open the folder in File Explorer to wake the drive.');
}
```

## Done Criteria

1. Two-phase scan works: discover then extract
2. ExifTool singleton, no restarts, proper cleanup
3. Batch extraction with yields after every batch
4. All date fallbacks work (EXIF, filename, filesystem)
5. Quick/Full scan toggle works
6. Safe/Balanced/Fast speed presets work
7. Junk detection flags thumbnails and cache files
8. Collapsible panels with auto-collapse
9. Unified multi-source progress with ETA
10. External drive readiness check
11. Memory logged every 500 files
12. `npm run dev` works, scan completes without crash
