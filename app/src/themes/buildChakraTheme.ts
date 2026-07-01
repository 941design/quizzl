// app/src/themes/buildChakraTheme.ts
//
// buildThemeOverride(manifest): pure, function-free ThemeManifest -> Chakra
// theme-override transform (the object passed to `extendTheme`). Plus a
// cached `getChakraTheme` that wraps `extendTheme(buildThemeOverride(...))`
// with a referentially-stable, module-level cache (architecture.md
// Implementation Constraint 9).
//
// Design note on `getChakraTheme`'s signature (documented here since the
// story spec flagged this as an open structural question): architecture.md's
// Boundary Rules grant `buildChakraTheme -> @chakra-ui/react, treatments/*`
// only — there is no edge to `registry.generated.ts`, which does not exist
// yet at this story anyway. So `getChakraTheme` here is keyed by a full
// `ThemeManifest` (via `manifest.id`), NOT by an `AppThemeName` id string
// resolved against a registry. The seam contract's `getChakraTheme(id) =
// extendTheme(buildThemeOverride(APP_THEMES[id]))` form is realized once
// `index.ts` (which IS allowed to depend on both `registry.generated` and
// this module) wires `id -> manifest` lookups on top of this function in a
// later story. This keeps buildChakraTheme.ts fully registry-agnostic and
// independently testable now.
//
// `import type` only for ThemeManifest — no runtime dependency on schema.ts
// (AC-BOUND-1 / zod boundary).
import { extendTheme, type ThemeConfig } from '@chakra-ui/react';
import type { ThemeManifest } from './schema';

const CONFIG: ThemeConfig = {
  initialColorMode: 'light',
  useSystemColorMode: false,
};

type ColorScale = Record<number, string>;

/** Steps in `Scale10`'s tuple order (index 0 -> 50, ..., index 9 -> 900). */
const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/**
 * Expands a 10-value hex/CSS-color tuple (ascending 50 -> 900) into the
 * `Record<number, string>` shape Chakra's `colors` theme slot expects.
 * Lifted unchanged from app/src/lib/theme.ts:71's pre-refactor
 * `createScale()`.
 */
export function createScale(values: readonly string[]): ColorScale {
  const scale: ColorScale = {};
  SCALE_STEPS.forEach((step, index) => {
    scale[step] = values[index];
  });
  return scale;
}

/**
 * The object handed to `extendTheme`. Also carries `borderWidths` (forwarded
 * from `manifest.shape.borderWidths`, mirroring `radii`) — that field is
 * NOT part of AC-PARITY-1's ALLOWLIST (architecture.md Implementation
 * Constraint 4 / spec.md §6.8: colors, semanticTokens, fonts, fontSizes,
 * radii, styles, config, and per-component defaultProps for the seven
 * components the app configures), so its presence here does not affect
 * that parity check; it exists purely so a manifest declaring
 * `shape.borderWidths` (schema-valid per `ShapeSchema`) isn't silently
 * dropped by this transform.
 */
export type ThemeOverride = {
  colors: {
    brand: ColorScale;
    success: ColorScale;
    warning: ColorScale;
    danger: ColorScale;
    neutral: ColorScale;
  };
  semanticTokens: {
    colors: Record<string, string>;
  };
  fonts: {
    heading: string;
    body: string;
    display?: string;
  };
  fontSizes?: Record<string, string>;
  radii?: Record<string, string>;
  borderWidths?: Record<string, string>;
  styles: {
    global: {
      body: Record<string, unknown>;
    };
  };
  config: ThemeConfig;
  components: Record<
    'Button' | 'Tabs' | 'Progress' | 'Badge' | 'Tag' | 'Checkbox' | 'Radio',
    { defaultProps: Record<string, unknown> }
  >;
};

/**
 * Pure `ThemeManifest -> ThemeOverride` transform. Function-free and
 * JSON-round-trippable: every value in the returned object is a string,
 * number, boolean, plain object/array, or `undefined` — never a function.
 * Deterministic: repeated calls with the same manifest produce deep-equal
 * output.
 */
export function buildThemeOverride(manifest: ThemeManifest): ThemeOverride {
  const { colors, typography, shape } = manifest;
  const backgroundImage = colors.backgroundImage;

  return {
    colors: {
      brand: createScale(colors.brand),
      success: createScale(colors.success),
      warning: createScale(colors.warning),
      danger: createScale(colors.danger),
      neutral: createScale(colors.neutral),
    },
    semanticTokens: {
      colors: {
        appBg: colors.appBg,
        surfaceBg: colors.surfaceBg,
        surfaceMutedBg: colors.surfaceMutedBg,
        surfaceRaisedBg: colors.surfaceRaisedBg,
        borderSubtle: colors.borderSubtle,
        borderStrong: colors.borderStrong,
        textMuted: colors.textMuted,
        textStrong: colors.textStrong,
        successBg: colors.successBg,
        successBorder: colors.successBorder,
        successText: colors.successText,
        warningBg: colors.warningBg,
        warningBorder: colors.warningBorder,
        warningText: colors.warningText,
        dangerBg: colors.dangerBg,
        dangerBorder: colors.dangerBorder,
        dangerText: colors.dangerText,
      },
    },
    fonts: {
      heading: typography.fonts.heading,
      body: typography.fonts.body,
      ...(typography.fonts.display !== undefined ? { display: typography.fonts.display } : {}),
    },
    fontSizes: typography.fontSizes,
    radii: shape?.radii,
    borderWidths: shape?.borderWidths,
    styles: {
      global: {
        body: {
          bg: 'appBg',
          color: 'textStrong',
          backgroundImage,
          backgroundAttachment: backgroundImage ? 'fixed' : undefined,
          backgroundPosition: backgroundImage ? 'center top' : undefined,
          backgroundRepeat: backgroundImage ? 'repeat' : undefined,
          backgroundSize: backgroundImage ? 'auto' : undefined,
        },
      },
    },
    config: CONFIG,
    components: {
      Button: { defaultProps: { colorScheme: colors.buttonColorScheme } },
      Tabs: { defaultProps: { colorScheme: 'brand' } },
      Progress: { defaultProps: { colorScheme: 'brand' } },
      Badge: { defaultProps: { colorScheme: 'brand' } },
      Tag: { defaultProps: { colorScheme: 'brand' } },
      Checkbox: { defaultProps: { colorScheme: 'brand' } },
      Radio: { defaultProps: { colorScheme: 'brand' } },
    },
  };
}

/** The full Chakra theme object returned by `extendTheme`. */
export type ChakraTheme = ReturnType<typeof extendTheme>;

const themeCache = new Map<string, ChakraTheme>();

/**
 * `extendTheme(buildThemeOverride(manifest))`, cached by `manifest.id` so
 * repeated calls for the same theme return a referentially-stable object
 * (avoids ChakraProvider re-render churn — architecture.md Implementation
 * Constraint 9, matching the pre-refactor prebuilt `chakraTheme` behavior).
 */
export function getChakraTheme(manifest: ThemeManifest): ChakraTheme {
  const cached = themeCache.get(manifest.id);
  if (cached) return cached;
  const built = extendTheme(buildThemeOverride(manifest));
  themeCache.set(manifest.id, built);
  return built;
}
