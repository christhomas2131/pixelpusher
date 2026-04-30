'use strict';

/**
 * Runner: node scripts/_run-stress.cjs <script.ts>
 * Launches Electron headlessly, loads _stress-entry.cjs which uses tsx
 * to execute the TypeScript script in Electron's main process.
 * Required for native modules (better-sqlite3, sharp) built for Electron.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptArg = process.argv[2];
if (!scriptArg) {
  console.error('Usage: node scripts/_run-stress.cjs <script.ts>');
  process.exit(1);
}

const scriptPath = path.isAbsolute(scriptArg)
  ? scriptArg
  : path.join(process.cwd(), scriptArg);

if (!fs.existsSync(scriptPath)) {
  console.error(`Script not found: ${scriptPath}`);
  process.exit(1);
}

const electronBin = require('electron');
const entryScript = path.join(__dirname, '_stress-entry.cjs');

console.log(`Launching Electron: ${path.basename(scriptPath)}`);

const result = spawnSync(electronBin, [entryScript, scriptPath], {
  stdio:  'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    // Pass GC flag so stress test can call global.gc()
    ELECTRON_EXTRA_LAUNCH_ARGS: '--js-flags=--expose-gc',
  },
});

process.exit(result.status ?? 0);
