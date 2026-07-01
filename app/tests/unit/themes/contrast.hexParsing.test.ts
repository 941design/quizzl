// app/tests/unit/themes/contrast.hexParsing.test.ts
//
// Mutation-gate gap-closing tests for app/src/themes/contrast.ts — the
// hex-parsing contract of the WCAG legibility gate. Table-driven example
// tests (repo convention; fast-check is not a dependency), asserting ONLY
// through the public API (`wcagRatio`, `evaluateThemeContrast`) — never the
// private `isParsableHexColor`/`hexToRgb`, so the tests survive refactors
// that move parsing around.
//
// Closes two classified real-gap survivors from the mutation run:
//   GAP 1 — the 3-digit hex shorthand expansion path was NoCoverage: no test
//           ever passed a 3-digit hex, so the `#rgb -> #rrggbb` doubling was
//           never exercised.
//   GAP 2 — 8 surviving Regex mutants on the hex-acceptance pattern: prior
//           tests only proved that long non-hex strings are flagged and that
//           6-digit hex passes, leaving the acceptance BOUNDARY (digit count,
//           anchoring, hex-char class) unpinned.
//
// The integration gate that parses the five real manifests
// (themes-validation.test.ts) is intentionally out of the mutation run, so
// odd-form / invalid hex breadth is this module's dedicated responsibility.
import { describe, expect, it } from 'vitest';
import type { ThemeManifest } from '@/src/themes/schema';
import { evaluateThemeContrast, wcagRatio } from '@/src/themes/contrast';
import { calmManifestFixture } from './fixtures';

// --- GAP 1: 3-digit shorthand is the doubled 6-digit form ------------------
//
// Metamorphic contract: for any 3-digit hex `#rgb`, the contrast ratio
// computed from it must equal the ratio computed from its doubled 6-digit
// expansion `#rrggbb`. This is a property of what the color MEANS, stated
// without reference to how the expansion is implemented.
describe('themes/contrast: wcagRatio — a 3-digit hex is the doubled 6-digit hex', () => {
  const REFERENCE = '#808080'; // fixed, arbitrary counterpart color
  const shorthandExpansions: Array<[string, string]> = [
    ['#fff', '#ffffff'],
    ['#000', '#000000'],
    ['#f00', '#ff0000'],
    ['#0a0', '#00aa00'],
    ['#12a', '#1122aa'],
    ['#abc', '#aabbcc'],
    ['#ABC', '#AABBCC'],
  ];

  it.each(shorthandExpansions)(
    '%s yields the same ratio as its expansion %s',
    (short, long) => {
      expect(wcagRatio(short, REFERENCE)).toBeCloseTo(wcagRatio(long, REFERENCE), 10);
    },
  );

  it.each(shorthandExpansions)(
    '%s yields the same ratio as %s with no leading "#"',
    (short, long) => {
      expect(wcagRatio(short.replace('#', ''), REFERENCE)).toBeCloseTo(
        wcagRatio(long.replace('#', ''), REFERENCE),
        10,
      );
    },
  );

  it.each(shorthandExpansions)(
    '%s equals %s when supplied as the second argument (order-independence holds under expansion)',
    (short, long) => {
      expect(wcagRatio(REFERENCE, short)).toBeCloseTo(wcagRatio(REFERENCE, long), 10);
    },
  );

  // The dark-channel branch of the sRGB linearization (channels <= ~10) must
  // stay LINEAR (channel/12.92), not be inflated — otherwise near-black
  // shades would report absurd luminance. Two near-identical near-black
  // shades therefore have near-1:1 contrast; pure black exercises the branch
  // but cannot discriminate the linear factor (0 maps to 0 either way).
  it('reports near-1:1 contrast between two distinct near-black shades', () => {
    expect(wcagRatio('#0a0a0a', '#000000')).toBeLessThan(1.5);
  });
});

// --- GAP 2: hex-acceptance boundary of a manifest color token --------------
//
// Output contract on evaluateThemeContrast: a color token is either a
// parseable hex (3- or 6-digit, upper/lowercase, with or without "#") — in
// which case NO "unparseable" failure is produced for it — or it is not, in
// which case a fail-loud failure naming the token and its raw value IS
// produced. Only `surfaceBg` is overridden, so parseability is the sole
// variable under test; a genuine low-contrast failure (which carries no
// `reason`) never counts as an "unparseable" failure.
describe('themes/contrast: evaluateThemeContrast — hex parseability of a color token', () => {
  const withSurfaceBg = (value: string): ThemeManifest => ({
    ...calmManifestFixture,
    colors: { ...calmManifestFixture.colors, surfaceBg: value },
  });

  const hasUnparseableFailure = (result: ReturnType<typeof evaluateThemeContrast>) =>
    result.failures.some((f) => f.reason?.includes('unparseable'));

  // ACCEPTED: valid 3- and 6-digit hex, every case/`#` combination.
  const ACCEPTED = [
    '#abc',
    'abc',
    '#ABC',
    'ABC',
    '#fff',
    '#000',
    '#aabbcc',
    'aabbcc',
    '#AABBCC',
    '#1a2B3c',
  ];

  it.each(ACCEPTED)(
    'treats %s as a parseable hex (no unparseable failure)',
    (value) => {
      expect(hasUnparseableFailure(evaluateThemeContrast(withSurfaceBg(value)))).toBe(false);
    },
  );

  // REJECTED: everything off the 3-or-6-digit hex boundary — wrong length,
  // non-hex characters, or empty.
  const REJECTED = [
    '',
    '#',
    '#ab',
    'ab',
    '#abcd',
    'abcd',
    '#abcde',
    'abcde',
    '#abcdefa',
    'abcdefa',
    '#abcdefab',
    '#12345g',
    'ggg',
    '#gggggg',
    'rebeccapurple',
    'rgb(0,0,0)',
  ];

  it.each(REJECTED)(
    'fails loud for %s — a failure naming the token and its raw value',
    (value) => {
      const result = evaluateThemeContrast(withSurfaceBg(value));
      const failure = result.failures.find(
        (f) => f.surfaceToken === 'surfaceBg' && f.reason?.includes('unparseable'),
      );
      expect(result.pass).toBe(false);
      expect(failure).toBeDefined();
      expect(failure?.reason).toContain('surfaceBg');
      expect(failure?.reason).toContain(value);
      expect(failure?.ratio).toBeNaN();
    },
  );
});
