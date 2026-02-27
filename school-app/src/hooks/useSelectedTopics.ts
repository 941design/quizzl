import { useState, useEffect, useCallback } from 'react';
import { readSelectedTopics, writeSelectedTopics } from '@/src/lib/storage';

export function useSelectedTopics() {
  const [selectedSlugs, setSelectedSlugsState] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount (client-side only)
  useEffect(() => {
    const stored = readSelectedTopics();
    setSelectedSlugsState(stored.slugs);
    setHydrated(true);
  }, []);

  const selectTopic = useCallback((slug: string) => {
    setSelectedSlugsState((prev) => {
      if (prev.includes(slug)) return prev;
      const next = [...prev, slug];
      writeSelectedTopics({ slugs: next });
      return next;
    });
  }, []);

  const deselectTopic = useCallback((slug: string) => {
    setSelectedSlugsState((prev) => {
      const next = prev.filter((s) => s !== slug);
      writeSelectedTopics({ slugs: next });
      return next;
    });
  }, []);

  const toggleTopic = useCallback((slug: string) => {
    setSelectedSlugsState((prev) => {
      const isSelected = prev.includes(slug);
      const next = isSelected ? prev.filter((s) => s !== slug) : [...prev, slug];
      writeSelectedTopics({ slugs: next });
      return next;
    });
  }, []);

  const isSelected = useCallback(
    (slug: string) => selectedSlugs.includes(slug),
    [selectedSlugs]
  );

  return {
    selectedSlugs,
    selectTopic,
    deselectTopic,
    toggleTopic,
    isSelected,
    hydrated,
  };
}
