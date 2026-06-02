import { _electron as electron, test, expect, type ElectronApplication } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

// The compiled main entry point. `npm run build` produces this; the CI step
// and the `pretest:e2e` script both run the build before invoking Playwright.
const MAIN_ENTRY = path.resolve(__dirname, '../../dist/main/main/index.js');

async function launchApp(): Promise<{ app: ElectronApplication; tmpHome: string }> {
  // Isolate user data so the e2e run cannot touch the real ~/.photomove directory
  // (DB, logs, license file, settings). `os.homedir()` reads HOME on Unix.
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelpusher-e2e-'));

  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      HOME: tmpHome,
      // Force packaged-style file load (skips the dev-server URL branch in main/index.ts).
      NODE_ENV: 'test',
      // Disable Sentry in tests even if a DSN happens to be in the env.
      SENTRY_DSN: '',
      PIXELPUSHER_SENTRY_DSN: '',
    },
  });

  return { app, tmpHome };
}

test('launches and renders the main window', async () => {
  const { app, tmpHome } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expect(win).toHaveTitle('PixelPusher');

    // Renderer mounted the React tree at #root.
    const root = win.locator('#root');
    await expect(root).toBeVisible();

    // ErrorBoundary should not have caught anything during boot.
    const errorBoundary = win.locator('[data-testid="error-boundary"]');
    await expect(errorBoundary).toHaveCount(0);
  } finally {
    await app.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('main process menu has a darwin App menu', async () => {
  // Skip on non-darwin: the App menu only appears on macOS.
  test.skip(process.platform !== 'darwin', 'macOS-only menu structure');

  const { app, tmpHome } = await launchApp();
  try {
    await app.firstWindow();

    const menuLabels = await app.evaluate(({ Menu }) => {
      const m = Menu.getApplicationMenu();
      return m?.items.map((item) => item.label) ?? [];
    });

    // First item is the App menu (label = app.name = 'PixelPusher').
    expect(menuLabels[0]).toBe('PixelPusher');
    // Standard Mac menus follow.
    expect(menuLabels).toEqual(
      expect.arrayContaining(['File', 'Edit', 'View', 'Window', 'Help'])
    );
  } finally {
    await app.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
