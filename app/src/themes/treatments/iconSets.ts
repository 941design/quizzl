// app/src/themes/treatments/iconSets.ts
//
// Icon-name -> iconify-id maps per icon set. Lifted from
// app/src/components/ThemeIcon.tsx's ICON_MAP (pre-refactor), renaming its
// three sub-keys to the manifest vocabulary: `default` -> `line`,
// `toy` -> `filled`, `pixel` -> `pixel` (unchanged). ThemeIcon.tsx itself is
// NOT edited in this story (that is S4) — this module only stands up the
// data the S4 rewiring will consume.
//
// - "pixel" uses pixelarticons (MIT, 24x24 pixel art style)
// - "filled" uses ph:*-fill (Phosphor filled, playful weight) — old "toy"
// - "line" uses ph:*-bold (Phosphor bold, clean line style) — old "default"
export type IconSetName = 'line' | 'filled' | 'pixel';

export const ICON_SETS: Record<string, Record<IconSetName, string>> = {
  heart: {
    line: 'ph:heart-bold',
    filled: 'ph:heart-fill',
    pixel: 'pixelarticons:heart',
  },
  check: {
    line: 'ph:check-circle-bold',
    filled: 'ph:check-circle-fill',
    pixel: 'pixelarticons:check',
  },
  close: {
    line: 'ph:x-circle-bold',
    filled: 'ph:x-circle-fill',
    pixel: 'pixelarticons:close',
  },
  home: {
    line: 'ph:house-bold',
    filled: 'ph:house-fill',
    pixel: 'pixelarticons:home',
  },
  settings: {
    line: 'ph:gear-bold',
    filled: 'ph:gear-fill',
    pixel: 'pixelarticons:sliders',
  },
  clock: {
    line: 'ph:clock-bold',
    filled: 'ph:clock-fill',
    pixel: 'pixelarticons:clock',
  },
  prev: {
    line: 'ph:caret-left-bold',
    filled: 'ph:caret-left-fill',
    pixel: 'pixelarticons:chevron-left',
  },
  next: {
    line: 'ph:caret-right-bold',
    filled: 'ph:caret-right-fill',
    pixel: 'pixelarticons:chevron-right',
  },
  bell: {
    line: 'ph:bell-bold',
    filled: 'ph:bell-ringing-fill',
    pixel: 'pixelarticons:notification',
  },
  info: {
    line: 'ph:info-bold',
    filled: 'ph:info-fill',
    pixel: 'pixelarticons:info-box',
  },
  person: {
    line: 'ph:user-circle-bold',
    filled: 'ph:user-circle-fill',
    pixel: 'pixelarticons:user',
  },
  phone: {
    line: 'ph:phone-bold',
    filled: 'ph:phone-fill',
    pixel: 'pixelarticons:phone',
  },
  video: {
    line: 'ph:video-camera-bold',
    filled: 'ph:video-camera-fill',
    pixel: 'pixelarticons:camera',
  },
};

/**
 * Resolves the iconify id for a semantic icon name under the given icon set.
 * Falls back to the `line` set (the old `default` case) when `name` isn't a
 * mapped icon or the requested set is somehow missing on that entry — mirrors
 * `ThemeIcon.tsx`'s pre-refactor `iconSet[vs] ?? iconSet.default` fallback.
 * Returns `''` when `name` has no entry at all (pre-refactor behavior:
 * `ThemeIcon` renders nothing, `getThemeIconId` returns `''`).
 */
export function resolveIconId(name: string, iconSet: IconSetName): string {
  const entry = ICON_SETS[name];
  if (!entry) return '';
  return entry[iconSet] ?? entry.line;
}
