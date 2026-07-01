// app/src/themes/playful/manifest.ts
//
// The "Playful" theme manifest — migrated field-for-field from
// app/src/lib/theme.ts's pre-refactor `playfulTheme` (theme.ts:287-374) and
// `APP_THEMES.playful` (theme.ts:687-695), plus the `rounded` visual-style
// treatment blocks from useThemeStyles.ts (all empty — playful has no
// elevation/pattern) and its BANNER_SVG.rounded entry.
//
// Pure data: no Chakra import, no functions, no runtime schema.ts import.
// Values copied verbatim — no re-tuning.
import type { ThemeManifest } from '../schema';

export const manifest: ThemeManifest = {
  id: 'playful',
  order: 2,
  label: { en: 'Playful', de: 'Verspielt' },
  description: {
    en: 'Warm oranges and purples, rounded corners.',
    de: 'Warme Orange- und Lilatöne, runde Ecken.',
  },
  previewColorScheme: 'brand',
  colorScheme: 'light',
  colors: {
    brand: [
      '#fef3e2',
      '#fde0b5',
      '#fbcc84',
      '#f9b852',
      '#f8a930',
      '#f79a0d',
      '#e58d09',
      '#ce7d06',
      '#b76e04',
      '#8f5300',
    ],
    success: [
      '#e7fbef',
      '#c6f2d3',
      '#a2e8b6',
      '#79dc98',
      '#57d27f',
      '#33c867',
      '#26b65b',
      '#1d9f4f',
      '#168743',
      '#085f2c',
    ],
    warning: [
      '#fff2dc',
      '#ffdca7',
      '#ffc36e',
      '#ffae36',
      '#ff9c14',
      '#f38600',
      '#da7400',
      '#bc6200',
      '#9d5000',
      '#6f3700',
    ],
    danger: [
      '#ffe8ed',
      '#ffc1ce',
      '#ff97ad',
      '#ff6c8c',
      '#fb4f78',
      '#ef2e62',
      '#d41e53',
      '#b21645',
      '#910e37',
      '#630422',
    ],
    neutral: [
      '#fffaf3',
      '#f8efdf',
      '#eedec1',
      '#e1cba1',
      '#cfb57c',
      '#b5985a',
      '#8e7543',
      '#6d5831',
      '#4d3c21',
      '#2f2212',
    ],
    appBg: '#fff7ec',
    surfaceBg: '#ffffff',
    surfaceMutedBg: '#fff0d8',
    surfaceRaisedBg: '#fffaf2',
    borderSubtle: '#f3d4a2',
    borderStrong: '#d89d49',
    textMuted: '#7a664c',
    textStrong: '#35230f',
    successBg: '#ebfbef',
    successBorder: '#92e0ae',
    successText: '#16673d',
    warningBg: '#fff1d9',
    warningBorder: '#f5b560',
    warningText: '#8c5300',
    dangerBg: '#ffeaf0',
    dangerBorder: '#f8a2b7',
    dangerText: '#97214a',
    buttonColorScheme: 'brand',
  },
  typography: {
    // theme.ts's createTheme() fallback (theme.ts:147-150) — playful's input
    // omits `fonts` just like calm's.
    fonts: { heading: 'system-ui, sans-serif', body: 'system-ui, sans-serif' },
    fontLoad: [],
  },
  shape: {
    radii: {
      sm: '6px',
      md: '10px',
      lg: '16px',
      xl: '20px',
      '2xl': '28px',
      full: '9999px',
    },
  },
  treatments: {
    card: 'softDrop',
    button: 'softDrop',
    nav: 'softDrop',
    surface: 'none',
    iconSet: 'line',
    // Verbatim from useThemeStyles.ts's BANNER_SVG.rounded (pre-refactor).
    banner: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff6ec" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#fff6ec" stop-opacity=".92"/>
          <stop offset="1" stop-color="#fff6ec" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <g fill="#f79a0d" fill-opacity=".18">
        <path d="M62 18 78 52l38 4-29 24 9 36-34-18-33 18 9-36L9 56l38-4 15-34Z"/>
        <circle cx="140" cy="46" r="18"/>
        <circle cx="180" cy="78" r="12" fill-opacity=".12"/>
        <path d="M118 102c18-18 43-30 74-35" stroke="#f79a0d" stroke-opacity=".18" stroke-width="6" stroke-linecap="round" fill="none"/>
      </g>
    </svg>
  `,
  },
};

export default manifest;
