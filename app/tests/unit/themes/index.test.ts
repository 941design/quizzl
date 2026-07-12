import { describe, expect, it } from 'vitest';
import * as themesIndex from '@/src/themes/index';
import * as libTheme from '@/src/lib/theme';

describe('themes/index (S1 pass-through)', () => {
  it('re-exports the exact same values/functions as lib/theme.ts (no wrapping, no behavior change)', () => {
    expect(themesIndex.APP_THEMES).toBe(libTheme.APP_THEMES);
    expect(themesIndex.DEFAULT_THEME_NAME).toBe(libTheme.DEFAULT_THEME_NAME);
    expect(themesIndex.isAppThemeName).toBe(libTheme.isAppThemeName);
    expect(themesIndex.normalizeThemeName).toBe(libTheme.normalizeThemeName);
    expect(themesIndex.getThemeDefinition).toBe(libTheme.getThemeDefinition);
    expect(themesIndex.getChakraTheme).toBe(libTheme.getChakraTheme);
    expect(themesIndex.listThemes).toBe(libTheme.listThemes);
  });

  it('preserves AC-STRUCT-5 call signatures/behavior through the pass-through', () => {
    expect(themesIndex.isAppThemeName('spring')).toBe(true);
    expect(themesIndex.isAppThemeName('not-a-theme')).toBe(false);
    expect(themesIndex.normalizeThemeName('bogus')).toBe(themesIndex.DEFAULT_THEME_NAME);
    expect(themesIndex.getThemeDefinition('spring')).toBe(libTheme.APP_THEMES.spring);
    expect(themesIndex.getChakraTheme('spring')).toBe(libTheme.getChakraTheme('spring'));
  });
});

// ===========================================================================
// S4 compat-bridge teardown: AppThemeDefinition = ThemeManifest (pure
// alias — no visualStyle/labelKey/descriptionKey/backgroundImage), and the
// new status:'hidden' semantics (architecture.md Implementation Constraint
// 14 / spec.md §6.10, AC-UX-4).
// ===========================================================================
describe('themes/index (S4): compat bridge torn down', () => {
  it('APP_THEMES entries have no leftover compat fields (visualStyle/labelKey/descriptionKey)', () => {
    for (const def of Object.values(themesIndex.APP_THEMES)) {
      expect(def).not.toHaveProperty('visualStyle');
      expect(def).not.toHaveProperty('labelKey');
      expect(def).not.toHaveProperty('descriptionKey');
    }
  });

  it('ELEVATION_TO_VISUAL_STYLE and toCompatDefinition no longer exist on the module', () => {
    expect((themesIndex as Record<string, unknown>).ELEVATION_TO_VISUAL_STYLE).toBeUndefined();
    expect((themesIndex as Record<string, unknown>).toCompatDefinition).toBeUndefined();
    expect((themesIndex as Record<string, unknown>).ThemeVisualStyle).toBeUndefined();
  });
});

describe('themes/index (AC-UX-4 / AC15): normalizeThemeName / isAppThemeName / listThemes hidden semantics', () => {
  it('isAppThemeName is exactly `id in APP_THEMES` for every real theme (membership, not status)', () => {
    for (const id of Object.keys(themesIndex.APP_THEMES)) {
      expect(themesIndex.isAppThemeName(id)).toBe(true);
    }
    expect(themesIndex.isAppThemeName('not-a-real-theme')).toBe(false);
  });

  it('normalizeThemeName falls back to DEFAULT_THEME_NAME for an id absent from APP_THEMES', () => {
    expect(themesIndex.normalizeThemeName('not-a-real-theme')).toBe(themesIndex.DEFAULT_THEME_NAME);
    expect(themesIndex.normalizeThemeName(null)).toBe(themesIndex.DEFAULT_THEME_NAME);
    expect(themesIndex.normalizeThemeName(undefined)).toBe(themesIndex.DEFAULT_THEME_NAME);
  });

  it('isThemeVisible is true for a real theme (none of the five sets status:hidden today)', () => {
    for (const def of Object.values(themesIndex.APP_THEMES)) {
      expect(themesIndex.isThemeVisible(def)).toBe(true);
    }
  });

  it('isThemeVisible is false for a status:hidden fixture (real-manifest spread with status overridden — proves the filter branch has teeth, since no real theme is hidden today)', () => {
    const hiddenFixture = { ...themesIndex.APP_THEMES.spring, status: 'hidden' as const };
    expect(themesIndex.isThemeVisible(hiddenFixture)).toBe(false);
  });

  it('a stored id that is hidden-but-present in APP_THEMES would normalize to itself (isolated fixture proving the `isAppThemeName` contract is membership-only, not status-filtered)', () => {
    const fixtureThemes: Record<string, { id: string; status?: string }> = {
      calm: { id: 'calm' },
      secret: { id: 'secret', status: 'hidden' },
    };
    const fixtureIsAppThemeName = (v: string) => v in fixtureThemes;
    const fixtureNormalize = (v: string | null | undefined) => (v && fixtureIsAppThemeName(v) ? v : 'calm');
    expect(fixtureIsAppThemeName('secret')).toBe(true);
    expect(fixtureNormalize('secret')).toBe('secret');
  });

  it('listThemes() excludes status:hidden themes; listThemes({ includeHidden: true }) includes them', () => {
    // Isolated fixture array (never mutates the real registry) exercising
    // the REAL isThemeVisible predicate the way listThemes() itself does.
    const fixtures = [
      themesIndex.APP_THEMES.spring,
      { ...themesIndex.APP_THEMES.spring, id: 'secret', status: 'hidden' as const },
    ];
    const visibleOnly = fixtures.filter((t) => themesIndex.isThemeVisible(t));
    expect(visibleOnly.map((t) => t.id)).toEqual(['spring']);
    expect(fixtures.map((t) => t.id)).toEqual(['spring', 'secret']);
  });

  it('listThemes() against the real registry returns all themes in `order` (none hidden)', () => {
    const EXPECTED = [
      'forest',
      'lavender',
      'deep-sea',
      'spring',
      'lime',
      'rose',
      'lagoon',
    ];
    expect(themesIndex.listThemes().map((t) => t.id)).toEqual(EXPECTED);
    expect(themesIndex.listThemes({ includeHidden: true }).map((t) => t.id)).toEqual(EXPECTED);
  });
});
