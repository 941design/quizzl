import { useState, useEffect, useCallback } from 'react';
import type { Settings } from '@/src/types';
import { readSettings, writeSettings } from '@/src/lib/storage';
import { calmTheme, playfulTheme } from '@/src/lib/theme';

export type Mood = 'calm' | 'playful';

export function useMoodTheme() {
  const [mood, setMood] = useState<Mood>('calm');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const settings = readSettings();
    setMood(settings.mood);
    setHydrated(true);
  }, []);

  const setTheme = useCallback((newMood: Mood) => {
    setMood(newMood);
    const settings: Settings = {
      ...readSettings(),
      mood: newMood,
    };
    writeSettings(settings);
  }, []);

  const activeTheme = mood === 'playful' ? playfulTheme : calmTheme;

  return { mood, hydrated, setTheme, activeTheme };
}
