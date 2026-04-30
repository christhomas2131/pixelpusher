import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { logger } from './logger';
import { buildMenu } from './menu';
import { registerIpcHandlers } from './ipc-handlers';
import { startMemoryWatchdog, stopMemoryWatchdog } from './memory-watchdog';
import { getSettings, saveSettings } from './settings-manager';
import { checkpointDb, closeDb } from './database';
import { closeExiftool } from './exif-reader';
import { getLicenseInfo, activateLicense } from './license-manager';
import { initAutoUpdate } from './auto-update';
import { initCrashReporter } from './crash-reporter';

// Crash reporter first so it captures errors from everything else, including
// the heap flag below if it ever throws. No-ops if SENTRY_DSN is unset.
initCrashReporter();

// In packaged builds CFBundleName provides this; in dev/test runs Electron
// would otherwise default to "Electron", which leaks into the macOS App menu.
app.setName('PixelPusher');

// Must be first — raises heap from 1.5GB to 4GB
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096 --expose-gc');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;

function getWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return null;
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) return;

  const settings = getSettings();
  const bounds = settings.windowBounds;

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'PixelPusher',
    icon: app.isPackaged
      ? undefined
      : path.join(__dirname, '../../../build/icon.png'),
    show: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds();
      const s = getSettings();
      saveSettings({ ...s, windowBounds: b });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.fatal('crash', `Renderer crashed: ${details.reason}`);
    if (details.reason === 'crashed' || details.reason === 'oom') {
      createWindow();
    }
  });

  if (process.env.NODE_ENV === 'development' && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  const menu = buildMenu(getWindow);
  Menu.setApplicationMenu(menu);
}

process.on('uncaughtException', (err) => {
  logger.logFatal('crash', `Uncaught exception: ${err.message}`, err);
  logger.flushSync();
  // Give stream time to flush, then force-exit so the process doesn't hang silently
  setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.logFatal('crash', `Unhandled rejection: ${err.message}`, err);
  logger.flushSync();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!getWindow()) createWindow();
});

app.on('before-quit', async () => {
  stopMemoryWatchdog();
  await closeExiftool();
  closeDb();
  const mem = process.memoryUsage();
  logger.info('app', `Graceful shutdown  heap=${Math.round(mem.heapUsed/1024/1024)}MB rss=${Math.round(mem.rss/1024/1024)}MB`);
  logger.flushSync();
});

app.on('will-quit', () => {
  // will-quit fires after all windows closed, just before process exits
  logger.info('app', `Process exiting cleanly  PID=${process.pid}`);
  logger.flushSync();
});

app.whenReady().then(() => {
  logger.logStartup(app.getVersion());

  // Auto-activate dev license in unpackaged builds
  if (!app.isPackaged) {
    const info = getLicenseInfo();
    if (info.status !== 'valid') {
      activateLicense('PXLP-DEV0-0000-0000-0000', 'dev');
      logger.info('license', 'Dev license auto-activated');
    }
  }

  // License status — log to file and console
  const _licInfo = getLicenseInfo();
  const _licSummary = `status=${_licInfo.status} pro=${_licInfo.status === 'valid'} dev=${_licInfo.developer ?? false} packaged=${app.isPackaged}`;
  logger.info('license', _licSummary);
  console.log('[LICENSE]', {
    key: _licInfo.key?.slice(0, 14) ?? 'none',
    status: _licInfo.status,
    isPro: _licInfo.status === 'valid',
    developer: _licInfo.developer ?? false,
    isPackaged: app.isPackaged,
  });

  registerIpcHandlers(getWindow);
  createWindow();
  startMemoryWatchdog();
  initAutoUpdate(getWindow);

  setInterval(() => {
    const win = getWindow();
    if (win) win.webContents.send('heartbeat', Date.now());
  }, 5000);

  // WAL checkpoint every 60 seconds to keep DB file size manageable
  setInterval(() => { checkpointDb(); }, 60_000);
});
