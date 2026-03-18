import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Settings, AppThemeName } from '@/src/types';
import { readSettings, writeSettings } from '@/src/lib/storage';
import { getChakraTheme, getThemeDefinition } from '@/src/lib/theme';

type AppThemeContextValue = {
  themeName: AppThemeName;
  hydrated: boolean;
  setTheme: (theme: AppThemeName) => void;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<AppThemeName>('calm');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const settings = readSettings();
    setThemeName(settings.theme);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = themeName;
    }
  }, [themeName]);

  const setTheme = useCallback((nextTheme: AppThemeName) => {
    setThemeName(nextTheme);
    const settings: Settings = {
      ...readSettings(),
      theme: nextTheme,
    };
    writeSettings(settings);
  }, []);

  const value = useMemo(
    () => ({ themeName, hydrated, setTheme }),
    [themeName, hydrated, setTheme]
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  const context = useContext(AppThemeContext);

  if (!context) {
    throw new Error('useAppTheme must be used within an AppThemeProvider');
  }

  const activeTheme = getChakraTheme(context.themeName);
  const activeThemeDefinition = getThemeDefinition(context.themeName);

  return {
    ...context,
    activeTheme,
    activeThemeDefinition,
  };
}

export function useMoodTheme() {
  const theme = useAppTheme();

  return {
    ...theme,
    mood: theme.themeName,
  };
}
