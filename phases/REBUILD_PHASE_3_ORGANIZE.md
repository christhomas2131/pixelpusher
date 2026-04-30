# PixelPusher — Rebuild Phase 3: Organization Engine

## Context

Phases 1-2 complete: Electron app with SQLite database, file scanner, two-phase metadata extraction, paginated preview table, junk detection, Quick/Full scan, speed presets.

## What to Build

### 1. Folder Pattern System (pattern.ts)

Token resolver — given a file's metadata and a pattern string, produce the destination path.

Available tokens:
- `{YYYY}` — year (2024)
- `{MM}` — month number zero-padded (03)
- `{MMM}` — month name (March)
- `{DD}` — day zero-padded (15)
- `{QUARTER}` — quarter as month range: "Jan - Mar", "Apr - Jun", "Jul - Sep", "Oct - Dec". Append year: "Jan - Mar 2025"
- `{HALF}` — half-year as month range: "Jan - Jun 2025", "Jul - Dec 2025"
- `{YEAR_RANGE}` — multi-year grouping: "2005 - 2009" (configurable range size, default 5)
- `{CAMERA}` — camera model or "Unknown Camera"
- `{TAG}` — AI tag (Phase 5+)
- `{TYPE}` — file category: "images", "videos"
- `{TYPE_LABEL}` — user-customizable label: "Photos", "Videos"
- `{EXT}` — file extension: "jpg", "mp4"

Default pattern: `{YYYY}/{MMM}`
Produces: `2024/March/photo.jpg`

For files with no date: `Unknown Date/photo.jpg`

Pattern config UI shows clickable token buttons and a live preview.

### 2. Destination Folder Picker

- Default to user's Pictures folder: `app.getPath('pictures')`
- NEVER default to the source folder
- Validate: if destination equals any source folder, show warning and reject

### 3. Organize Pipeline (file-mover.ts)

CRITICAL: This is where the app crashed 10+ times in the original build. Every fix is baked in.

```typescript
async function startOrganize(sessionId: string, destination: string, pattern: string, mode: 'copy' | 'move', conflictStrategy: string) {
  const db = getDb();
  
  // Pre-flight: drive readiness check
  await assertDriveReady(destination);
  
  // Get total count
  const total = db.prepare(
    "SELECT COUNT(*) as count FROM files WHERE scan_session_id = ? AND status IN ('ready', 'missing-date')"
  ).get(sessionId).count;
  
  // Save progress for crash recovery
  db.prepare("INSERT OR REPLACE INTO operation_progress VALUES (?,?,0,0,0,0,NULL,'running',datetime('now'))")
    .run(sessionId, total);
  
  // Operation log — stream to disk via WriteStream, NEVER accumulate in array
  const logDir = path.join(os.homedir(), '.photomove', 'operations');
  fs.mkdirSync(logDir, { recursive: true });
  const logStream = fs.createWriteStream(path.join(logDir, `${sessionId}.jsonl`), { flags: 'a' });
  
  let processed = 0;
  let successful = 0;
  let errors = 0;
  let skipped = 0;
  let lastId = '';
  
  // Errors capped at 50 — ring buffer, not unlimited array
  const recentErrors: string[] = [];
  const MAX_ERRORS = 50;
  
  while (true) {
    // KEYSET PAGINATION — never use OFFSET
    const batch = db.prepare(
      "SELECT id, source_path, proposed_destination, filename, size FROM files WHERE scan_session_id = ? AND status IN ('ready', 'missing-date') AND id > ? ORDER BY id LIMIT 100"
    ).all(sessionId, lastId);
    
    if (batch.length === 0) break;
    
    for (const file of batch) {
      const destPath = buildFullDestination(destination, pattern, file);
      const destDir = path.dirname(destPath);
      
      try {
        // Create directory
        fs.mkdirSync(destDir, { recursive: true });
        
        // Handle conflicts
        const finalDest = resolveConflict(destPath, conflictStrategy);
        if (finalDest === null) {
          skipped++;
          db.prepare("UPDATE files SET status = 'skipped' WHERE id = ?").run(file.id);
          continue;
        }
        
        // Copy or move
        if (mode === 'move') {
          await safeMove(file.source_path, finalDest);
        } else {
          await safeCopy(file.source_path, finalDest);
        }
        
        successful++;
        db.prepare("UPDATE files SET status = 'organized' WHERE id = ?").run(file.id);
        
        // Log to disk stream (not memory)
        logStream.write(JSON.stringify({ src: file.source_path, dest: finalDest, status: 'ok' }) + '\n');
        
      } catch (err: any) {
        errors++;
        const errMsg = humanizeFileError(err);
        db.prepare("UPDATE files SET status = 'error', error_message = ? WHERE id = ?").run(errMsg, file.id);
        
        // Bounded error buffer
        if (recentErrors.length >= MAX_ERRORS) recentErrors.shift();
        recentErrors.push(`${file.filename}: ${errMsg}`);
        
        logStream.write(JSON.stringify({ src: file.source_path, dest: destPath, status: 'error', error: errMsg }) + '\n');
      }
      
      processed++;
    }
    
    lastId = batch[batch.length - 1].id;
    
    // CRITICAL: Yield to event loop — Windows kills us without this
    await new Promise(r => setImmediate(r));
    
    // Update progress in DB for crash recovery
    if (processed % 500 === 0) {
      db.prepare("UPDATE operation_progress SET processed_files=?, successful_files=?, error_files=?, skipped_files=?, last_processed_id=?, updated_at=datetime('now') WHERE session_id=?")
        .run(processed, successful, errors, skipped, lastId, sessionId);
    }
    
    // WAL checkpoint every 2000 files
    if (processed % 2000 === 0) {
      db.pragma('wal_checkpoint(PASSIVE)');
    }
    
    // Send progress — ONLY numbers, never arrays
    sendProgress({ processed, total, successful, errors, skipped, currentFile: batch[batch.length - 1]?.filename || '' });
    
    // Log every 500 files
    if (processed % 500 === 0) {
      const mem = process.memoryUsage();
      logger.info('organize', `${processed}/${total} | ok=${successful} err=${errors} | heap=${Math.round(mem.heapUsed/1024/1024)}MB rss=${Math.round(mem.rss/1024/1024)}MB`);
    }
    
    // Force GC between batches
    if (global.gc) global.gc();
  }
  
  logStream.end();
  
  // Mark complete
  db.prepare("UPDATE operation_progress SET status='completed', processed_files=?, successful_files=?, error_files=?, skipped_files=?, updated_at=datetime('now') WHERE session_id=?")
    .run(processed, successful, errors, skipped, sessionId);
  
  // Send completion — summary counts ONLY, not arrays of files
  sendComplete({ processed, total, successful, errors, skipped });
}
```

