// app/src/themes/aquarelle/manifest.ts
//
// The "Aquarelle" theme manifest — Phase B, Story S8 (architecture.md Module
// Map: "aquarelle theme (S8, NEW)"; acceptance-criteria.md AC-THEME-1/
// AC-THEME-2/AC-UX-6). A brand-new light theme (NOT derived from an
// existing theme's palette) built to exercise `treatments.dynamic.banner`
// end to end against the real `@rotheric/visuals` engine (wired in S7).
//
// Identity: a soft indigo/violet watercolor wash (anchorHue 250,
// scheme 'analogous') — distinct from every existing theme's hue (calm
// teal ~166, playful orange ~37, lego yellow ~45, minecraft green ~83,
// flower pink ~330). brand.500 (#4a35b6) and the pinned StyleToken below
// share the same hue family so the static and generated banners read as
// one coherent identity.
//
// treatments.dynamic.banner.render (S9, AC-PERF-3 — FINALIZES architecture.md's
// Open Questions entry: the `render` perf-knob field set is no longer an
// untyped z.record escape hatch left to guesswork; these are concrete,
// measured values): { zones: 2, layers: 3, darkening: 1, halo: 0,
// splatter: 0, smoothness: 28 }. Derived by reading the real engine's
// element-emission logic (tools/watercolor/svg.js, re-exported via
// @rotheric/visuals — no path-count/size knob is documented in the
// package's public README/d.ts, so this was reverse-engineered from source
// and confirmed empirically over 30 real, unseeded draws at this exact
// StyleToken):
//   - zones: 2 (the engine's usable minimum; PARAM_DEFS.zones = {min:2,
//     max:5}) with layers: 3 (an explicit `layers` value wins over the
//     randomized `layerProb` draw, per the engine's own precedence) fixes
//     the emitted <path> count at EXACTLY zones*layers = 6 on every call —
//     the ~6-path target, with zero observed variance.
//   - darkening: 1 disables the engine's second translucency pass for
//     multiply-blend zones (idx>0 && darkening<1 doubles that zone's path
//     group). Without pinning this, zones:2/layers:3 alone still produced
//     EITHER 6 or 9 paths nondeterministically, since darkening is
//     otherwise drawn at random per call — an interaction not documented
//     anywhere in the package's public surface, found empirically while
//     tuning this preset.
//   - halo: 0 and splatter: 0 suppress the two other conditionally-emitted
//     element groups (a <path> per zone when halo>0; a <circle> per
//     splatter unit when splatter>0), so the fixed 6 paths are the only
//     size-variable output; the engine's 3 <filter> defs, background
//     <rect>, and grain-overlay <rect> are always emitted regardless of
//     any `render` knob.
//   - smoothness: 28 (engine range 6-40) is the dominant remaining lever
//     over byte size once path count is fixed (it sets each path's point
//     count). Measured at this value (30 real draws): 8.4-9.6 KB, inside
//     the ~8-15 KB target with headroom before the ceiling. Lower values
//     (8-12) undershot at ~3.2-7 KB; this was tuned up from there.
//
// treatments.banner (the required static fallback, AC-STRUCT-2) is NOT
// hand-authored SVG like the five migrated themes' banners. It is captured
// verbatim from one real `DYNAMIC_GENERATORS.watercolor` call
// (app/src/themes/treatments/dynamicVisuals.ts) made with the EXACT
// StyleToken pinned in treatments.dynamic.banner.style below (anchorHue:
// 250, scheme: 'analogous', saturation: 55, lightness: 45) AND the
// finalized `render` lite-preset knobs above — this supersedes S8's
// no-render-override capture (~54.7KB, oversized; see git history for that
// prior capture and its own remediation note). This capture is exactly 8567
// characters — one real, unmodified draw from a small batch at these exact
// knobs (3 sampled; the middle-sized one was frozen, following S8's
// precedent of avoiding an outlier rather than defaulting to the smallest).
// Regenerate via: app/src/themes/treatments/dynamicVisuals.ts is the sole
// owner of the DYNAMIC_GENERATORS.watercolor call shape and its forced
// envelope (format/width/height, param assignment order) — do NOT hand-
// inline randomizeParams + Object.assign here, since that would duplicate
// a shape architecture.md's Seam Contract requires stay single-sourced.
// Regenerate by calling DYNAMIC_GENERATORS.watercolor(style, 'banner', render)
// directly from dynamicVisuals.ts, using this file's pinned StyleToken
// (anchorHue: 250, scheme: 'analogous', saturation: 55, lightness: 45) and
// render knobs (zones: 2, layers: 3, darkening: 1, halo: 0, splatter: 0,
// smoothness: 28) — see dynamicVisuals.ts for the current signature, since
// this comment intentionally does not re-encode it.
//
// Auto-detected by app/scripts/generate-theme-registry.mjs's folder-name-
// driven registry scan — zero edits to that script, to schema.ts (S1 already
// added the treatments.dynamic capability), to dynamicVisuals.ts, or to any
// other theme's manifest (AC-THEME-1). registry.generated.ts is regenerated
// (`npm run prebuild` / `node scripts/generate-theme-registry.mjs`) to pick
// up this folder — that generated-file diff is mechanical, not a hand edit.
//
// status: 'stable' (AC-THEME-2, S9) — flipped from 'experimental' now that
// AC-PERF-3's perf budget is measured green. Methodology and honest
// limitations (full detail in specs/epic-dynamic-theme-visuals/
// S9-performance-validation/result.json): generation cost was measured as
// real @rotheric/visuals `renderSVG` execution time at this exact preset,
// under Chrome DevTools Protocol CPU throttling (4x, Lighthouse's standard
// "low-end mobile" multiplier) in a real headless Chromium — the sandbox
// this session runs in has no reachable physical low-end device, so the 4x
// CDP throttle is a documented proxy, not a real-device measurement. Off-
// main-thread execution (Web Worker) and no-CLS (fixed reserved banner box,
// background-image-only swap) were already structurally verified in S3/S5
// and confirmed against a REAL browser and this exact aquarelle theme by
// S8's MV-1/MV-2 checks (epic-state.json manual_validation ledger: both
// "satisfied") — S9 does not repeat that work, only the perf budget itself.
//
// Pure data: no Chakra import, no functions, no runtime schema.ts import.
import type { ThemeManifest } from '../schema';

