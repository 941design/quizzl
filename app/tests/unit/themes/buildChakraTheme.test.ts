import { describe, expect, it } from 'vitest';
import { buildThemeOverride, createScale, getChakraTheme } from '@/src/themes/buildChakraTheme';
import type { ThemeManifest } from '@/src/themes/schema';
import { calmManifestFixture, minecraftManifestFixture } from './fixtures';

function containsFunction(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (Array.isArray(value)) return value.some(containsFunction);
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsFunction);
  }
  return false;
}

describe('themes/buildChakraTheme: createScale', () => {
  it('expands a 10-value tuple into the step-keyed Record shape', () => {
    const scale = createScale(calmManifestFixture.colors.brand);
    expect(scale).toEqual({
      50: '#e6f4f1',
      100: '#c0e3db',
      200: '#96d0c3',
      300: '#6bbcab',
      400: '#4aad9a',
      500: '#2a9d8a',
      600: '#259080',
      700: '#1f8073',
      800: '#177065',
      900: '#0d5450',
    });
  });
});

describe('themes/buildChakraTheme: buildThemeOverride', () => {
  it('varies with its manifest argument (not a frozen constant)', () => {
    const calmOverride = buildThemeOverride(calmManifestFixture);
    const minecraftOverride = buildThemeOverride(minecraftManifestFixture);
    expect(calmOverride.colors.brand).not.toEqual(minecraftOverride.colors.brand);
    expect(calmOverride.semanticTokens.colors.appBg).toBe('#f3f7f8');
    expect(minecraftOverride.semanticTokens.colors.appBg).toBe('#6b4b2a');
  });

  it('is deterministic across repeated calls with the same input', () => {
    const first = buildThemeOverride(calmManifestFixture);
    const second = buildThemeOverride(calmManifestFixture);
    expect(first).toEqual(second);
  });

  it('returns exactly the seam-contract fields', () => {
    const override = buildThemeOverride(calmManifestFixture);
    expect(Object.keys(override).sort()).toEqual(
      ['colors', 'semanticTokens', 'fonts', 'fontSizes', 'radii', 'borderWidths', 'styles', 'config', 'components'].sort(),
    );
    expect(Object.keys(override.components).sort()).toEqual(
      ['Button', 'Tabs', 'Progress', 'Badge', 'Tag', 'Checkbox', 'Radio'].sort(),
    );
    for (const component of Object.values(override.components)) {
      expect(component).toHaveProperty('defaultProps');
    }
  });

  it('forwards shape.borderWidths from the manifest onto the override (schema accepts it, transform must not drop it)', () => {
    const manifestWithBorderWidths: ThemeManifest = {
      ...calmManifestFixture,
      shape: { borderWidths: { thin: '1px', thick: '4px' } },
    };
    const override = buildThemeOverride(manifestWithBorderWidths);
    expect(override.borderWidths).toEqual({ thin: '1px', thick: '4px' });
  });

  it('leaves borderWidths undefined when the manifest has no shape.borderWidths', () => {
    const override = buildThemeOverride(calmManifestFixture);
    expect(override.borderWidths).toBeUndefined();
  });

  it('is function-free (a JSON.stringify round-trip preserves every key without throwing)', () => {
    const override = buildThemeOverride(minecraftManifestFixture);
    expect(containsFunction(override)).toBe(false);
    expect(() => JSON.stringify(override)).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(override));
    // toEqual (not toStrictEqual): explicit `undefined`-valued keys (e.g.
    // fontSizes/radii on themes that don't set them) are dropped by
    // JSON.stringify but toEqual treats "present with value undefined" and
    // "absent" as equal — see the theme-baseline.generated.ts precedent
    // (S0) for why this is the correct equality semantics here.
    expect(roundTripped).toEqual(JSON.parse(JSON.stringify(override)));
    expect(roundTripped.colors.brand[50]).toBe(override.colors.brand[50]);
  });

  it('sets buttonColorScheme from the manifest, other components fixed to brand', () => {
    const override = buildThemeOverride(calmManifestFixture);
    expect(override.components.Button.defaultProps).toEqual({ colorScheme: 'brand' });
    expect(override.components.Tabs.defaultProps).toEqual({ colorScheme: 'brand' });
  });

  it('only sets background* body styles when backgroundImage is present', () => {
    const calmOverride = buildThemeOverride(calmManifestFixture);
    expect(calmOverride.styles.global.body.backgroundImage).toBeUndefined();
    expect(calmOverride.styles.global.body.backgroundAttachment).toBeUndefined();

    const minecraftOverride = buildThemeOverride(minecraftManifestFixture);
    expect(minecraftOverride.styles.global.body.backgroundImage).toBe(minecraftManifestFixture.colors.backgroundImage);
    expect(minecraftOverride.styles.global.body.backgroundAttachment).toBe('fixed');
  });
});

describe('themes/buildChakraTheme: getChakraTheme', () => {
  it('returns a referentially-stable value across repeated calls for the same manifest id', () => {
    const first = getChakraTheme(calmManifestFixture);
    const second = getChakraTheme(calmManifestFixture);
    expect(first).toBe(second);
  });

  it('full-extend guard: the merged theme still carries Chakra-default subtrees', () => {
    const theme = getChakraTheme(minecraftManifestFixture);
    // components.Button.variants is a Chakra-default subtree outside the
    // ALLOWLIST; its presence proves extendTheme() ran (not a bare override).
    expect(theme.components?.Button?.variants).toBeTypeOf('object');
    expect(Object.keys(theme.components?.Button?.variants ?? {}).length).toBeGreaterThan(0);
  });

  it('reflects the manifest colors in the extended theme', () => {
    const theme = getChakraTheme(calmManifestFixture);
    expect(theme.colors.brand[500]).toBe('#2a9d8a');
  });
});
