import { contextBridge, ipcRenderer } from 'electron';
import { ElectronAPI } from '../shared/types';

const api: ElectronAPI = {
  // ── Scan ────────────────────────────────────────────────────────────────────
  startScan:    (options)    => ipcRenderer.invoke('scan:start', options),
  cancelScan:   ()           => ipcRenderer.invoke('scan:cancel'),

  // ── Files ───────────────────────────────────────────────────────────────────
  getFilesPage:  (request)   => ipcRenderer.invoke('files:getPage', request),
  getFileCounts: (sessionId) => ipcRenderer.invoke('files:getCounts', sessionId),

  // ── Organize ─────────────────────────────────────────────────────────────────
  startOrganize:      (options)    => ipcRenderer.invoke('organize:start', options),
  dryRunOrganize:     (options)    => ipcRenderer.invoke('organize:dryRun', options),
  cancelOrganize:     ()           => ipcRenderer.invoke('organize:cancel'),
  undoOrganize:       (sessionId)  => ipcRenderer.invoke('organize:undo', sessionId),
  getOrganizeHistory: ()           => ipcRenderer.invoke('organize:getHistory'),

  // ── Hash & Dupes ─────────────────────────────────────────────────────────────
  startHash:       (sessionId)              => ipcRenderer.invoke('hash:start', sessionId),
  cancelHash:      ()                       => ipcRenderer.invoke('hash:cancel'),
  getDupeGroups:   (sessionId, page, size)  => ipcRenderer.invoke('dupe:getGroups', sessionId, page, size),
  resolveGroup:    (gId, keepId, action)    => ipcRenderer.invoke('dupe:resolveGroup', gId, keepId, action),
  autoResolveAll:  (sessionId, action)      => ipcRenderer.invoke('dupe:autoResolveAll', sessionId, action),

  // ── Takeout ───────────────────────────────────────────────────────────────────
  checkTakeout:  (folder)  => ipcRenderer.invoke('takeout:check', folder),

  // ── License ───────────────────────────────────────────────────────────────────
  getLicense:        ()           => ipcRenderer.invoke('license:get'),
  activateLicense:   (key, email) => ipcRenderer.invoke('license:activate', key, email),
  deactivateLicense: ()           => ipcRenderer.invoke('license:deactivate'),

  // ── Report ────────────────────────────────────────────────────────────────────
  exportReport: (sessionId) => ipcRenderer.invoke('report:export', sessionId),

  // ── Settings / dialogs ───────────────────────────────────────────────────────
  getSettings:      ()           => ipcRenderer.invoke('settings:get'),
  saveSettings:     (settings)   => ipcRenderer.invoke('settings:save', settings),
  openFolderDialog: ()           => ipcRenderer.invoke('dialog:openFolder'),
  getPictures:      ()           => ipcRenderer.invoke('dialog:getPictures'),
  openLogFolder:    ()           => ipcRenderer.invoke('shell:openLogFolder'),
  openPath:         (p)          => ipcRenderer.invoke('shell:openPath', p),

  // ── Scan events ──────────────────────────────────────────────────────────────
  onScanProgress: (cb) => {
    const h = (_: Electron.IpcRendererEvent, p: Parameters<typeof cb>[0]) => cb(p);
    ipcRenderer.on('scan:progress', h);
    return () => ipcRenderer.removeListener('scan:progress', h);
  },
  onScanComplete: (cb) => {
    const h = (_: Electron.IpcRendererEvent, r: Parameters<typeof cb>[0]) => cb(r);
    ipcRenderer.on('scan:complete', h);
    return () => ipcRenderer.removeListener('scan:complete', h);
  },
  onScanError: (cb) => {
    const h = (_: Electron.IpcRendererEvent, msg: string) => cb(msg);
    ipcRenderer.on('scan:error', h);
    return () => ipcRenderer.removeListener('scan:error', h);
  },

  // ── Organize events ──────────────────────────────────────────────────────────
  onOrganizeProgress: (cb) => {
    const h = (_: Electron.IpcRendererEvent, p: Parameters<typeof cb>[0]) => cb(p);
    ipcRenderer.on('organize:progress', h);
    return () => ipcRenderer.removeListener('organize:progress', h);
  },
  onOrganizeComplete: (cb) => {
    const h = (_: Electron.IpcRendererEvent, r: Parameters<typeof cb>[0]) => cb(r);
    ipcRenderer.on('organize:complete', h);
    return () => ipcRenderer.removeListener('organize:complete', h);
  },
  onOrganizeError: (cb) => {
    const h = (_: Electron.IpcRendererEvent, msg: string) => cb(msg);
    ipcRenderer.on('organize:error', h);
    return () => ipcRenderer.removeListener('organize:error', h);
  },

  // ── Hash events ───────────────────────────────────────────────────────────────
  onHashProgress: (cb) => {
    const h = (_: Electron.IpcRendererEvent, p: Parameters<typeof cb>[0]) => cb(p);
    ipcRenderer.on('hash:progress', h);
    return () => ipcRenderer.removeListener('hash:progress', h);
  },
  onHashComplete: (cb) => {
    const h = (_: Electron.IpcRendererEvent, r: Parameters<typeof cb>[0]) => cb(r);
    ipcRenderer.on('hash:complete', h);
    return () => ipcRenderer.removeListener('hash:complete', h);
  },
  onHashError: (cb) => {
    const h = (_: Electron.IpcRendererEvent, msg: string) => cb(msg);
    ipcRenderer.on('hash:error', h);
    return () => ipcRenderer.removeListener('hash:error', h);
  },

  // ── Heartbeat ────────────────────────────────────────────────────────────────
  onHeartbeat: (cb) => {
    const h = (_: Electron.IpcRendererEvent, ts: number) => cb(ts);
    ipcRenderer.on('heartbeat', h);
    return () => ipcRenderer.removeListener('heartbeat', h);
  },

  // ── Theme change (from menu or OS) ────────────────────────────────────────────
  onThemeChanged: (cb) => {
    const menuH = (_: Electron.IpcRendererEvent, theme: Parameters<typeof cb>[0]) => cb(theme);
    const nativeH = () => cb('system');
    ipcRenderer.on('menu:themeChanged', menuH);
    ipcRenderer.on('native:themeChanged', nativeH);
    return () => {
      ipcRenderer.removeListener('menu:themeChanged', menuH);
      ipcRenderer.removeListener('native:themeChanged', nativeH);
    };
  },

  // ── New session (from menu) ───────────────────────────────────────────────────
  onNewSession: (cb) => {
    const h = () => cb();
    ipcRenderer.on('menu:newSession', h);
    return () => ipcRenderer.removeListener('menu:newSession', h);
  },

  // ── Platform info ────────────────────────────────────────────────────────────
  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', api);
