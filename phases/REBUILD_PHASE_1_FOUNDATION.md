# PixelPusher — Rebuild Phase 1: Foundation

## What You're Building

PixelPusher is a cross-platform Electron desktop app for photo/video organization. This phase creates the project scaffold, SQLite database, file scanner, preview table, and core infrastructure.

## Tech Stack

- Electron + TypeScript + React
- better-sqlite3 for database
- electron-builder for packaging
- Webpack for renderer bundling

## Step 1: Project Scaffold

Create the project:

```
pixelpusher/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.ts           # App entry, window management, crash handlers
│   │   ├── preload.ts         # Context bridge for IPC
│   │   ├── menu.ts            # Application menus
│   │   ├── database.ts        # SQLite setup and queries
│   │   ├── logger.ts          # File-based rotating logger
│   │   ├── ipc-handlers.ts    # All IPC handlers
│   │   ├── file-scanner.ts    # Recursive file discovery
│   │   ├── exif-reader.ts     # EXIF extraction via exiftool-vendored
│   │   ├── junk-detector.ts   # Thumbnail/cache/junk detection
│   │   ├── file-mover.ts      # Copy/move operations
│   │   ├── operation-log.ts   # Operation session logging
│   │   ├── settings-manager.ts # Settings persistence
│   │   ├── license-manager.ts # License key validation
│   │   └── memory-watchdog.ts # Memory monitoring
│   ├── renderer/              # React UI
│   │   ├── App.tsx
│   │   ├── index.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── context/
│   │   └── styles/
│   └── shared/                # Shared types and constants
│       ├── types.ts
│       ├── constants.ts
│       └── pattern.ts         # Folder pattern token resolver
├── scripts/                   # Stress tests, utilities
├── phases/                    # Build phase documents
├── website/                   # Landing page
├── assets/                    # App icons
├── package.json
├── tsconfig.json
├── tsconfig.main.json
├── webpack.renderer.config.js
├── electron-builder.yml
├── CLAUDE.md
└── README.md
```

Initialize with:
```bash
npm init -y
npm install electron better-sqlite3 exiftool-vendored sharp chokidar
npm install -D typescript @types/node @types/better-sqlite3 @types/react @types/react-dom react react-dom webpack webpack-cli webpack-dev-server ts-loader html-webpack-plugin concurrently electron-builder css-loader style-loader
```

Set up Electron with React and TypeScript. Configure webpack for the renderer. Configure tsconfig for both main and renderer. Make sure `npm run dev` launches the app with hot reload using concurrently.

package.json scripts:
```json
{
  "dev": "concurrently -k -n main,renderer,electron \"npm run dev:main\" \"npm run dev:renderer\" \"npm run dev:electron\"",
  "dev:main": "tsc -p tsconfig.main.json --watch --preserveWatchOutput",
  "dev:renderer": "webpack serve --config webpack.renderer.config.js --mode development",
  "dev:electron": "node scripts/dev-electron.js",
  "build": "npm run build:main && npm run build:renderer",
  "build:main": "tsc -p tsconfig.main.json",
  "build:renderer": "webpack --config webpack.renderer.config.js --mode production",
  "dist": "npm run build && electron-builder",
  "test": "vitest run"
}
```

## Step 2: Main Process Entry Point (index.ts)

CRITICAL configurations that MUST be in index.ts:

```typescript
import { app, BrowserWindow } from 'electron';

// MUST be before app.whenReady() — raises heap from 1.5GB to 4GB
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

// Single instance lock — prevent multiple windows
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); }

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // Guard against duplicate windows
  if (mainWindow && !mainWindow.isDestroyed()) return;
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,     // SECURITY: must be false
      contextIsolation: true,     // SECURITY: must be true
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'PixelPusher',
  });
}

// Crash handlers — log everything before process might die
process.on('uncaughtException', (err) => {
  logger.fatal('crash', 'Uncaught exception', err.stack);
  logger.flushSync();
});
process.on('unhandledRejection', (reason) => {
  logger.fatal('crash', 'Unhandled rejection', String(reason));
  logger.flushSync();
});

// Heartbeat — prevents Windows from killing us as "hung"
setInterval(() => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('heartbeat', Date.now());
  }
}, 5000);

// Renderer crash recovery
mainWindow.webContents.on('render-process-gone', (event, details) => {
  logger.fatal('crash', 'Renderer crashed', details.reason);
  if (details.reason === 'crashed' || details.reason === 'oom') {
    createWindow(); // Recreate window, data is safe in database
  }
});

// Only check for updates when packaged (not in dev mode)
if (app.isPackaged) {
  // auto-updater code here
}
```

## Step 3: SQLite Database (database.ts)

