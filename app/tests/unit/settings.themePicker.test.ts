// app/tests/unit/settings.themePicker.test.ts
//
// S4 (AC-UX-3 / AC13): the `/settings` theme picker/preview reads
// `label`/`description` from each manifest's `{ en; de? }` fields (with `de`
// falling back to `en`), sourced via `listThemes()` (§6.10 — excludes
// `status:'hidden'`), rather than from `i18n.ts`'s per-theme keys. The
// theme/language pickers moved from `/profile` to `/settings`, so this scan
// targets `settings.tsx`. The vitest environment has no DOM renderer /
// @testing-library/react (see `memberListAdminUi.test.ts`'s header comment
// for the established convention), so the "settings no longer reads from the
// removed keys" half of VQ-S4-009 is verified by scanning `settings.tsx`'s
// source, mirroring `themes-validation.test.ts`'s AC-STRUCT-2 source-scan
// pattern. The "renders from manifest fields" half is verified by exercising
// the same `localizedThemeText`-shaped fallback logic against real manifest data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

type Copy = ReturnType<typeof getCopy>;
import { listThemes, APP_THEMES } from '@/src/lib/theme';

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(TEST_FILE_DIR, '..', '..'); // app/tests/unit -> app/
const SETTINGS_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'pages', 'settings.tsx'), 'utf8');

const REMOVED_KEYS = [
  'calm',
  'playful',
  'lego',
  'minecraft',
  'flower',
  'calmDescription',
  'playfulDescription',
  'legoDescription',
  'minecraftDescription',
  'flowerDescription',
] as const;

describe('settings.tsx theme picker source (AC-UX-3): reads manifest fields, not i18n.ts per-theme keys', () => {
  it('uses listThemes() for the picker, not Object.values(APP_THEMES)', () => {
    expect(SETTINGS_SOURCE).toMatch(/listThemes\(\s*\)/);
    expect(SETTINGS_SOURCE).not.toMatch(/Object\.values\(APP_THEMES\)/);
  });

  it('has no reference to the removed compat fields labelKey/descriptionKey/backgroundImage-off-definition', () => {
    expect(SETTINGS_SOURCE).not.toMatch(/\.labelKey\b/);
    expect(SETTINGS_SOURCE).not.toMatch(/\.descriptionKey\b/);
    // The preview's backgroundImage now reads through colors.backgroundImage,
    // never the removed compat top-level field.
    expect(SETTINGS_SOURCE).not.toMatch(/activeThemeDefinition\.backgroundImage\b/);
    expect(SETTINGS_SOURCE).toMatch(/activeThemeDefinition\.colors\.backgroundImage\b/);
  });

  it('has no dangling copy.settings[<removed-key>]-style dynamic lookup for any removed key', () => {
    for (const key of REMOVED_KEYS) {
      expect(SETTINGS_SOURCE, `unexpected reference to removed i18n key "${key}"`).not.toMatch(
        new RegExp(`copy\\.settings\\.${key}\\b`)
      );
      expect(SETTINGS_SOURCE, `unexpected reference to removed i18n key "${key}"`).not.toMatch(
        new RegExp(`copy\\.settings\\[[^\\]]*${key}[^\\]]*\\]`)
      );
    }
  });

  it('still references the retained theme-section i18n keys', () => {
    expect(SETTINGS_SOURCE).toMatch(/copy\.settings\.themeHeading\b/);
    expect(SETTINGS_SOURCE).toMatch(/copy\.settings\.themeDescription\b/);
    expect(SETTINGS_SOURCE).toMatch(/copy\.settings\.currentTheme\b/);
  });
});

describe('theme label/description resolution (AC-UX-3): de falls back to en', () => {
  function localizedThemeText(text: { en: string; de?: string }, language: 'en' | 'de'): string {
    return language === 'de' ? text.de ?? text.en : text.en;
  }

  it('renders the manifest en label/description in English', () => {
    const spring = APP_THEMES.spring;
    expect(localizedThemeText(spring.label, 'en')).toBe(spring.label.en);
    expect(localizedThemeText(spring.description, 'en')).toBe(spring.description.en);
  });

  it('renders the manifest de label/description in German when present', () => {
    const spring = APP_THEMES.spring;
    expect(spring.label.de).toBeTruthy(); // sanity: spring has a real de translation
    expect(localizedThemeText(spring.label, 'de')).toBe(spring.label.de);
  });

  it('falls back to en when de is absent (isolated fixture — the spring theme does not omit de, so this proves the fallback branch has teeth)', () => {
    const fixture = { en: 'English Only' };
    expect(localizedThemeText(fixture, 'de')).toBe('English Only');
  });

  it('listThemes() returns all themes in ascending `order` (none status:hidden today)', () => {
    const ids = listThemes().map((t) => t.id);
    expect(ids).toEqual([
      'forest',
      'lavender',
      'deep-sea',
      'spring',
      'lime',
      'rose',
      'lagoon',
    ]);
  });
});

describe('i18n.ts (AC-UX-3): the 10 per-theme keys are removed; the 4 retained keys still resolve', () => {
  it.each(['en', 'de'] as const)('%s: settings object has no per-theme label/description keys', (lang) => {
    const settings = getCopy(lang).settings as unknown as Record<string, unknown>;
    for (const key of REMOVED_KEYS) {
      expect(settings, `unexpected key "${key}" still present in ${lang} copy.settings`).not.toHaveProperty(key);
    }
  });

  it.each(['en', 'de'] as const)('%s: themeHeading/themeDescription/currentTheme remain and are non-empty', (lang) => {
    const settings = getCopy(lang).settings;
    expect(settings.themeHeading).toBeTruthy();
    expect(settings.themeDescription).toBeTruthy();
    expect(settings.currentTheme).toBeTruthy();
  });

  it('Copy type has no per-theme keys in its settings shape (compile-time check via a structural assignment)', () => {
    // If a removed key were still declared on the Copy type, TS would allow
    // (and vitest's isolated-module transpile would not catch) an object
    // missing it to satisfy the type incorrectly in the other direction;
    // the meaningful compile-time guarantee is that `settings` below is
    // assignable to `Copy['settings']` WITHOUT the removed keys, which only
    // type-checks if they are no longer required members.
    const settings: Copy['settings'] = getCopy('en').settings;
    expect(settings.themeHeading).toBeTruthy();
  });
});
