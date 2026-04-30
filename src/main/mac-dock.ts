import { app, BrowserWindow } from 'electron';

const isMac = process.platform === 'darwin';

export function setDockProgress(win: BrowserWindow | null, processed: number, total: number): void {
  if (!isMac || !win || win.isDestroyed()) return;
  if (total <= 0) {
    win.setProgressBar(2); // indeterminate
    return;
  }
  const v = Math.max(0, Math.min(1, processed / total));
  win.setProgressBar(v);
}

export function clearDockProgress(win: BrowserWindow | null): void {
  if (!isMac || !win || win.isDestroyed()) return;
  win.setProgressBar(-1);
}

export function setDockBadge(text: string): void {
  if (!isMac || !app.dock) return;
  app.dock.setBadge(text);
}

export function clearDockBadge(): void {
  if (!isMac || !app.dock) return;
  app.dock.setBadge('');
}

export function dockBounce(type: 'critical' | 'informational' = 'informational'): void {
  if (!isMac || !app.dock) return;
  app.dock.bounce(type);
}
