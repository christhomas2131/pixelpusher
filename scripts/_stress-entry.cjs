'use strict';

// Entry point: Electron loads this as its main file.
// Arg: path to TypeScript script exporting run().
// Uses tsx/cjs to run TypeScript directly in Electron's process.

const path = require('path');
const { app } = require('electron');

// Suppress Electron window warnings
app.commandLine.appendSwitch('no-sandbox');

// Register tsx for TypeScript execution
try {
  require('tsx/cjs');
} catch (err) {
  console.error('tsx not found — run: npm install -D tsx');
  process.exit(1);
}

app.whenReady().then(async () => {
  const scriptArg = process.argv.find((a, i) => i >= 2 && a.endsWith('.ts'));
  if (!scriptArg) {
    console.error('Usage: electron _stress-entry.cjs <script.ts>');
    app.quit();
    process.exit(1);
  }

  const scriptPath = path.isAbsolute(scriptArg)
    ? scriptArg
    : path.join(process.cwd(), scriptArg);

  try {
    const mod = require(scriptPath);
    const runFn = mod.run || mod.default?.run;
    if (typeof runFn !== 'function') {
      throw new Error(`Script must export a run() function: ${scriptPath}`);
    }
    await runFn();
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('\n✗  FAILED:', err.message || err);
    app.quit();
    process.exit(1);
  }
});

// Prevent Electron from quitting when no windows are open
app.on('window-all-closed', () => {});
