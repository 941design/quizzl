import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { LanguageCode } from '@/src/types';
import { readSettings, writeSettings } from '@/src/lib/storage';
import { detectBrowserLanguage, getCopy } from '@/src/lib/i18n';

type LanguageContextValue = {
  language: LanguageCode;
  hydrated: boolean;
  setLanguage: (language: LanguageCode) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>('en');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const settings = readSettings();
    const resolvedLanguage = settings.language || detectBrowserLanguage();

    setLanguageState(resolvedLanguage);
    setHydrated(true);

    if (settings.language !== resolvedLanguage) {
      writeSettings({ ...settings, language: resolvedLanguage });
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  const setLanguage = useCallback((nextLanguage: LanguageCode) => {
    setLanguageState(nextLanguage);
    const settings = readSettings();
    writeSettings({ ...settings, language: nextLanguage });
  }, []);

  const value = useMemo(
    () => ({ language, hydrated, setLanguage }),
    [language, hydrated, setLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }

  return context;
}

export function useCopy() {
  const { language } = useLanguage();
  return getCopy(language);
}
