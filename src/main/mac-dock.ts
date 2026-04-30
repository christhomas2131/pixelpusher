import { app, BrowserWindow } from 'electron';

// process.platform is checked per-call (rather than cached at import time)
// so unit tests can stub it without re-importing the module.
const onMac = () => process.platform === 'darwin';

export function setDockProgress(win: BrowserWindow | null, processed: number, total: number): void {
  if (!onMac() || !win || win.isDestroyed()) return;
  if (total <= 0) {
    win.setProgressBar(2); // indeterminate
    return;
  }
  const v = Math.max(0, Math.min(1, processed / total));
  win.setProgressBar(v);
}

export function clearDockProgress(win: BrowserWindow | null): void {
  if (!onMac() || !win || win.isDestroyed()) return;
  win.setProgressBar(-1);
}

export function setDockBadge(text: string): void {
  if (!onMac() || !app.dock) return;
  app.dock.setBadge(text);
}

export function clearDockBadge(): void {
  if (!onMac() || !app.dock) return;
  app.dock.setBadge('');
}

export function dockBounce(type: 'critical' | 'informational' = 'informational'): void {
  if (!onMac() || !app.dock) return;
  app.dock.bounce(type);
}
