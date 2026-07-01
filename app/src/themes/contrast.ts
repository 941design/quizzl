// app/src/themes/contrast.ts
//
// wcagRatio(hex, hex) + evaluateThemeContrast(manifest) -> {pass, failures[]}.
// Pure math + the §6.7 pair rules — no imports at all (architecture.md
// Boundary Rules: "contrast -> (nothing; pure math + the pair rules)"; must
// be zod-free per AC-BOUND-1).
//
// Computes WCAG contrast from ACTUAL hex values only — NEVER from
// `colorScheme`/`contentSurface` booleans as a shortcut (architecture.md
// Implementation Constraint 1). `contentSurface` is used only to decide
// WHICH pairs apply, never as a substitute for measuring a pair's ratio.
import type { ThemeManifest } from './schema';

/** WCAG 2.x "AA, normal text" contrast threshold. */
export const WCAG_AA_THRESHOLD = 4.5;

/** Matches a bare 3- or 6-digit hex color, with or without a leading `#`. */
const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$/;

/**
 * True when `value` is a 3- or 6-digit hex color. Manifest color tokens are
 * typed as bare `z.string()` in schema.ts (no hex constraint), so a theme
 * author could supply a named color, `rgb()`/`rgba()`, or `hsl()` — this
 * guards `evaluateThemeContrast` against silently passing such a value
 * (see the FAIL-LOUD contract on `evaluateThemeContrast` below).
 */
function isParsableHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const full = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [r, g, b];
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/**
 * WCAG contrast ratio between two colors, computed from their actual hex
 * values. Order-independent — `(lighter luminance + 0.05) / (darker
 * luminance + 0.05)`.
 */
export function wcagRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Manifest color-token keys usable as either side of a contrast pair. */
type ColorToken = keyof ThemeManifest['colors'] & string;

export type ContrastFailure = {
  textToken: ColorToken;
  surfaceToken: ColorToken;
  ratio: number;
  /**
   * Present only for the unparseable-color case: names the offending
   * token(s) and their raw value(s) so a caller can report a fixable error
   * instead of a bare NaN ratio.
   */
  reason?: string;
};

export type ContrastResult = {
  pass: boolean;
  failures: ContrastFailure[];
};

/** Required for every theme, regardless of `contentSurface` (spec.md §6.7). */
const ALWAYS_REQUIRED_PAIRS: Array<[ColorToken, ColorToken]> = [
  ['textStrong', 'surfaceBg'],
  ['textMuted', 'surfaceBg'],
  ['textStrong', 'surfaceMutedBg'],
  ['textMuted', 'surfaceMutedBg'],
  ['textStrong', 'surfaceRaisedBg'],
  ['textMuted', 'surfaceRaisedBg'],
  ['successText', 'successBg'],
  ['warningText', 'warningBg'],
  ['dangerText', 'dangerBg'],
];

/**
 * Required only when `contentSurface` is falsy — page text rendered
 * directly on the app background. Exempt when `contentSurface` is true,
 * since page content then floats on `surfaceBg` instead (spec.md §6.7).
 */
const CONTENT_SURFACE_EXEMPT_PAIRS: Array<[ColorToken, ColorToken]> = [
  ['textStrong', 'appBg'],
  ['textMuted', 'appBg'],
];

/**
 * Evaluates a manifest's real (hex-value) contrast against every required
 * `(text, surface)` pair in spec.md §6.7, at the AA 4.5:1 threshold. Each
 * failure names the failing token pair and its computed ratio so a caller
 * (themes-validation.test.ts, story S3) can report "theme id + pair +
 * ratio" per AC-VAL-1.
 *
 * FAIL-LOUD contract: a color token that is not a parseable 3-/6-digit hex
 * value (a named CSS color, `rgb()`/`rgba()`, `hsl()`, etc.) is treated as a
 * gate FAILURE for that pair, not a silent pass. Without this, an
 * unparseable value would drive `wcagRatio` to NaN, and `NaN < 4.5` is
 * `false` — the exact shape of the bug this gate exists to catch (a theme
 * with illegible contrast slipping through because the check itself
 * couldn't compute a ratio).
 */
export function evaluateThemeContrast(manifest: ThemeManifest): ContrastResult {
  const pairs = manifest.contentSurface
    ? ALWAYS_REQUIRED_PAIRS
    : [...ALWAYS_REQUIRED_PAIRS, ...CONTENT_SURFACE_EXEMPT_PAIRS];

  const failures: ContrastFailure[] = [];
  for (const [textToken, surfaceToken] of pairs) {
    const textColor = manifest.colors[textToken] as string;
    const surfaceColor = manifest.colors[surfaceToken] as string;
    const textOk = isParsableHexColor(textColor);
    const surfaceOk = isParsableHexColor(surfaceColor);

    if (!textOk || !surfaceOk) {
      const badTokens = [
        !textOk ? `${textToken}="${textColor}"` : null,
        !surfaceOk ? `${surfaceToken}="${surfaceColor}"` : null,
      ].filter((entry): entry is string => entry !== null);
      failures.push({
        textToken,
        surfaceToken,
        ratio: NaN,
        reason: `unparseable color value(s) — only 3- or 6-digit hex is supported: ${badTokens.join(', ')}`,
      });
      continue;
    }

    const ratio = wcagRatio(textColor, surfaceColor);
    if (ratio < WCAG_AA_THRESHOLD) {
      failures.push({ textToken, surfaceToken, ratio });
    }
  }

  return { pass: failures.length === 0, failures };
}