THIS IS THE MOST IMPORTANT FILE. All data lives here, not in memory.

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_DIR = path.join(os.homedir(), '.photomove');
const DB_PATH = path.join(DB_DIR, 'library.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    
    // Performance pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000');  // 64MB cache
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 10000');
    
    createTables();
  }
  return db;
}
```

Schema:
```sql
CREATE TABLE IF NOT EXISTS scan_sessions (
  id TEXT PRIMARY KEY,
  source_folders TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  total_files INTEGER DEFAULT 0,
  total_size INTEGER DEFAULT 0,
  scan_depth TEXT DEFAULT 'quick',
  scan_speed TEXT DEFAULT 'safe',
  status TEXT DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  source_path TEXT NOT NULL,
  proposed_destination TEXT,
  size INTEGER NOT NULL,
  date_source TEXT,
  date_taken TEXT,
  camera_make TEXT,
  camera_model TEXT,
  gps_lat REAL,
  gps_lng REAL,
  width INTEGER,
  height INTEGER,
  format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  junk_reason TEXT,
  junk_confidence TEXT,
  phash TEXT,
  file_category TEXT DEFAULT 'images',
  extended_meta TEXT,
  metadata_depth TEXT DEFAULT 'quick',
  error_message TEXT,
  source_index INTEGER DEFAULT 0,
  source_label TEXT DEFAULT 'Source A',
  scan_session_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_session ON files(scan_session_id);
CREATE INDEX IF NOT EXISTS idx_files_session_status ON files(scan_session_id, status);
CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(scan_session_id, id);
CREATE INDEX IF NOT EXISTS idx_files_phash ON files(phash) WHERE phash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_date ON files(scan_session_id, date_taken);

CREATE TABLE IF NOT EXISTS operation_progress (
  session_id TEXT PRIMARY KEY,
  total_files INTEGER,
  processed_files INTEGER DEFAULT 0,
  successful_files INTEGER DEFAULT 0,
  error_files INTEGER DEFAULT 0,
  skipped_files INTEGER DEFAULT 0,
  last_processed_id TEXT,
  status TEXT DEFAULT 'running',
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Provide these query functions:
- `insertFilesBatch(files[])` — prepared statement in transaction, batch of 500
- `getFilesPaginated(sessionId, offset, limit, sortBy, sortDir, filters)` — for preview table
- `getFileCounts(sessionId)` — returns {total, withDate, unknownDate, junk, byCategory}
- `getUnprocessedFiles(sessionId, limit)` — for EXIF extraction batches
- `updateFileExif(id, data)` — update single file with metadata
- `getFilesForOrganize(sessionId, lastId, limit)` — keyset pagination for organize

## Step 4: File-Based Logger (logger.ts)

Rotating log file at ~/.photomove/logs/pixelpusher.log

```typescript
// Max 10MB per file, keep last 3
// Write via stream, never accumulate
// Format: [2026-03-29 09:15:23] [INFO] [scan] Message here
// Levels: DEBUG, INFO, WARN, ERROR, FATAL
// flushSync() method for crash handlers
// Export as singleton
```

Log at startup: version, platform, arch, total RAM, CPU cores.

## Step 5: File Scanner (file-scanner.ts)

Discovers files on disk. Does NOT extract metadata. Fast.

```typescript
// Recursive directory walk
// Supported formats: .jpg .jpeg .png .tiff .tif .heic .heif .cr2 .nef .arw .dng .webp .bmp .gif .mp4 .mov .avi .mkv .wmv .flv .webm .m4v .3gp
// Skip hidden files/dirs (starting with .)
// Skip system dirs: node_modules, $RECYCLE.BIN, .Trash, @eaDir
// Insert discovered files to database in batches of 500 via transaction
// YIELD after every 500 files: await new Promise(r => setImmediate(r))
// Send progress to renderer every 500 files (just counts, not file objects)
// Never accumulate a full file list in memory
```

## Step 6: Preview Table (renderer)

The preview table MUST paginate from the database:

```typescript
// Request page via IPC: { sessionId, page, pageSize: 100, sortBy, sortDir, filters }
// Renderer holds only the current page in state (max 100 items)
// Summary counts come from SQL COUNT queries, not array.length
// Sorting happens in SQL ORDER BY, not JavaScript
// Filtering happens in SQL WHERE, not Array.filter
```

Columns: Thumb, Type, Filename, Date Taken, Camera, Source, Destination, Size
Show pagination: "1 / 83" with Prev/Next buttons.

## Step 7: Settings Manager (settings-manager.ts)

Store at ~/.photomove/settings.json

Default settings:
```typescript
{
  lastSourceFolders: [],
  lastDestination: '',     // defaults to app.getPath('pictures') in UI
  folderPattern: '{YYYY}/{MMM}',
  operationMode: 'copy',
  conflictStrategy: 'rename',
  scanDepth: 'quick',
  scanSpeed: 'safe',
  theme: 'system',
  enabledFileCategories: ['images', 'videos'],
  recentFolders: [],
  windowBounds: null
}
```

Handle missing/corrupt settings file gracefully — return defaults.

## Step 8: Application Menus (menu.ts)

Build from the start:

**File:** New Session, Open Source Folder (Ctrl+O), Open Destination (Ctrl+Shift+O), Recent Folders submenu, Exit
**View:** Collapse All (Ctrl+Shift+C), Expand All (Ctrl+Shift+E), Dark/Light/System theme radio buttons
**Tools:** Clear Database (with confirmation dialog), View Logs (opens log folder)
**Help:** About PixelPusher

## Step 9: Memory Watchdog (memory-watchdog.ts)

5-level system: normal/elevated/warning/critical/emergency at 500/1000/1500/2000MB.
Log memory every 30 seconds.
Force GC at elevated+.
Detect leaks growing >100MB/min.

## Done Criteria

1. `npm run dev` launches Electron app with React UI
2. SQLite database created with full schema
3. File scanner discovers files and inserts to database in batches
4. Preview table shows paginated results from database
5. Summary counts from SQL queries
6. Logger writes to rotating log file
7. Application menus work
8. Memory watchdog active
9. Crash handlers registered
10. Heartbeat prevents Windows hang
11. Settings persistence works
12. `npm run test` passes (add basic tests for database and pattern functions)