export const manifest: ThemeManifest = {
  id: 'aquarelle',
  order: 6,
  label: { en: 'Aquarelle', de: 'Aquarell' },
  description: {
    en: 'Soft indigo watercolor washes, generated fresh on every visit.',
    de: 'Sanfte indigofarbene Aquarellschlieren, bei jedem Besuch neu erzeugt.',
  },
  previewColorScheme: 'brand',
  status: 'stable',
  colorScheme: 'light',
  colors: {
    brand: ['#f1effa', '#d5d0f1', '#b2a8e6', '#8979d8', '#6651cd', '#4a35b6', '#3d2c96', '#302277', '#241957', '#171037'],
    success: ['#effaf4', '#d0f1de', '#a8e6c2', '#79d8a0', '#51cd85', '#35b66b', '#2c9658', '#227745', '#195733', '#103720'],
    warning: ['#fdf8ed', '#f9e9c8', '#f4d69a', '#eebf63', '#e9ad35', '#d39517', '#ae7b13', '#8a610f', '#65470b', '#402d07'],
    danger: ['#fbeef0', '#f4cdd3', '#eba2af', '#e17083', '#d8465e', '#c22942', '#a02237', '#7e1b2b', '#5d1420', '#3b0c14'],
    neutral: ['#f4f4f6', '#dedde4', '#c2c0ce', '#a19eb3', '#86819c', '#6c6783', '#59556d', '#464356', '#34313f', '#211f28'],
    appBg: '#f4efe6',
    surfaceBg: '#ffffff',
    surfaceMutedBg: '#f1eef9',
    surfaceRaisedBg: '#ffffff',
    borderSubtle: '#ded8f0',
    borderStrong: '#9c8fce',
    textMuted: '#5b5570',
    textStrong: '#1c1730',
    successBg: '#e8f7ee',
    successBorder: '#a9dfbf',
    successText: '#136a3c',
    warningBg: '#fff3d6',
    warningBorder: '#f0c96a',
    warningText: '#7a5400',
    dangerBg: '#fdeaea',
    dangerBorder: '#f1a8a3',
    dangerText: '#8a1f24',
    buttonColorScheme: 'brand',
  },
  typography: {
    fonts: {
      heading: '"Cormorant Garamond", Georgia, serif',
      body: '"Inter", system-ui, sans-serif',
    },
    fontLoad: [
      { family: 'Cormorant Garamond', weights: [500, 600, 700] },
      { family: 'Inter', weights: [400, 500, 600] },
    ],
  },
  shape: {
    radii: {
      sm: '8px',
      md: '14px',
      lg: '20px',
      xl: '26px',
      '2xl': '32px',
      full: '9999px',
    },
  },
  treatments: {
    card: 'softDrop',
    button: 'softDrop',
    nav: 'softDrop',
    surface: 'none',
    iconSet: 'line',
    // Frozen static fallback — see header comment for exact capture
    // provenance. ONE post-capture edit: the base rect's `fill` was changed
    // from the engine's opaque `#f4efe6` to `#f4efe600` (alpha 00,
    // transparent) so the fallback composites the same way the live dynamic
    // banner now does — the paper comes from the banner box's `bg="appBg"`
    // under `background-blend-mode: multiply` (Layout.tsx), never from an
    // opaque rect baked into the SVG. Without this, the fallback would
    // multiply its own paper against `appBg` and render visibly darker than
    // the dynamic banner it stands in for.
    banner: `<svg viewBox="0 0 420 96" xmlns="http://www.w3.org/2000/svg"><defs><filter id="edge-6088" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.0270" numOctaves="3" seed="6088" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="10.0" xChannelSelector="R" yChannelSelector="G"/></filter><filter id="grain-6088" x="0%" y="0%" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="6089"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.18 -0.05"/></filter><filter id="bloom-6088"><feGaussianBlur stdDeviation="0.00"/></filter></defs><rect x="0" y="0" width="420" height="96" fill="#f4efe600"/><g style="isolation: isolate; mix-blend-mode: multiply"><path d="M 82.28 62.72 C 80.54 64.23, 70.36 61.14, 66.96 62.11 C 63.56 63.08, 63.99 66.00, 61.89 68.55 C 59.80 71.09, 57.52 75.60, 54.39 77.40 C 51.25 79.20, 46.01 80.80, 43.08 79.35 C 40.15 77.89, 40.34 69.16, 36.82 68.67 C 33.31 68.17, 24.94 76.49, 21.96 76.39 C 18.98 76.28, 20.41 70.14, 18.94 68.01 C 17.46 65.88, 13.73 65.57, 13.13 63.58 C 12.52 61.59, 16.04 58.06, 15.32 56.09 C 14.59 54.11, 11.12 53.50, 8.78 51.74 C 6.45 49.97, 1.68 47.72, 1.29 45.47 C 0.90 43.22, 3.08 39.95, 6.45 38.23 C 9.81 36.51, 19.47 37.31, 21.49 35.15 C 23.52 32.99, 18.00 28.21, 18.58 25.28 C 19.16 22.36, 21.62 18.30, 24.97 17.59 C 28.31 16.88, 34.93 21.42, 38.65 21.04 C 42.37 20.66, 44.25 16.04, 47.27 15.31 C 50.29 14.58, 53.56 16.45, 56.78 16.65 C 60.00 16.85, 64.09 15.55, 66.57 16.50 C 69.06 17.45, 70.20 20.52, 71.71 22.33 C 73.21 24.13, 73.26 26.22, 75.61 27.34 C 77.96 28.46, 84.23 27.63, 85.80 29.06 C 87.38 30.50, 85.51 33.77, 85.06 35.95 C 84.60 38.12, 83.13 40.10, 83.07 42.11 C 83.01 44.12, 85.62 46.20, 84.68 48.02 C 83.74 49.83, 77.85 50.56, 77.45 53.01 C 77.05 55.46, 84.03 61.20, 82.28 62.72 Z" fill="hsla(221.7 43.9% 46.7% / 0.063)" style="filter: url(#edge-6088) blur(2.5px); mix-blend-mode: multiply"/><path d="M 7.51 70.07 C 4.25 67.91, -10.41 71.63, -12.27 69.45 C -14.13 67.27, -5.04 60.45, -3.64 56.99 C -2.23 53.53, -2.10 51.68, -3.83 48.69 C -5.56 45.70, -14.14 42.13, -14.04 39.06 C -13.94 35.98, -8.23 32.14, -3.23 30.23 C 1.77 28.33, 11.65 29.17, 15.97 27.63 C 20.29 26.08, 20.79 24.41, 22.68 20.97 C 24.56 17.52, 23.95 8.68, 27.27 6.97 C 30.60 5.26, 37.98 10.85, 42.63 10.69 C 47.28 10.54, 51.25 6.15, 55.17 6.02 C 59.10 5.89, 62.50 8.94, 66.18 9.93 C 69.86 10.92, 74.76 10.23, 77.25 11.97 C 79.74 13.71, 79.33 18.16, 81.11 20.35 C 82.89 22.54, 85.47 23.48, 87.93 25.12 C 90.39 26.76, 95.23 27.92, 95.85 30.19 C 96.47 32.46, 88.77 36.07, 91.66 38.71 C 94.55 41.36, 111.53 43.28, 113.17 46.06 C 114.81 48.83, 106.08 52.93, 101.50 55.35 C 96.91 57.77, 89.39 58.51, 85.65 60.56 C 81.90 62.60, 81.58 65.36, 79.04 67.63 C 76.49 69.89, 73.37 71.49, 70.37 74.14 C 67.37 76.79, 64.87 81.00, 61.01 83.54 C 57.15 86.08, 51.23 90.50, 47.22 89.38 C 43.21 88.26, 41.46 77.49, 36.96 76.81 C 32.46 76.13, 25.15 84.38, 20.21 85.31 C 15.27 86.24, 9.45 84.94, 7.33 82.40 C 5.22 79.86, 10.78 72.23, 7.51 70.07 Z" fill="hsla(214.6 47.0% 47.7% / 0.160)" style="filter: url(#edge-6088) blur(9.0px); mix-blend-mode: multiply"/><path d="M 122.29 19.42 C 125.06 22.44, 128.39 26.96, 124.88 30.99 C 121.37 35.02, 102.59 39.69, 101.24 43.60 C 99.89 47.51, 114.91 50.64, 116.78 54.43 C 118.65 58.22, 117.87 64.32, 112.44 66.34 C 107.02 68.36, 90.31 65.34, 84.25 66.55 C 78.20 67.76, 78.01 69.11, 76.13 73.61 C 74.25 78.10, 76.48 90.15, 72.99 93.52 C 69.49 96.89, 60.58 94.80, 55.15 93.82 C 49.71 92.84, 45.23 88.40, 40.37 87.64 C 35.51 86.87, 30.07 89.97, 25.97 89.23 C 21.87 88.48, 18.39 85.56, 15.75 83.18 C 13.11 80.79, 12.32 77.20, 10.15 74.90 C 7.97 72.61, 8.29 70.25, 2.72 69.42 C -2.86 68.58, -20.01 71.92, -23.30 69.88 C -26.60 67.84, -17.86 60.96, -17.06 57.17 C -16.25 53.38, -16.47 50.87, -18.50 47.14 C -20.52 43.41, -29.16 38.77, -29.22 34.79 C -29.27 30.80, -25.29 25.27, -18.82 23.23 C -12.36 21.19, 4.11 24.60, 9.59 22.54 C 15.06 20.48, 10.76 13.16, 14.01 10.86 C 17.27 8.55, 24.69 11.34, 29.13 8.71 C 33.56 6.08, 36.22 -4.09, 40.61 -4.93 C 44.99 -5.78, 50.97 1.75, 55.44 3.62 C 59.90 5.49, 61.25 8.10, 67.42 6.28 C 73.59 4.46, 88.99 -8.48, 92.48 -7.29 C 95.98 -6.10, 85.78 10.04, 88.41 13.41 C 91.03 16.78, 102.59 11.90, 108.23 12.91 C 113.88 13.91, 119.51 16.41, 122.29 19.42 Z" fill="hsla(211.6 40.4% 41.9% / 0.166)" style="filter: url(#edge-6088) blur(2.5px); mix-blend-mode: multiply"/></g><g style="isolation: isolate; mix-blend-mode: multiply"><path d="M 358.86 92.44 C 355.39 91.61, 353.25 88.02, 349.80 86.92 C 346.34 85.83, 341.32 87.06, 338.13 85.88 C 334.95 84.71, 331.09 82.76, 330.70 79.88 C 330.31 76.99, 335.94 71.31, 335.81 68.60 C 335.67 65.88, 332.76 65.42, 329.88 63.59 C 326.99 61.76, 320.47 60.04, 318.52 57.61 C 316.56 55.18, 315.71 51.33, 318.14 49.02 C 320.57 46.72, 330.44 45.98, 333.09 43.78 C 335.74 41.59, 333.46 38.79, 334.04 35.85 C 334.61 32.92, 334.17 28.29, 336.53 26.18 C 338.88 24.07, 344.35 23.83, 348.17 23.19 C 351.99 22.54, 355.87 23.12, 359.46 22.31 C 363.05 21.49, 366.33 18.33, 369.69 18.30 C 373.06 18.28, 376.50 21.11, 379.67 22.16 C 382.85 23.21, 386.22 23.27, 388.74 24.60 C 391.25 25.92, 392.87 28.38, 394.78 30.11 C 396.68 31.84, 397.96 33.52, 400.17 34.95 C 402.38 36.38, 405.69 37.12, 408.02 38.68 C 410.35 40.24, 414.42 42.06, 414.17 44.29 C 413.92 46.53, 408.02 49.81, 406.53 52.10 C 405.03 54.38, 404.44 55.66, 405.18 57.98 C 405.91 60.31, 411.40 63.89, 410.94 66.05 C 410.47 68.20, 403.73 68.29, 402.38 70.92 C 401.03 73.55, 404.93 79.91, 402.83 81.81 C 400.73 83.71, 393.18 80.67, 389.80 82.30 C 386.42 83.94, 385.74 90.03, 382.53 91.63 C 379.33 93.23, 374.53 91.76, 370.59 91.90 C 366.64 92.04, 362.32 93.27, 358.86 92.44 Z" fill="hsla(284.4 42.0% 46.7% / 0.063)" style="filter: url(#edge-6088) blur(2.5px); mix-blend-mode: multiply"/><path d="M 394.17 103.76 C 390.15 105.71, 380.37 97.70, 374.79 96.16 C 369.22 94.61, 366.44 93.19, 360.74 94.48 C 355.03 95.78, 344.28 105.48, 340.55 103.91 C 336.83 102.34, 339.83 89.48, 338.39 85.08 C 336.95 80.67, 336.49 79.05, 331.91 77.47 C 327.33 75.90, 316.68 77.53, 310.90 75.64 C 305.11 73.75, 295.55 69.86, 297.21 66.13 C 298.87 62.40, 320.29 57.73, 320.86 53.26 C 321.43 48.79, 302.18 43.53, 300.64 39.30 C 299.10 35.08, 307.93 31.61, 311.65 27.90 C 315.37 24.19, 317.78 19.09, 322.97 17.04 C 328.17 14.99, 336.96 16.17, 342.84 15.60 C 348.72 15.03, 353.16 15.46, 358.23 13.64 C 363.29 11.82, 368.00 5.76, 373.22 4.68 C 378.43 3.60, 384.77 5.44, 389.52 7.15 C 394.28 8.86, 398.11 12.31, 401.73 14.95 C 405.35 17.59, 406.61 21.10, 411.23 23.00 C 415.85 24.90, 426.38 23.65, 429.45 26.33 C 432.53 29.01, 431.62 34.97, 429.68 39.10 C 427.73 43.22, 415.78 47.15, 417.78 51.09 C 419.77 55.03, 439.23 58.79, 441.67 62.74 C 444.11 66.68, 437.48 72.00, 432.41 74.74 C 427.34 77.47, 416.81 77.52, 411.23 79.15 C 405.64 80.77, 401.76 80.38, 398.92 84.48 C 396.07 88.59, 398.19 101.82, 394.17 103.76 Z" fill="hsla(290.1 46.7% 49.3% / 0.205)" style="filter: url(#edge-6088) blur(9.0px); mix-blend-mode: multiply"/><path d="M 340.43 12.91 C 344.87 11.00, 349.31 8.77, 354.08 7.56 C 358.86 6.34, 363.46 8.15, 369.10 5.62 C 374.74 3.09, 382.00 -6.38, 387.93 -7.62 C 393.86 -8.86, 398.83 -3.38, 404.67 -1.82 C 410.50 -0.27, 417.81 -0.53, 422.95 1.70 C 428.09 3.94, 432.02 7.97, 435.49 11.59 C 438.97 15.21, 442.78 19.08, 443.79 23.42 C 444.80 27.77, 442.94 33.24, 441.57 37.66 C 440.20 42.08, 437.36 46.19, 435.57 49.96 C 433.78 53.74, 430.96 56.57, 430.82 60.32 C 430.69 64.08, 434.30 68.13, 434.77 72.49 C 435.24 76.85, 435.97 82.52, 433.62 86.47 C 431.28 90.42, 425.03 92.82, 420.69 96.20 C 416.36 99.58, 412.68 103.84, 407.64 106.73 C 402.59 109.61, 396.45 112.62, 390.41 113.52 C 384.36 114.42, 377.52 112.24, 371.36 112.10 C 365.19 111.96, 358.56 114.23, 353.40 112.67 C 348.24 111.11, 345.98 104.13, 340.41 102.74 C 334.85 101.35, 326.23 105.11, 320.03 104.35 C 313.83 103.59, 305.66 101.97, 303.21 98.18 C 300.75 94.40, 306.14 86.12, 305.30 81.62 C 304.45 77.13, 297.22 75.10, 298.12 71.23 C 299.02 67.35, 309.63 62.26, 310.71 58.38 C 311.80 54.50, 306.97 52.05, 304.65 47.96 C 302.32 43.87, 296.92 38.34, 296.79 33.82 C 296.65 29.31, 298.75 23.34, 303.85 20.87 C 308.96 18.41, 321.33 20.37, 327.42 19.04 C 333.52 17.72, 335.98 14.82, 340.43 12.91 Z" fill="hsla(289.0 45.8% 57.0% / 0.168)" style="filter: url(#edge-6088) blur(2.5px); mix-blend-mode: multiply"/></g><rect x="0" y="0" width="420" height="96" fill="#000" filter="url(#grain-6088)" opacity="0.6" style="mix-blend-mode: multiply"/></svg>`,
    dynamic: {
      banner: {
        generator: 'watercolor',
        style: {
          anchorHue: 250,
          scheme: 'analogous',
          saturation: 55,
          lightness: 45,
        },
        // Full-header fill preset. SUPERSEDES the S9 zones:2 "lite" preset
        // (~6 paths, ~9KB) documented in the header comment: that was tuned
        // for the small 420x96 corner box, but the banner now renders as the
        // FULL header background (Layout.tsx full-cover override for dynamic-
        // banner themes), where 2 zones leave the header centre empty. zones:5
        // + halo:8 spread five soft washes across the full width; measured
        // ~27KB at a 1280-wide header (above the old ~8-15KB budget, but the
        // banner is generated once, off the main thread — AC-PERF-2/3's CLS
        // and off-thread guarantees are unaffected).
        render: {
          zones: 5,
          layers: 3,
          darkening: 1,
          halo: 8,
          splatter: 0,
          smoothness: 28,
          // Transparent paper: the engine's base rect (index.js emits
          // `<rect fill="${baseColor}"/>`) is drawn with alpha 00 so the
          // watercolor washes + grain overlay carry NO opaque paper of their
          // own. The banner element instead composites straight onto the real
          // header background via `mix-blend-mode: multiply` (Layout.tsx, gated
          // to dynamic-banner themes), so the texture multiplies whatever is
          // behind the header exactly once — no duplicated paper layer. Set via
          // `render` (not `style`) because StyleToken is `.strict()` and rejects
          // `baseColor`, whereas `render` is an open record and
          // `Object.assign(p, render, style, …)` lets it survive (there is no
          // `style.baseColor` to overwrite it).
          baseColor: '#f4efe600',
        },
      },
    },
  },
};

export default manifest;
