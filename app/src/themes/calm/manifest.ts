// app/src/themes/calm/manifest.ts
//
// The "Calm" theme manifest — migrated field-for-field from
// app/src/lib/theme.ts's pre-refactor `calmTheme` (createTheme() input,
// theme.ts:206-285) and `APP_THEMES.calm` (theme.ts:678-686), plus the
// `soft` visual-style treatment blocks from useThemeStyles.ts (all empty —
// calm has no elevation/pattern) and its BANNER_SVG.soft entry.
//
// Pure data: no Chakra import, no functions, no runtime schema.ts import
// (architecture.md Boundary Rules: "manifests -> (nothing but the
// ThemeManifest type)"). Values are copied verbatim — no re-tuning
// (architecture.md Story Order note for S2 / spec.md §6.8).
import type { ThemeManifest } from '../schema';

export const manifest: ThemeManifest = {
  id: 'calm',
  order: 1,
  label: { en: 'Calm', de: 'Ruhig' },
  description: {
    en: 'Muted blues and greens, minimal animations.',
    de: 'Gedämpfte Blau- und Grüntöne, minimale Animationen.',
  },
  previewColorScheme: 'brand',
  colorScheme: 'light',
  colors: {
    brand: [
      '#e6f4f1',
      '#c0e3db',
      '#96d0c3',
      '#6bbcab',
      '#4aad9a',
      '#2a9d8a',
      '#259080',
      '#1f8073',
      '#177065',
      '#0d5450',
    ],
    success: [
      '#e6f7ef',
      '#c2ead3',
      '#9bdeb8',
      '#71d19b',
      '#50c785',
      '#32bb71',
      '#27aa66',
      '#1d9658',
      '#137f4a',
      '#045a33',
    ],
    warning: [
      '#fff6df',
      '#fde7b1',
      '#fbd77f',
      '#f8c84b',
      '#f5bb24',
      '#e6a700',
      '#cd9500',
      '#b28200',
      '#966f00',
      '#6a4f00',
    ],
    danger: [
      '#fdeceb',
      '#f8c7c3',
      '#f1a09b',
      '#ea7873',
      '#e45b57',
      '#d93a3f',
      '#bf2d33',
      '#a0252c',
      '#821c24',
      '#5d1118',
    ],
    neutral: [
      '#f7f8f8',
      '#ecefef',
      '#dce1e1',
      '#c8d0cf',
      '#aeb8b7',
      '#8b9796',
      '#697877',
      '#526261',
      '#394847',
      '#202d2c',
    ],
    appBg: '#f3f7f8',
    surfaceBg: '#ffffff',
    surfaceMutedBg: '#eef5f4',
    surfaceRaisedBg: '#ffffff',
    borderSubtle: '#d7e3e0',
    borderStrong: '#98b5af',
    textMuted: '#5f6f6c',
    textStrong: '#203230',
    successBg: '#eaf7ef',
    successBorder: '#9bdeb8',
    successText: '#1d6b49',
    warningBg: '#fff4d7',
    warningBorder: '#f2c86c',
    warningText: '#7e5c00',
    dangerBg: '#fdeeed',
    dangerBorder: '#efb0ab',
    dangerText: '#8b2430',
    buttonColorScheme: 'brand',
  },
  typography: {
    // theme.ts's createTheme() falls back to this exact pair when a theme's
    // input omits `fonts` (theme.ts:147-150) — calm is one of the two
    // themes (with playful) that takes the fallback.
    fonts: { heading: 'system-ui, sans-serif', body: 'system-ui, sans-serif' },
    fontLoad: [],
  },
  treatments: {
    card: 'flat',
    button: 'flat',
    nav: 'flat',
    surface: 'none',
    iconSet: 'line',
    // Verbatim from useThemeStyles.ts's BANNER_SVG.soft (pre-refactor).
    banner: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ffffff" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#ffffff" stop-opacity="0.9"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="leafFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#87d7ca" stop-opacity="0.42"/>
          <stop offset="1" stop-color="#2a9d8a" stop-opacity="0.16"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <path d="M24 108c0-44 24-78 76-92 26 30 39 62 39 92H24Z" fill="url(#leafFill)"/>
      <path d="M88 104c16-38 48-64 103-76-16 36-48 63-96 81" fill="#66c3b2" fill-opacity=".18"/>
      <path d="M34 106c50-10 93-39 131-87" stroke="#2a9d8a" stroke-width="4" stroke-linecap="round" stroke-opacity=".2" fill="none"/>
      <circle cx="188" cy="38" r="14" fill="#7cd0c1" fill-opacity=".18"/>
      <circle cx="226" cy="76" r="10" fill="#7cd0c1" fill-opacity=".14"/>
    </svg>
  `,
  },
};

export default manifest;
