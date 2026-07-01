// app/tests/unit/components/ThemeIcon.test.ts
//
// S4 (AC-UX-2 / AC11): `getThemeIconId()` resolves via
// `manifest.treatments.iconSet` against `treatments/iconSets.ts`
// (`resolveIconId`) — locks it against a FROZEN, independently hardcoded
// pre-refactor `ICON_MAP` expectation (never derived from `ICON_SETS`
// itself, which would make this a tautology). Parameterized across every
// currently-mapped icon name and all five themes' `iconSet` (line/filled/
// pixel), per VQ-S4-008.
import { describe, expect, it } from 'vitest';
import { getThemeIconId } from '@/src/components/ThemeIcon';
import { APP_THEMES } from '@/src/lib/theme';
import type { AppThemeName } from '@/src/lib/theme';

const THEME_IDS: AppThemeName[] = ['calm', 'playful', 'lego', 'minecraft', 'flower'];

// FROZEN pre-refactor ICON_MAP (ThemeIcon.tsx, pre-S4), independently
// hand-copied — keyed by icon name -> old sub-key (pixel/toy/default).
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

// The pre-refactor visualStyle each theme resolved to (frozen — same
// mapping the deleted compatBridge.test.ts pinned), used only to select
// which FROZEN_ICON_MAP sub-key each theme's expectation reads.
const OLD_VISUAL_STYLE_SUBKEY: Record<AppThemeName, 'pixel' | 'toy' | 'default'> = {
  calm: 'default',
  playful: 'default',
  lego: 'toy',
  minecraft: 'pixel',
  flower: 'default',
};

describe('getThemeIconId (AC-UX-2 / AC11): resolves via manifest.treatments.iconSet', () => {
  for (const themeId of THEME_IDS) {
    describe(`theme: ${themeId} (iconSet: ${APP_THEMES[themeId].treatments.iconSet})`, () => {
      it.each(ICON_NAMES)('%s resolves to the same iconify id as the pre-refactor ICON_MAP', (iconName) => {
        const expected = FROZEN_ICON_MAP[iconName][OLD_VISUAL_STYLE_SUBKEY[themeId]];
        const actual = getThemeIconId(iconName, APP_THEMES[themeId].treatments.iconSet);
        expect(actual).toBe(expected);
      });
    });
  }

  it('returns an empty string for an unmapped icon name (pre-refactor: ThemeIcon renders nothing)', () => {
    expect(getThemeIconId('does-not-exist', 'line')).toBe('');
  });

  it('fails if a single iconSets.ts entry is mistyped (non-tautological: FROZEN map is independent of ICON_SETS)', () => {
    // Directly proves the parameterized loop above has teeth: a
    // deliberately-wrong expectation for one theme/icon pair must NOT match
    // the real resolver output.
    const wrongExpectation = 'ph:definitely-not-the-real-icon-id';
    const actual = getThemeIconId('heart', APP_THEMES.lego.treatments.iconSet);
    expect(actual).not.toBe(wrongExpectation);
    expect(actual).toBe('ph:heart-fill');
  });
});
