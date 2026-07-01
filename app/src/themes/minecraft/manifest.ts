// app/src/themes/minecraft/manifest.ts
//
// The "Minecraft" (Block World) theme manifest — migrated field-for-field
// from app/src/lib/theme.ts's pre-refactor `minecraftTheme` /
// `minecraftThemeBackground` (theme.ts:473-578) and `APP_THEMES.minecraft`
// (theme.ts:708-720), plus the `pixel` visual-style treatment blocks from
// useThemeStyles.ts (cardOverlay/buttonOverlay/navOverlay/surfaceOverlay/
// contentPanel 'pixel' cases) and its BANNER_SVG.pixel entry.
//
// minecraft is the only migrated theme with `contentSurface: true` — its
// appBg (#6b4b2a, dark brown) fails the always-required text/appBg contrast
// pair for a page painted directly on appBg, so page content instead floats
// on a light `surfaceBg` panel (the `contentPanel: 'panel'` treatment).
// `colorScheme: 'dark'` here is descriptive metadata only (per architecture.md:
// "never trusted by the contrast gate") — the contrast gate (S3) reads
// `contentSurface` explicitly, not `colorScheme`.
//
// Pure data: no Chakra import, no functions, no runtime schema.ts import.
// Values copied verbatim — no re-tuning (including the ~12%-enlarged
// pixel-font `fontSizes` scale already present in theme.ts).
import type { ThemeManifest } from '../schema';

export const manifest: ThemeManifest = {
  id: 'minecraft',
  order: 4,
  label: { en: 'Block World', de: 'Blockwelt' },
  description: {
    en: 'Earthy block tones, squared surfaces, and a pixelated backdrop.',
    de: 'Erdige Blockfarben, eckige Flächen und ein verpixelter Hintergrund.',
  },
  previewColorScheme: 'brand',
  colorScheme: 'dark',
  colors: {
    brand: [
      '#edf5e1',
      '#d8e7bf',
      '#c0d69a',
      '#a4c26f',
      '#8eb04d',
      '#759a2f',
      '#648526',
      '#536f1e',
      '#425917',
      '#2b3b0c',
    ],
    success: [
      '#ebf7e7',
      '#cfe8c5',
      '#b2d8a2',
      '#93c87d',
      '#79b962',
      '#5f9d47',
      '#52883b',
      '#46722f',
      '#385c24',
      '#243a14',
    ],
    warning: [
      '#fdf2db',
      '#f2ddb0',
      '#e5c682',
      '#d7ae54',
      '#ca9a31',
      '#b48014',
      '#9c6f0f',
      '#835d0a',
      '#6b4b06',
      '#442e00',
    ],
    danger: [
      '#f8e8e0',
      '#e9c2b0',
      '#d89a80',
      '#c67253',
      '#b95234',
      '#a53c1b',
      '#8f3315',
      '#782a10',
      '#61220b',
      '#3f1404',
    ],
    neutral: [
      '#f3f0eb',
      '#ddd3c5',
      '#c3b49f',
      '#a89379',
      '#8b755a',
      '#6d583f',
      '#584731',
      '#453726',
      '#32271b',
      '#211811',
    ],
    appBg: '#6b4b2a',
    backgroundImage:
      'linear-gradient(180deg, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.03) 50%), linear-gradient(90deg, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.03) 50%), linear-gradient(180deg, #7aa35a 0%, #5a7a3d 18%, #6b4b2a 18%, #6b4b2a 100%)',
    surfaceBg: '#f3efe8',
    surfaceMutedBg: '#ded5c5',
    surfaceRaisedBg: '#fff9f0',
    borderSubtle: '#8b755a',
    borderStrong: '#4a351f',
    textMuted: '#5d4d3d',
    textStrong: '#25170a',
    successBg: '#edf7e7',
    successBorder: '#9dc77a',
    successText: '#30561c',
    warningBg: '#f8ecd2',
    warningBorder: '#caa04c',
    warningText: '#6a4708',
    dangerBg: '#f7e9e2',
    dangerBorder: '#c9886e',
    dangerText: '#6e2410',
    buttonColorScheme: 'brand',
  },
  typography: {
    fonts: {
      heading: '"Press Start 2P", "Trebuchet MS", monospace',
      body: '"VT323", "Trebuchet MS", monospace',
    },
    fontLoad: [{ family: 'Press Start 2P' }, { family: 'VT323' }],
    fontSizes: {
      xs: '0.8rem',
      sm: '0.95rem',
      md: '1.12rem',
      lg: '1.25rem',
      xl: '1.35rem',
      '2xl': '1.5rem',
      '3xl': '1.8rem',
      '4xl': '2.1rem',
    },
  },
  shape: {
    radii: {
      sm: '2px',
      md: '4px',
      lg: '6px',
      xl: '8px',
      '2xl': '10px',
      full: '9999px',
    },
  },
  treatments: {
    card: 'pixelBevel',
    button: 'pixelBevel',
    nav: 'pixelBevel',
    surface: 'grid',
    iconSet: 'pixel',
    // Verbatim from useThemeStyles.ts's BANNER_SVG.pixel (pre-refactor).
    banner: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128" shape-rendering="crispEdges">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#edf4e8" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#edf4e8" stop-opacity=".92"/>
          <stop offset="1" stop-color="#edf4e8" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <g transform="translate(14 28)">
        <rect x="0" y="0" width="24" height="24" fill="#759a2f" fill-opacity=".32"/>
        <rect x="24" y="0" width="24" height="24" fill="#759a2f" fill-opacity=".24"/>
        <rect x="48" y="0" width="24" height="24" fill="#759a2f" fill-opacity=".3"/>
        <rect x="72" y="0" width="24" height="24" fill="#759a2f" fill-opacity=".22"/>
        <rect x="0" y="24" width="24" height="24" fill="#6b4b2a" fill-opacity=".24"/>
        <rect x="24" y="24" width="24" height="24" fill="#6b4b2a" fill-opacity=".3"/>
        <rect x="48" y="24" width="24" height="24" fill="#6b4b2a" fill-opacity=".22"/>
        <rect x="72" y="24" width="24" height="24" fill="#6b4b2a" fill-opacity=".28"/>
        <rect x="112" y="12" width="20" height="20" fill="#8bb64a" fill-opacity=".26"/>
        <rect x="132" y="32" width="20" height="20" fill="#8bb64a" fill-opacity=".18"/>
        <rect x="168" y="8" width="16" height="16" fill="#759a2f" fill-opacity=".18"/>
        <rect x="192" y="36" width="16" height="16" fill="#6b4b2a" fill-opacity=".18"/>
      </g>
    </svg>
  `,
    contentPanel: 'panel',
  },
  contentSurface: true,
};

export default manifest;
