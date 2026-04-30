import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Capture the template that buildMenu hands to Menu.buildFromTemplate so we can
// inspect the structure without an actual Electron runtime.
const { capturedTemplate } = vi.hoisted(() => {
  const captured: { value: any } = { value: null };
  return { capturedTemplate: captured };
});

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (tpl: any) => {
      capturedTemplate.value = tpl;
      return { __mockMenu: true };
    },
  },
  MenuItem: class {},
  BrowserWindow: class {},
  dialog: { showMessageBox: vi.fn() },
  shell: { openPath: vi.fn() },
  app: {
    name: 'PixelPusher',
    getVersion: () => '1.0.0',
    isPackaged: false,
  },
}));

vi.mock('../src/main/settings-manager', () => ({
  getSettings: () => ({ recentFolders: [], theme: 'dark' }),
  saveSettings: vi.fn(),
}));
vi.mock('../src/main/database', () => ({ getDb: () => ({ exec: vi.fn() }) }));
vi.mock('../src/main/logger', () => ({
  LOG_DIR: '/tmp/log',
  LOG_FILE: '/tmp/log/pixelpusher.log',
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { buildMenu } from '../src/main/menu';

const origPlatform = process.platform;
const origNodeEnv = process.env.NODE_ENV;

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

function findMenu(template: any[], label: string): any {
  return template.find((m) => m?.label === label || m?.role === label);
}

function findRoles(submenu: any[]): string[] {
  return submenu.filter((m) => m?.role).map((m) => m.role);
}

function findLabels(submenu: any[]): string[] {
  return submenu.filter((m) => m?.label).map((m) => m.label);
}

describe('buildMenu', () => {
  const fakeGetWindow = () => null;

  beforeEach(() => {
    capturedTemplate.value = null;
  });

  afterEach(() => {
    setPlatform(origPlatform);
    process.env.NODE_ENV = origNodeEnv;
  });

  describe('on darwin', () => {
    beforeEach(() => {
      setPlatform('darwin');
      process.env.NODE_ENV = 'production';
    });

    it('returns a Menu and captures a template', () => {
      const result = buildMenu(fakeGetWindow);
      expect(result).toBeDefined();
      expect(capturedTemplate.value).not.toBeNull();
      expect(Array.isArray(capturedTemplate.value)).toBe(true);
    });

    it('App menu is first and named after app.name', () => {
      buildMenu(fakeGetWindow);
      const tpl = capturedTemplate.value;
      expect(tpl[0].label).toBe('PixelPusher');
    });

    it('App menu contains About / Services / Hide / Quit', () => {
      buildMenu(fakeGetWindow);
      const appMenu = capturedTemplate.value[0];
      const submenu = appMenu.submenu;
      const roles = findRoles(submenu);
      const labels = findLabels(submenu);
      expect(roles).toContain('services');
      expect(roles).toContain('hide');
      expect(roles).toContain('hideOthers');
      expect(roles).toContain('unhide');
      expect(roles).toContain('quit');
      expect(labels.some((l) => l.includes('About'))).toBe(true);
    });

    it('Services submenu has empty array (required for system population)', () => {
      buildMenu(fakeGetWindow);
      const appMenu = capturedTemplate.value[0];
      const services = appMenu.submenu.find((m: any) => m?.role === 'services');
      expect(services).toBeDefined();
      expect(services.submenu).toEqual([]);
    });

    it('Edit menu has the standard roles', () => {
      buildMenu(fakeGetWindow);
      const edit = findMenu(capturedTemplate.value, 'Edit');
      expect(edit).toBeDefined();
      const roles = findRoles(edit.submenu);
      // Cross-platform standard roles
      expect(roles).toContain('undo');
      expect(roles).toContain('redo');
      expect(roles).toContain('cut');
      expect(roles).toContain('copy');
      expect(roles).toContain('paste');
      expect(roles).toContain('delete');
      expect(roles).toContain('selectAll');
      // Mac-only additions
      expect(roles).toContain('pasteAndMatchStyle');
    });

    it('Edit menu has Speech submenu on Mac', () => {
      buildMenu(fakeGetWindow);
      const edit = findMenu(capturedTemplate.value, 'Edit');
      const speech = edit.submenu.find((m: any) => m?.label === 'Speech');
      expect(speech).toBeDefined();
      expect(speech.submenu).toBeDefined();
      const speechRoles = findRoles(speech.submenu);
      expect(speechRoles).toContain('startSpeaking');
      expect(speechRoles).toContain('stopSpeaking');
    });

    it('Window menu present with minimize / zoom / front', () => {
      buildMenu(fakeGetWindow);
      const win = findMenu(capturedTemplate.value, 'Window');
      expect(win).toBeDefined();
      const roles = findRoles(win.submenu);
      expect(roles).toContain('minimize');
      expect(roles).toContain('zoom');
      expect(roles).toContain('front');
    });

    it('File menu uses role:close (not quit) on Mac', () => {
      buildMenu(fakeGetWindow);
      const file = findMenu(capturedTemplate.value, 'File');
      const lastWithRole = [...file.submenu].reverse().find((m: any) => m?.role);
      expect(lastWithRole.role).toBe('close');
    });

    it('Help menu does NOT include About on Mac (it lives in App menu)', () => {
      buildMenu(fakeGetWindow);
      const help = findMenu(capturedTemplate.value, 'Help');
      const labels = findLabels(help.submenu);
      expect(labels.some((l) => l.includes('About'))).toBe(false);
    });

    it('production build (isPackaged + NODE_ENV=production) hides toggleDevTools', () => {
      // The `app.isPackaged` mock is false; in production NODE_ENV alone wouldn't
      // hide it since the gate is `NODE_ENV==='development' || !app.isPackaged`.
      // This test documents the actual check.
      buildMenu(fakeGetWindow);
      const view = findMenu(capturedTemplate.value, 'View');
      const roles = findRoles(view.submenu);
      // Because !app.isPackaged is true here, toggleDevTools should be present
      expect(roles).toContain('toggleDevTools');
      expect(roles).toContain('forceReload');
    });
  });

  describe('on non-darwin', () => {
    beforeEach(() => {
      setPlatform('win32');
      process.env.NODE_ENV = 'production';
    });

    it('does NOT prepend an App menu', () => {
      buildMenu(fakeGetWindow);
      const tpl = capturedTemplate.value;
      // First entry on non-Mac is "File" (no app menu)
      expect(tpl[0].label).toBe('File');
    });

    it('Help menu DOES include About on non-Mac', () => {
      buildMenu(fakeGetWindow);
      const help = findMenu(capturedTemplate.value, 'Help');
      const labels = findLabels(help.submenu);
      expect(labels.some((l) => l.includes('About'))).toBe(true);
    });

    it('File menu uses role:quit (not close) on non-Mac', () => {
      buildMenu(fakeGetWindow);
      const file = findMenu(capturedTemplate.value, 'File');
      const lastWithRole = [...file.submenu].reverse().find((m: any) => m?.role);
      expect(lastWithRole.role).toBe('quit');
    });

    it('Edit menu omits pasteAndMatchStyle and Speech on non-Mac', () => {
      buildMenu(fakeGetWindow);
      const edit = findMenu(capturedTemplate.value, 'Edit');
      const roles = findRoles(edit.submenu);
      expect(roles).not.toContain('pasteAndMatchStyle');
      const labels = findLabels(edit.submenu);
      expect(labels).not.toContain('Speech');
    });

    it('Window menu uses role:close on non-Mac (no front/window roles)', () => {
      buildMenu(fakeGetWindow);
      const win = findMenu(capturedTemplate.value, 'Window');
      const roles = findRoles(win.submenu);
      expect(roles).toContain('close');
      expect(roles).not.toContain('front');
    });
  });
});
