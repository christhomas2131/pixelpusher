import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { AppSettings, Theme, LicenseInfo } from '../../shared/types';

interface AppState {
  settings: AppSettings | null;
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  refreshSettings: () => void;
  license: LicenseInfo | null;
  isPro: boolean;
  refreshLicense: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  lastSourceFolders: [],
  lastDestination: '',
  folderPattern: '{YYYY}/{MMM}',
  operationMode: 'copy',
  conflictStrategy: 'rename',
  scanDepth: 'quick',
  scanSpeed: 'safe',
  theme: 'dark',
  enabledFileCategories: ['images', 'videos'],
  recentFolders: [],
  windowBounds: null,
  leftPanelWidth: 280,
  mode: 'photos',
};

const AppContext = createContext<AppState>({
  settings: null,
  sessionId: null,
  setSessionId: () => {},
  refreshSettings: () => {},
  license: null,
  isPro: false,
  refreshLicense: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const s = await window.electronAPI.getSettings();
      setSettings(s);
      applyTheme(s.theme);
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const loadLicense = useCallback(async () => {
    try {
      const l = await window.electronAPI.getLicense();
      setLicense(l);
    } catch {
      setLicense({ status: 'missing', tier: 'free' });
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadLicense();

    const remove = window.electronAPI.onThemeChanged((theme) => {
      if (theme === 'system') {
        applyThemeSystem();
      } else {
        applyTheme(theme);
      }
      setSettings(prev => prev ? { ...prev, theme } : prev);
    });

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMqChange = () => {
      setSettings(prev => {
        if (prev?.theme === 'system') applyTheme('system');
        return prev;
      });
    };
    mq.addEventListener('change', handleMqChange);

    return () => {
      remove();
      mq.removeEventListener('change', handleMqChange);
    };
  }, []);

  useEffect(() => {
    if (settings) applyTheme(settings.theme);
  }, [settings?.theme]);

  const isPro = license?.status === 'valid';

  return (
    <AppContext.Provider value={{
      settings, sessionId, setSessionId, refreshSettings: loadSettings,
      license, isPro, refreshLicense: loadLicense,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  return useContext(AppContext);
}

function applyThemeSystem() {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
}

function applyTheme(theme: Theme) {
  if (theme === 'system') {
    applyThemeSystem();
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
