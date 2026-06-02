import fs from 'fs';
import path from 'path';
import os from 'os';
import { AppSettings } from '../shared/types';

const SETTINGS_PATH = path.join(os.homedir(), '.photomove', 'settings.json');

const DEFAULTS: AppSettings = {
  lastSourceFolders: [],
  lastDestination: '',
  folderPattern: '{YYYY}/{MMM}',
  operationMode: 'copy',
  conflictStrategy: 'rename',
  scanDepth: 'quick',
  scanSpeed: 'balanced',
  theme: 'dark',
  enabledFileCategories: ['images', 'videos'],
  recentFolders: [],
  windowBounds: null,
  leftPanelWidth: 280,
  mode: 'photos',
};

// Cheap type-narrowing so a malformed settings.json (manually edited, or
// imported from a future version) can't poison the renderer with e.g.
// `theme: 42`. Anything that fails the predicate falls back to the default.
function validateSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  const VALID_THEMES = new Set(['dark', 'light', 'pusher', 'system']);
  const VALID_MODES  = new Set(['photos', 'datahoarder']);
  const VALID_OP     = new Set(['copy', 'move']);
  const VALID_CONF   = new Set(['rename', 'skip', 'overwrite']);
  const VALID_DEPTH  = new Set(['quick', 'full']);
  const VALID_SPEED  = new Set(['safe', 'balanced', 'fast']);
  const isStringArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

  const out: AppSettings = { ...DEFAULTS };
  if (isStringArr(r.lastSourceFolders))            out.lastSourceFolders   = r.lastSourceFolders;
  if (typeof r.lastDestination === 'string')       out.lastDestination     = r.lastDestination;
  if (typeof r.folderPattern === 'string')         out.folderPattern       = r.folderPattern;
  if (typeof r.operationMode === 'string' && VALID_OP.has(r.operationMode))     out.operationMode    = r.operationMode as AppSettings['operationMode'];
  if (typeof r.conflictStrategy === 'string' && VALID_CONF.has(r.conflictStrategy)) out.conflictStrategy = r.conflictStrategy as AppSettings['conflictStrategy'];
  if (typeof r.scanDepth === 'string' && VALID_DEPTH.has(r.scanDepth))          out.scanDepth        = r.scanDepth as AppSettings['scanDepth'];
  if (typeof r.scanSpeed === 'string' && VALID_SPEED.has(r.scanSpeed))          out.scanSpeed        = r.scanSpeed as AppSettings['scanSpeed'];
  if (typeof r.theme === 'string' && VALID_THEMES.has(r.theme))                 out.theme            = r.theme as AppSettings['theme'];
  if (typeof r.mode === 'string' && VALID_MODES.has(r.mode))                    out.mode             = r.mode as AppSettings['mode'];
  if (isStringArr(r.enabledFileCategories))                                     out.enabledFileCategories = r.enabledFileCategories as AppSettings['enabledFileCategories'];
  if (isStringArr(r.recentFolders))                                             out.recentFolders    = r.recentFolders;
  if (typeof r.leftPanelWidth === 'number' && r.leftPanelWidth > 0)             out.leftPanelWidth   = r.leftPanelWidth;
  if (r.windowBounds && typeof r.windowBounds === 'object') {
    const b = r.windowBounds as Record<string, unknown>;
    if (typeof b.x === 'number' && typeof b.y === 'number' && typeof b.width === 'number' && typeof b.height === 'number') {
      out.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
  }
  return out;
}

export function getSettings(): AppSettings {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return { ...DEFAULTS };
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const merged = validateSettings(parsed);
    // Migrate: 'system' was the old default; new default is 'dark'
    if (merged.theme === 'system') {
      merged.theme = 'dark';
      saveSettings(merged);
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: AppSettings): void {
  const dir = path.dirname(SETTINGS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  // Atomic write: writeFileSync isn't atomic — a crash mid-write corrupts
  // settings.json. Stage to .tmp then rename (atomic on POSIX and Windows
  // for same-filesystem targets).
  const tmp = SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_PATH);
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const updated = { ...current, ...partial };
  saveSettings(updated);
  return updated;
}

export function addRecentFolder(folder: string): void {
  const settings = getSettings();
  const recent = [folder, ...settings.recentFolders.filter(f => f !== folder)].slice(0, 10);
  saveSettings({ ...settings, recentFolders: recent });
}
