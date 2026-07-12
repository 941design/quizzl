// app/tests/unit/components/ThemeIcon.test.ts
//
// (AC-UX-2 / AC11): `getThemeIconId()` resolves via
// `manifest.treatments.iconSet` against `treatments/iconSets.ts`
// (`resolveIconId`) — locks it against a FROZEN, independently hardcoded
// pre-refactor `ICON_MAP` expectation (never derived from `ICON_SETS`
// itself, which would make this a tautology). spring uses the `line`
// icon set; the `filled` and `pixel` sets (still part of the treatment
// catalog) are exercised directly so all three sets stay covered.
import { describe, expect, it } from 'vitest';
import { getThemeIconId } from '@/src/components/ThemeIcon';
import { APP_THEMES } from '@/src/lib/theme';
import type { AppThemeName } from '@/src/lib/theme';
import type { IconSetName } from '@/src/themes/treatments/iconSets';

// Icon resolution is theme-agnostic given identical `iconSet` values — every
// theme (spring + the 7 themes.json watercolors) declares `iconSet: 'line'`,
// so spring is a sufficient representative here. Schema-level validation of
// each new theme's treatments lives in themes-validation.test.ts.
const THEME_IDS: AppThemeName[] = ['spring'];

// FROZEN pre-refactor ICON_MAP (ThemeIcon.tsx), independently hand-copied —
// keyed by icon name -> old sub-key (pixel/toy/default), which map to the
// current iconSet names pixel/filled/line respectively.
const FROZEN_ICON_MAP: Record<string, { pixel: string; toy: string; default: string }> = {
  heart: { pixel: 'pixelarticons:heart', toy: 'ph:heart-fill', default: 'ph:heart-bold' },
  check: { pixel: 'pixelarticons:check', toy: 'ph:check-circle-fill', default: 'ph:check-circle-bold' },
  close: { pixel: 'pixelarticons:close', toy: 'ph:x-circle-fill', default: 'ph:x-circle-bold' },
  home: { pixel: 'pixelarticons:home', toy: 'ph:house-fill', default: 'ph:house-bold' },
  settings: { pixel: 'pixelarticons:sliders', toy: 'ph:gear-fill', default: 'ph:gear-bold' },
  clock: { pixel: 'pixelarticons:clock', toy: 'ph:clock-fill', default: 'ph:clock-bold' },
  prev: { pixel: 'pixelarticons:chevron-left', toy: 'ph:caret-left-fill', default: 'ph:caret-left-bold' },
  next: { pixel: 'pixelarticons:chevron-right', toy: 'ph:caret-right-fill', default: 'ph:caret-right-bold' },
  bell: { pixel: 'pixelarticons:notification', toy: 'ph:bell-ringing-fill', default: 'ph:bell-bold' },
  person: { pixel: 'pixelarticons:user', toy: 'ph:user-circle-fill', default: 'ph:user-circle-bold' },
  phone: { pixel: 'pixelarticons:phone', toy: 'ph:phone-fill', default: 'ph:phone-bold' },
  video: { pixel: 'pixelarticons:camera', toy: 'ph:video-camera-fill', default: 'ph:video-camera-bold' },
};

const ICON_NAMES = Object.keys(FROZEN_ICON_MAP);

// The current iconSet name -> the FROZEN_ICON_MAP sub-key it reads.
const SET_TO_SUBKEY: Record<IconSetName, 'pixel' | 'toy' | 'default'> = {
  line: 'default',
  filled: 'toy',
  pixel: 'pixel',
};

describe('getThemeIconId (AC-UX-2 / AC11): resolves via manifest.treatments.iconSet', () => {
  for (const themeId of THEME_IDS) {
    describe(`theme: ${themeId} (iconSet: ${APP_THEMES[themeId].treatments.iconSet})`, () => {
      it.each(ICON_NAMES)('%s resolves to the same iconify id as the pre-refactor ICON_MAP', (iconName) => {
        const iconSet = APP_THEMES[themeId].treatments.iconSet;
        const expected = FROZEN_ICON_MAP[iconName][SET_TO_SUBKEY[iconSet]];
        const actual = getThemeIconId(iconName, iconSet);
        expect(actual).toBe(expected);
      });
    });
  }

  // spring only uses `line`; exercise all three catalog sets directly so
  // `filled` and `pixel` resolution stays covered.
  describe.each(['line', 'filled', 'pixel'] as const)('icon set: %s', (iconSet) => {
    it.each(ICON_NAMES)('%s resolves to the same iconify id as the pre-refactor ICON_MAP', (iconName) => {
      const expected = FROZEN_ICON_MAP[iconName][SET_TO_SUBKEY[iconSet]];
      expect(getThemeIconId(iconName, iconSet)).toBe(expected);
    });
  });

  it('returns an empty string for an unmapped icon name (pre-refactor: ThemeIcon renders nothing)', () => {
    expect(getThemeIconId('does-not-exist', 'line')).toBe('');
  });

  it('fails if a single iconSets.ts entry is mistyped (non-tautological: FROZEN map is independent of ICON_SETS)', () => {
    // Directly proves the parameterized loops above have teeth: a
    // deliberately-wrong expectation for one iconSet/icon pair must NOT match
    // the real resolver output.
    const wrongExpectation = 'ph:definitely-not-the-real-icon-id';
    const actual = getThemeIconId('heart', 'filled');
    expect(actual).not.toBe(wrongExpectation);
    expect(actual).toBe('ph:heart-fill');
  });
});
