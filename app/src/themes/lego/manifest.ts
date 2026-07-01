// app/src/themes/lego/manifest.ts
//
// The "Lego" (Brick Builder) theme manifest — migrated field-for-field from
// app/src/lib/theme.ts's pre-refactor `legoTheme` / `legoThemeBackground`
// (theme.ts:376-471) and `APP_THEMES.lego` (theme.ts:696-707), plus the
// `toy` visual-style treatment blocks from useThemeStyles.ts
// (cardOverlay/buttonOverlay/navOverlay/surfaceOverlay 'toy' cases) and its
// BANNER_SVG.toy entry. Icon set: ThemeIcon.tsx's ICON_MAP has no `rounded`
// key, so lego (old visualStyle 'toy') is the only migrated theme that maps
// to the `filled` icon set (`toy` key) rather than falling through to
// `line`/default.
//
// Pure data: no Chakra import, no functions, no runtime schema.ts import.
// Values copied verbatim — no re-tuning.
import type { ThemeManifest } from '../schema';

export const manifest: ThemeManifest = {
  id: 'lego',
  order: 3,
  label: { en: 'Brick Builder', de: 'Baustein' },
  description: {
    en: 'Bold brick colors, toy-like contrast, and a stud-patterned background.',
    de: 'Kräftige Steinfarben, spielzeughafte Kontraste und ein Noppen-Hintergrund.',
  },
  previewColorScheme: 'danger',
  colorScheme: 'light',
  colors: {
    brand: [
      '#fff3d6',
      '#ffe8a5',
      '#ffda73',
      '#ffcc42',
      '#ffc21f',
      '#f4b400',
      '#d89d00',
      '#ba8600',
      '#9c6f00',
      '#6f5000',
    ],
    success: [
      '#effbe4',
      '#d3f4b5',
      '#b4ec83',
      '#96e250',
      '#7fd925',
      '#67c100',
      '#58a900',
      '#499000',
      '#397600',
      '#264f00',
    ],
    warning: [
      '#fff2dc',
      '#ffd8a7',
      '#ffbc6f',
      '#ff9f39',
      '#ff8916',
      '#f26d00',
      '#d35d00',
      '#b04d00',
      '#8c3c00',
      '#5d2600',
    ],
    danger: [
      '#ffe8e3',
      '#ffc3b6',
      '#ff9986',
      '#ff6f58',
      '#ff4f33',
      '#f23b1f',
      '#d32f17',
      '#b02511',
      '#8d1b0b',
      '#5f1105',
    ],
    neutral: [
      '#fffef9',
      '#f4f0e2',
      '#e3dcc5',
      '#cfc4a5',
      '#b4a77e',
      '#927f58',
      '#6f5f40',
      '#53472f',
      '#392f1f',
      '#221b11',
    ],
    appBg: '#ffd44c',
    backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(180deg, #ffe36e 0%, #ffd44c 100%)',
    surfaceBg: '#fff8dd',
    surfaceMutedBg: '#ffeaa0',
    surfaceRaisedBg: '#fffdf2',
    borderSubtle: '#d3980b',
    borderStrong: '#ad2900',
    textMuted: '#6d5306',
    textStrong: '#332100',
    successBg: '#f0fae7',
    successBorder: '#8fd943',
    successText: '#2d6b00',
    warningBg: '#fff0d9',
    warningBorder: '#ffb15a',
    warningText: '#8f4a00',
    dangerBg: '#ffe8e2',
    dangerBorder: '#ff8f75',
    dangerText: '#8f1f00',
    buttonColorScheme: 'danger',
  },
  typography: {
    fonts: {
      heading: '"Fredoka", system-ui, sans-serif',
      body: '"Fredoka", system-ui, sans-serif',
    },
    fontLoad: [{ family: 'Fredoka', weights: [400, 500, 600, 700] }],
  },
  shape: {
    radii: {
      sm: '4px',
      md: '6px',
      lg: '10px',
      xl: '14px',
      '2xl': '18px',
      full: '9999px',
    },
  },
  treatments: {
    card: 'hardDrop',
    button: 'hardDrop',
    nav: 'hardDrop',
    surface: 'studs',
    iconSet: 'filled',
    // Verbatim from useThemeStyles.ts's BANNER_SVG.toy (pre-refactor).
    banner: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff4ef" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#fff4ef" stop-opacity=".92"/>
          <stop offset="1" stop-color="#fff4ef" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <g transform="translate(18 20)">
        <rect x="0" y="24" width="122" height="56" rx="12" fill="#f23b1f" fill-opacity=".24"/>
        <circle cx="26" cy="24" r="14" fill="#f23b1f" fill-opacity=".19"/>
        <circle cx="60" cy="24" r="14" fill="#f23b1f" fill-opacity=".19"/>
        <circle cx="94" cy="24" r="14" fill="#f23b1f" fill-opacity=".19"/>
        <rect x="78" y="0" width="82" height="42" rx="10" fill="#ffcf3c" fill-opacity=".18"/>
        <circle cx="102" cy="0" r="12" fill="#ffcf3c" fill-opacity=".15"/>
        <circle cx="136" cy="0" r="12" fill="#ffcf3c" fill-opacity=".15"/>
        <rect x="156" y="44" width="92" height="36" rx="10" fill="#2a6ef0" fill-opacity=".16"/>
        <circle cx="182" cy="44" r="11" fill="#2a6ef0" fill-opacity=".14"/>
        <circle cx="222" cy="44" r="11" fill="#2a6ef0" fill-opacity=".14"/>
      </g>
    </svg>
  `,
  },
};

export default manifest;
