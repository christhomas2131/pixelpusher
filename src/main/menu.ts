import { Menu, MenuItem, BrowserWindow, dialog, shell, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getSettings, saveSettings } from './settings-manager';
import { LOG_DIR, LOG_FILE } from './logger';
import { getDb } from './database';
import { logger } from './logger';
import { Theme } from '../shared/types';

export function buildMenu(getWindow: () => BrowserWindow | null): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => getWindow()?.webContents.send('menu:newSession'),
        },
        {
          label: 'Open Source Folder',
          accelerator: 'CmdOrCtrl+O',
          click: () => getWindow()?.webContents.send('menu:openSource'),
        },
        {
          label: 'Open Destination Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => getWindow()?.webContents.send('menu:openDestination'),
        },
        { type: 'separator' },
        buildRecentFoldersMenu(getWindow),
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Collapse All',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => getWindow()?.webContents.send('menu:collapseAll'),
        },
        {
          label: 'Expand All',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => getWindow()?.webContents.send('menu:expandAll'),
        },
        { type: 'separator' },
        buildThemeMenu(getWindow),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Clear Database',
          click: async () => {
            const win = getWindow();
            if (!win) return;
            const { response } = await dialog.showMessageBox(win, {
              type: 'warning',
              buttons: ['Cancel', 'Clear Database'],
              defaultId: 0,
              cancelId: 0,
              title: 'Clear Database',
              message: 'This will delete all scan sessions and file records.',
              detail: 'This cannot be undone. Your original files are not affected.',
            });
            if (response === 1) {
              try {
                const db = getDb();
                db.exec('DELETE FROM files; DELETE FROM scan_sessions; DELETE FROM operation_progress;');
                logger.info('database', 'Database cleared via menu');
                win.webContents.send('menu:databaseCleared');
              } catch (err) {
                logger.error('database', 'Failed to clear database', String(err));
              }
            }
          },
        },
        {
          label: 'View Logs',
          click: async () => {
            await shell.openPath(LOG_DIR);
          },
        },
        {
          label: 'Clear Old Logs',
          click: async () => {
            const win = getWindow();
            if (!win) return;
            const { response } = await dialog.showMessageBox(win, {
              type: 'question',
              buttons: ['Cancel', 'Clear Old Logs'],
              defaultId: 0,
              cancelId: 0,
              title: 'Clear Old Logs',
              message: 'Delete rotated log files?',
              detail: 'The current log file will be kept. Rotated files (.1 through .4) will be deleted.',
            });
            if (response === 1) {
              let deleted = 0;
              for (let i = 1; i <= 4; i++) {
                const f = `${LOG_FILE}.${i}`;
                if (fs.existsSync(f)) { fs.unlinkSync(f); deleted++; }
              }
              logger.info('app', `Cleared ${deleted} old log file(s) via menu`);
              dialog.showMessageBox(win, {
                type: 'info', title: 'Logs Cleared',
                message: `Deleted ${deleted} old log file${deleted !== 1 ? 's' : ''}.`,
              });
            }
          },
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About PixelPusher',
          click: () => {
            const win = getWindow();
            if (!win) return;
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About PixelPusher',
              message: 'PixelPusher',
              detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}`,
            });
          },
        },
        { type: 'separator' },
        {
          label: 'View Logs',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: async () => {
            await shell.openPath(LOG_DIR);
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

function buildRecentFoldersMenu(getWindow: () => BrowserWindow | null): Electron.MenuItemConstructorOptions {
  const settings = getSettings();
  const recent = settings.recentFolders.slice(0, 10);
  return {
    label: 'Recent Folders',
    submenu: recent.length > 0
      ? recent.map(folder => ({
          label: folder,
          click: () => getWindow()?.webContents.send('menu:openRecentFolder', folder),
        }))
      : [{ label: 'No recent folders', enabled: false }],
  };
}

const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  pusher: 'Pusher Mode',
  system: 'System',
};

function buildThemeMenu(getWindow: () => BrowserWindow | null): Electron.MenuItemConstructorOptions {
  const current = getSettings().theme;
  const themes: Theme[] = ['dark', 'pusher', 'light', 'system'];
  return {
    label: 'Theme',
    submenu: themes.map(t => ({
      label: THEME_LABELS[t],
      type: 'radio' as const,
      checked: current === t,
      click: () => {
        const settings = getSettings();
        saveSettings({ ...settings, theme: t });
        getWindow()?.webContents.send('menu:themeChanged', t);
      },
    })),
  };
}
