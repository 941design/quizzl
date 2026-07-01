// app/tests/unit/themes/parity.test.ts
//
// AC-PARITY-1 (spec AC9) and AC-PARITY-2 (spec AC12) — the S2 "highest-risk"
// story guarantees: migrating the five themes into manifests must not
// change a single byte of the Chakra theme output the app renders with.
//
// AC-PARITY-1 asserts genuine equality against the PRE-EXISTING, already
// committed `app/tests/unit/theme-baseline.generated.ts` (captured by S0's
// `capture-theme-baseline.mjs` against the unmodified, pre-refactor
// `app/src/lib/theme.ts` — see that script and this repo's `git log` for
// provenance). This test does NOT re-derive an expectation from the new
// manifests; it deep-equals the frozen baseline fixture, so a
// hex/font/radii/component-defaultProps regression introduced anywhere in
// this story's migration is caught.
//
// Per the baseline file's own header: use `toEqual`, NEVER `toStrictEqual`.
// `theme-baseline.generated.ts` is a JSON literal and cannot represent an
// own-enumerable key whose value is `undefined` (e.g.
// `styles.global.body.backgroundImage: undefined` for calm/playful, which
// have no backgroundImage). `toEqual` treats an undefined-valued key as
// equal to an absent key; `toStrictEqual` does not and would spuriously fail.
import { describe, expect, it } from 'vitest';
import { getChakraTheme, getThemeDefinition } from '@/src/themes/index';
import { baseline, type ThemeBaselineId } from '../theme-baseline.generated';

const THEME_IDS: ThemeBaselineId[] = ['calm', 'playful', 'lego', 'minecraft', 'flower'];

/** The fixed AC-PARITY-1 ALLOWLIST (architecture.md Implementation Constraint 4 / spec.md §6.8). */
const COMPONENT_NAMES = ['Button', 'Tabs', 'Progress', 'Badge', 'Tag', 'Checkbox', 'Radio'] as const;

function pickAllowlist(theme: unknown) {
  const t = theme as {
    colors: unknown;
    semanticTokens: unknown;
    fonts: unknown;
    fontSizes: unknown;
    radii: unknown;
    styles: unknown;
    config: unknown;
    components: Record<string, { defaultProps?: unknown; variants?: unknown }>;
  };

  return {
    colors: t.colors,
    semanticTokens: t.semanticTokens,
    fonts: t.fonts,
    fontSizes: t.fontSizes,
    radii: t.radii,
    styles: t.styles,
    config: t.config,
    components: Object.fromEntries(
      COMPONENT_NAMES.map((name) => [name, { defaultProps: t.components[name]?.defaultProps }])
    ),
  };
}

describe('AC-PARITY-1: getChakraTheme(id) is byte-identical to the pre-refactor baseline', () => {
  it.each(THEME_IDS)('%s: ALLOWLIST subtrees deep-equal the committed S0 baseline', (id) => {
    const theme = getChakraTheme(id);
    // toEqual (NOT toStrictEqual) per theme-baseline.generated.ts's header — see file-header note above.
    expect(pickAllowlist(theme)).toEqual(baseline[id]);
  });

  it.each(THEME_IDS)(
    '%s: full-extend guard — components.Button.variants is a non-empty Chakra-default object',
    (id) => {
      const theme = getChakraTheme(id) as { components: { Button: { variants?: Record<string, unknown> } } };
      // ALLOWLIST deliberately excludes Chakra-default subtrees like
      // components.Button.variants (they live outside the allowlist because
      // they are large and Chakra-owned). This assertion exists purely to
      // catch a regression where getChakraTheme returns the bare override
      // object instead of extendTheme(override) — in that failure mode,
      // .variants would be undefined/empty because the Chakra-default
      // Button component config was never merged in.
      expect(theme.components.Button.variants).toBeTruthy();
      expect(typeof theme.components.Button.variants).toBe('object');
      expect(Object.keys(theme.components.Button.variants as object).length).toBeGreaterThan(0);
    }
  );
});

describe('AC-PARITY-2: minecraft contentSurface + pixel-font fontSizes invariants (spec AC12)', () => {
  it('effective contentSurface is truthy for minecraft and falsy for the other four', () => {
    // "effective contentSurface" here is read the same way the contrast
    // gate and useThemeStyles will read it: the manifest's top-level
    // (optional) `contentSurface` boolean, via the public getThemeDefinition API.
    expect(getThemeDefinition('minecraft').contentSurface).toBeTruthy();
    expect(getThemeDefinition('calm').contentSurface).toBeFalsy();
    expect(getThemeDefinition('playful').contentSurface).toBeFalsy();
    expect(getThemeDefinition('lego').contentSurface).toBeFalsy();
    expect(getThemeDefinition('flower').contentSurface).toBeFalsy();
  });

  it('minecraft fontSizes scale is enlarged for pixel-font legibility', () => {
    const theme = getChakraTheme('minecraft') as { fontSizes: Record<string, string> };
    const { fontSizes } = theme;
    expect(parseFloat(fontSizes.md)).toBeGreaterThanOrEqual(1.1);
    expect(parseFloat(fontSizes.lg)).toBeGreaterThan(parseFloat(fontSizes.md));
    expect(parseFloat(fontSizes['4xl'])).toBeGreaterThan(parseFloat(fontSizes.xl));
  });
});
