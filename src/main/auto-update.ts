// Wires electron-updater to the existing logger and gates check-for-updates
// to packaged builds only (so dev sessions don't ping the publish target).
//
// On macOS, electron-updater verifies the downloaded bundle's signature against
// the running app's signature. With the current ad-hoc signing (`identity: "-"`)
// updates will refuse to install — proper Developer ID signing must be in place
// for end-to-end auto-update to work. See electron-builder.yml `mac.identity`.

import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { logger } from './logger';

let initialized = false;

const updaterLogger = {
  info:  (msg: any) => logger.info('updater', String(msg)),
  warn:  (msg: any) => logger.warn('updater', String(msg)),
  error: (msg: any) => logger.error('updater', String(msg)),
  debug: (msg: any) => logger.debug('updater', String(msg)),
};

export function initAutoUpdate(getWindow: () => BrowserWindow | null): void {
  if (initialized) return;
  if (!app.isPackaged) {
    logger.info('updater', 'Skipped: app is not packaged (dev build)');
    return;
  }

  autoUpdater.logger = updaterLogger as any;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    logger.info('updater', 'Checking for update…');
  });
  autoUpdater.on('update-available', (info) => {
    logger.info('updater', `Update available: ${info.version}`);
  });
  autoUpdater.on('update-not-available', () => {
    logger.info('updater', 'No update available');
  });
  autoUpdater.on('error', (err) => {
    logger.error('updater', `Update error: ${err?.message ?? err}`);
  });
  autoUpdater.on('download-progress', (p) => {
    logger.info('updater', `Downloading update: ${Math.round(p.percent)}%`);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    logger.info('updater', `Update downloaded: ${info.version} — prompting user`);
    const win = getWindow();
    const { response } = await dialog.showMessageBox(win ?? undefined as any, {
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Ready',
      message: `PixelPusher ${info.version} is ready to install.`,
      detail: 'The app will restart and apply the update. You can also wait — it will install next time you quit.',
    });
    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    logger.error('updater', `Initial check failed: ${err?.message ?? err}`);
  });

  initialized = true;
}
