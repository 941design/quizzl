// app/src/themes/flower/manifest.ts
//
// The "Flower" (Flower Garden) theme manifest — migrated field-for-field
// from app/src/lib/theme.ts's pre-refactor `flowerTheme` /
// `flowerThemeBackground` (theme.ts:580-675) and `APP_THEMES.flower`
// (theme.ts:721-732), plus the `floral` visual-style treatment blocks from
// useThemeStyles.ts (cardOverlay/buttonOverlay/navOverlay/surfaceOverlay
// 'floral' cases) and its BANNER_SVG.floral entry. Icon set: ThemeIcon.tsx's
// ICON_MAP has no `floral` key, so flower (old visualStyle 'floral') falls
// through to the `default`/`line` icon set, same as calm/playful.
//
// German label copied verbatim from i18n.ts, including its existing
// ASCII spelling ("Bluetengarten", not "Blütengarten") — not a re-tuning
// site for this story.
//
// Pure data: no Chakra import, no functions, no runtime schema.ts import.
// Values copied verbatim — no re-tuning.
import type { ThemeManifest } from '../schema';

export const manifest: ThemeManifest = {
  id: 'flower',
  order: 5,
  label: { en: 'Flower Garden', de: 'Bluetengarten' },
  description: {
    en: 'Soft blossom tones, petal-like shapes, and a bright floral backdrop.',
    de: 'Sanfte Blütentöne, blütenartige Formen und ein heller floraler Hintergrund.',
  },
  previewColorScheme: 'brand',
  colorScheme: 'light',
  colors: {
    brand: [
      '#fff1f7',
      '#ffdbe9',
      '#ffc3db',
      '#ffa7cb',
      '#ff8abc',
      '#f468a8',
      '#db4d8f',
      '#bd3977',
      '#98285d',
      '#68153d',
    ],
    success: [
      '#eef9ea',
      '#d7efcb',
      '#bce4aa',
      '#9fd988',
      '#84cd68',
      '#69c149',
      '#57aa39',
      '#46912d',
      '#367221',
      '#214713',
    ],
    warning: [
      '#fff7e5',
      '#ffe8bd',
      '#ffd893',
      '#ffc968',
      '#ffbb47',
      '#f3a723',
      '#d78f16',
      '#b7760f',
      '#915c09',
      '#603906',
    ],
    danger: [
      '#ffecef',
      '#ffcfd9',
      '#ffb0c1',
      '#ff91aa',
      '#f87595',
      '#ea557d',
      '#cd3f67',
      '#ab3154',
      '#862542',
      '#5a162b',
    ],
    neutral: [
      '#fffdfc',
      '#f9f1ef',
      '#f0e3e0',
      '#e4d2cf',
      '#cfb8b4',
      '#b19894',
      '#8c7572',
      '#6a5754',
      '#473a38',
      '#2a2120',
    ],
    appBg: '#fff3f7',
    backgroundImage:
      'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.55) 0 14px, transparent 15px), radial-gradient(circle at 80% 24%, rgba(255,255,255,0.45) 0 12px, transparent 13px), radial-gradient(circle at 30% 78%, rgba(255,255,255,0.4) 0 10px, transparent 11px), linear-gradient(180deg, #ffe7f1 0%, #ffd6e7 45%, #ffecc7 100%)',
    surfaceBg: '#fffdfc',
    surfaceMutedBg: '#ffe7f0',
    surfaceRaisedBg: '#fffaf4',
    borderSubtle: '#f1c6d8',
    borderStrong: '#d96a9d',
    textMuted: '#7b5c69',
    textStrong: '#41222f',
    successBg: '#eef8eb',
    successBorder: '#a8d791',
    successText: '#2f6b28',
    warningBg: '#fff5df',
    warningBorder: '#f0c36b',
    warningText: '#8a5a0f',
    dangerBg: '#ffeef2',
    dangerBorder: '#f3a1b8',
    dangerText: '#94284c',
    buttonColorScheme: 'brand',
  },
  typography: {
    fonts: {
      heading: '"DM Serif Display", Georgia, serif',
      body: '"Nunito", system-ui, sans-serif',
    },
    fontLoad: [{ family: 'DM Serif Display', ital: true }, { family: 'Nunito', weights: [400, 600, 700, 800] }],
  },
  shape: {
    radii: {
      sm: '10px',
      md: '16px',
      lg: '22px',
      xl: '28px',
      '2xl': '34px',
      full: '9999px',
    },
  },
  treatments: {
    card: 'floralGlow',
    button: 'floralGlow',
    nav: 'floralGlow',
    surface: 'petals',
    iconSet: 'line',
    // Verbatim from useThemeStyles.ts's BANNER_SVG.floral (pre-refactor).
    banner: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff4f8" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#fff4f8" stop-opacity=".92"/>
          <stop offset="1" stop-color="#fff4f8" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <g transform="translate(24 10)">
        <circle cx="56" cy="26" r="20" fill="#f468a8" fill-opacity=".2"/>
        <circle cx="28" cy="48" r="20" fill="#f468a8" fill-opacity=".16"/>
        <circle cx="84" cy="48" r="20" fill="#f468a8" fill-opacity=".16"/>
        <circle cx="40" cy="78" r="20" fill="#f468a8" fill-opacity=".2"/>
        <circle cx="72" cy="78" r="20" fill="#f468a8" fill-opacity=".2"/>
        <circle cx="56" cy="54" r="12" fill="#ffbb47" fill-opacity=".26"/>
        <path d="M112 98c20-18 41-27 76-31" stroke="#d75792" stroke-width="5" stroke-linecap="round" stroke-opacity=".14" fill="none"/>
        <circle cx="150" cy="36" r="12" fill="#f7a2c8" fill-opacity=".16"/>
        <circle cx="190" cy="68" r="10" fill="#f7a2c8" fill-opacity=".12"/>
      </g>
    </svg>
  `,
  },
};

export default manifest;