### 4. Safe File Operations

```typescript
async function safeCopy(src: string, dest: string): Promise<void> {
  // Handle long paths on Windows
  const safeSrc = process.platform === 'win32' ? '\\\\?\\' + path.resolve(src) : src;
  const safeDest = process.platform === 'win32' ? '\\\\?\\' + path.resolve(dest) : dest;
  
  try {
    fs.copyFileSync(safeSrc, safeDest);
    // Preserve timestamps
    const { atime, mtime } = fs.statSync(safeSrc);
    fs.utimesSync(safeDest, atime, mtime);
  } catch (err: any) {
    // Retry once on UNKNOWN (drive spin-down)
    if (err.code === 'UNKNOWN') {
      await new Promise(r => setTimeout(r, 15000));
      fs.copyFileSync(safeSrc, safeDest);
      const { atime, mtime } = fs.statSync(safeSrc);
      fs.utimesSync(safeDest, atime, mtime);
    } else {
      throw err;
    }
  }
}

async function safeMove(src: string, dest: string): Promise<void> {
  try {
    fs.renameSync(src, dest); // Instant for same-drive
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      await safeCopy(src, dest); // Cross-drive: copy then delete
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

function humanizeFileError(err: any): string {
  switch (err.code) {
    case 'EACCES': return 'Permission denied';
    case 'ENOENT': return 'File not found';
    case 'ENOSPC': return 'Disk full';
    case 'EPERM': return 'Operation not permitted';
    case 'EBUSY': return 'File in use';
    case 'UNKNOWN': return 'Drive not ready';
    default: return err.message || 'Unknown error';
  }
}
```

### 5. Undo System

- Operation log in JSONL format (one JSON per line, streamed)
- Undo reads the log and reverses: copy → delete dest; move → move back
- History panel shows past operations with Undo button
- Undo for copy: delete the copies (originals untouched)
- Undo for move: move files back to original paths
- Permanent deletes marked as IRREVERSIBLE

### 6. Organize UI

**Config area (collapsible):**
- Pattern input with token buttons
- Copy / Move toggle (Copy default)
- If File Exists: Skip / Rename / Overwrite dropdown
- "Organize N files" button

**Progress screen:**
- Progress bar with percentage
- "200 / 8,955 files — 758 MB / 44.3 GB — ~12 min remaining"
- Current filename
- Cancel button

**Completion screen:**
- Success icon or error icon
- "N transferred, N skipped, N errors"
- "Open Folder" button (shell.openPath to destination)
- "Export Report" button
- "New Scan" button
- "Done" button

### 7. Skipped Files

Files that fail get:
- status = 'error' in database
- error_message with human-readable reason
- Logged to operation JSONL file
- Shown in completion screen error count
- Expandable error list (capped at 50)

## Done Criteria

1. Folder pattern system with all tokens works
2. Destination defaults to Pictures, validates against source
3. Organize processes files in batches of 100 from database
4. Operation log streams to disk via WriteStream
5. Safe copy/move with drive retry logic
6. Human-readable error messages
7. Undo reverses operations
8. History panel with past operations
9. Progress shows ETA and current file
10. Completion screen with Open Folder button
11. Memory stays flat during 40K organize (verify with logs)
12. Yields after every batch (no Windows hang)
