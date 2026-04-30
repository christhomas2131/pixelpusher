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

export function getSettings(): AppSettings {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return { ...DEFAULTS };
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...parsed };
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
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
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
