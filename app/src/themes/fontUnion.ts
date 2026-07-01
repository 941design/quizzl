// app/src/themes/fontUnion.ts
//
// buildThemeFonts(manifests) -> FontLoad[] (deduplicated union across all
// manifests) and buildFontLinkHref(fonts) -> string (the Google Fonts CSS2
// <link> href). Pure — no `@chakra-ui/react`, no runtime `schema.ts` import
// (architecture.md Boundary Rules: "fontUnion -> (nothing; pure ...)"; this
// module must itself be zod-free per AC-BOUND-1, since registry.generated.ts
// imports `buildThemeFonts` from here and is client-bundle-reachable).
//
// `ThemeManifest` is imported as a TYPE ONLY — fontUnion.ts has no runtime
// dependency edge to schema.ts.
import type { ThemeManifest } from './schema';

/**
 * A font family plus the load axes (weights / italic / subset) needed to
 * reproduce one Google Fonts CSS2 request line. Structurally mirrors (but is
 * declared independently of) `ThemeManifest['typography']['fontLoad'][number]`
 * — schema.ts has no dependency edge to fontUnion.ts, so the two are kept in
 * sync by hand rather than shared via import.
 */
export type FontLoad = {
  family: string;
  weights?: number[];
  ital?: boolean;
  subset?: string;
};

/**
 * Deduplicates `fontLoad` entries across all manifests by family name. When
 * the same family appears in more than one manifest, the union of `weights`
 * is taken (sorted ascending) and `ital` is OR'd, so a single font `<link>`
 * covers every theme that uses the family.
 */
export function buildThemeFonts(manifests: ThemeManifest[]): FontLoad[] {
  const byFamily = new Map<string, FontLoad>();

  for (const manifest of manifests) {
    for (const font of manifest.typography.fontLoad) {
      const existing = byFamily.get(font.family);
      if (!existing) {
        byFamily.set(font.family, {
          family: font.family,
          ...(font.weights ? { weights: [...font.weights].sort((a, b) => a - b) } : {}),
          ...(font.ital !== undefined ? { ital: font.ital } : {}),
          ...(font.subset !== undefined ? { subset: font.subset } : {}),
        });
        continue;
      }

      if (font.ital) {
        existing.ital = true;
      }
      if (font.weights && font.weights.length > 0) {
        const merged = new Set([...(existing.weights ?? []), ...font.weights]);
        existing.weights = Array.from(merged).sort((a, b) => a - b);
      }
      if (font.subset && !existing.subset) {
        existing.subset = font.subset;
      }
    }
  }

  return Array.from(byFamily.values());
}

function encodeFamily(family: string): string {
  return family.replace(/ /g, '+');
}

/**
 * Per-family axis encoding per spec.md §6.5: ital-only -> `:ital@0;1`;
 * weights-only -> `:wght@w1;w2;...` (ascending); both -> generalized
 * `:ital,wght@0,w1;1,w1;0,w2;1,w2;...` pairs (the single-weight form,
 * `:ital,wght@0,w1;1,w1`, is the only combination named in the spec's
 * worked example — no current font uses both axes together, so the
 * multi-weight extension here is a reasoned generalization, not yet
 * exercised by a byte-parity test); neither -> `''` (bare family name).
 */
function encodeAxes(font: FontLoad): string {
  const hasItal = Boolean(font.ital);
  const weights = font.weights && font.weights.length > 0 ? [...font.weights].sort((a, b) => a - b) : undefined;

  if (hasItal && weights) {
    const pairs = weights.flatMap((w) => [`0,${w}`, `1,${w}`]);
    return `:ital,wght@${pairs.join(';')}`;
  }
  if (hasItal) {
    return ':ital@0;1';
  }
  if (weights) {
    return `:wght@${weights.join(';')}`;
  }
  return '';
}

/**
 * Deterministic, locale/ICU-independent ordering of two family names by
 * UTF-16 code unit — NOT `localeCompare`. This repo is developed across
 * macOS-ARM and Linux-x86 (see CLAUDE.md), and `localeCompare`'s ordering
 * can vary by platform/ICU version, which would risk a non-deterministic
 * font-URL family order and break the byte-identical AC-FONT-1 parity for
 * future families with shared prefixes, spaces, digits, or diacritics.
 */
function compareFamilyCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Builds the Google Fonts CSS2 `<link>` href for a set of fonts: families
 * sorted by deterministic code-unit order (see `compareFamilyCodeUnits`),
 * each encoded per `encodeAxes`, suffixed with `&display=swap`. Pure — no
 * manifest/schema/Chakra dependency. The byte-for-byte parity assertion
 * against `_document.tsx`'s hardcoded URL lands in story S3, once the five
 * real manifests exist.
 */
export function buildFontLinkHref(fonts: FontLoad[]): string {
  const sorted = [...fonts].sort((a, b) => compareFamilyCodeUnits(a.family, b.family));
  const familyParams = sorted.map((font) => `family=${encodeFamily(font.family)}${encodeAxes(font)}`);
  return `https://fonts.googleapis.com/css2?${familyParams.join('&')}&display=swap`;
}
