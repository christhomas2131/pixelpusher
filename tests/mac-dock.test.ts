import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.mock is hoisted to the top of the file, so any references inside the
// factory must come from vi.hoisted (also hoisted) to be initialized in time.
const { mockSetBadge, mockBounce } = vi.hoisted(() => ({
  mockSetBadge: vi.fn(),
  mockBounce: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    dock: {
      setBadge: mockSetBadge,
      bounce: mockBounce,
    },
  },
  BrowserWindow: class {},
}));

import {
  setDockProgress,
  clearDockProgress,
  setDockBadge,
  clearDockBadge,
  dockBounce,
} from '../src/main/mac-dock';

function makeWin(destroyed = false) {
  const setProgressBar = vi.fn();
  const isDestroyed = vi.fn(() => destroyed);
  return {
    win: { setProgressBar, isDestroyed } as any,
    setProgressBar,
    isDestroyed,
  };
}

const origPlatform = process.platform;
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

describe('mac-dock', () => {
  beforeEach(() => {
    setPlatform('darwin');
    mockSetBadge.mockReset();
    mockBounce.mockReset();
  });

  afterEach(() => {
    setPlatform(origPlatform);
  });

  describe('setDockProgress', () => {
    it('sets fractional progress in [0, 1]', () => {
      const { win, setProgressBar } = makeWin();
      setDockProgress(win, 50, 200);
      expect(setProgressBar).toHaveBeenCalledOnce();
      expect(setProgressBar).toHaveBeenCalledWith(0.25);
    });

    it('clamps progress > 1 to 1', () => {
      const { win, setProgressBar } = makeWin();
      setDockProgress(win, 999, 200);
      expect(setProgressBar).toHaveBeenCalledWith(1);
    });

    it('clamps negative progress to 0', () => {
      const { win, setProgressBar } = makeWin();
      setDockProgress(win, -10, 200);
      expect(setProgressBar).toHaveBeenCalledWith(0);
    });

    it('clears the bar when total <= 0', () => {
      // macOS dock has no indeterminate state — values > 1 are clamped to
      // "complete" (full bar), which is misleading when there's no work
      // measured yet. Clear instead.
      const { win, setProgressBar } = makeWin();
      setDockProgress(win, 0, 0);
      expect(setProgressBar).toHaveBeenCalledWith(-1);
    });

    it('is a no-op on non-darwin', () => {
      setPlatform('win32');
      const { win, setProgressBar } = makeWin();
      setDockProgress(win, 50, 200);
      expect(setProgressBar).not.toHaveBeenCalled();
    });

    it('is a no-op when window is null', () => {
      // Should not throw
      expect(() => setDockProgress(null, 50, 200)).not.toThrow();
    });

    it('is a no-op when window is destroyed', () => {
      const { win, setProgressBar } = makeWin(true);
      setDockProgress(win, 50, 200);
      expect(setProgressBar).not.toHaveBeenCalled();
    });
  });

  describe('clearDockProgress', () => {
    it('calls setProgressBar(-1) on darwin with live window', () => {
      const { win, setProgressBar } = makeWin();
      clearDockProgress(win);
      expect(setProgressBar).toHaveBeenCalledWith(-1);
    });

    it('is a no-op on non-darwin', () => {
      setPlatform('linux');
      const { win, setProgressBar } = makeWin();
      clearDockProgress(win);
      expect(setProgressBar).not.toHaveBeenCalled();
    });

    it('is a no-op when window is null', () => {
      expect(() => clearDockProgress(null)).not.toThrow();
    });

    it('is a no-op when window is destroyed', () => {
      const { win, setProgressBar } = makeWin(true);
      clearDockProgress(win);
      expect(setProgressBar).not.toHaveBeenCalled();
    });
  });

  describe('setDockBadge / clearDockBadge', () => {
    it('forwards text to app.dock.setBadge on darwin', () => {
      setDockBadge('5');
      expect(mockSetBadge).toHaveBeenCalledWith('5');
    });

    it('clearDockBadge sends empty string', () => {
      clearDockBadge();
      expect(mockSetBadge).toHaveBeenCalledWith('');
    });

    it('is a no-op on non-darwin', () => {
      setPlatform('win32');
      setDockBadge('5');
      clearDockBadge();
      expect(mockSetBadge).not.toHaveBeenCalled();
    });
  });

  describe('dockBounce', () => {
    it('forwards to app.dock.bounce with default informational', () => {
      dockBounce();
      expect(mockBounce).toHaveBeenCalledWith('informational');
    });

    it('forwards critical type', () => {
      dockBounce('critical');
      expect(mockBounce).toHaveBeenCalledWith('critical');
    });

    it('is a no-op on non-darwin', () => {
      setPlatform('win32');
      dockBounce();
      expect(mockBounce).not.toHaveBeenCalled();
    });
  });
});
