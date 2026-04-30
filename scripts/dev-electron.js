const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const MAIN_FILE = path.join(__dirname, '../dist/main/main/index.js');
const RENDERER_URL = 'http://localhost:3000';
const POLL_INTERVAL = 500;
const INITIAL_DELAY = 1000;

function waitFor(file, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (fs.existsSync(file)) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(iv);
        reject(new Error(`Timeout waiting for ${file}`));
      }
    }, POLL_INTERVAL);
  });
}

async function start() {
  console.log('[dev-electron] Waiting for main process build…');
  try {
    await waitFor(MAIN_FILE);
  } catch (err) {
    console.error('[dev-electron]', err.message);
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, INITIAL_DELAY));

  console.log('[dev-electron] Launching Electron…');

  const electronBin = require('electron');
  const proc = spawn(electronBin, ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_RENDERER_URL: RENDERER_URL,
    },
  });

  proc.on('exit', (code) => {
    console.log(`[dev-electron] Electron exited (code=${code})`);
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    proc.kill('SIGINT');
  });
  process.on('SIGTERM', () => {
    proc.kill('SIGTERM');
  });
}

start().catch(err => {
  console.error('[dev-electron]', err);
  process.exit(1);
});
