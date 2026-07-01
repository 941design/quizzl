import { describe, expect, it } from 'vitest';
import { evaluateThemeContrast, wcagRatio, WCAG_AA_THRESHOLD } from '@/src/themes/contrast';
import { calmManifestFixture, minecraftManifestFixture } from './fixtures';

describe('themes/contrast: wcagRatio', () => {
  it('computes the maximum ratio (21:1) for black on white', () => {
    expect(wcagRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('computes a ratio of 1:1 for identical colors', () => {
    expect(wcagRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });

  it('is order-independent (hexA, hexB) === (hexB, hexA)', () => {
    expect(wcagRatio('#123456', '#fedcba')).toBeCloseTo(wcagRatio('#fedcba', '#123456'), 10);
  });

  it('computes the documented calm textStrong/surfaceBg ratio range', () => {
    // architecture.md Implementation Constraint 1 doesn't pin an exact value
    // for this specific pair, but asserts the empirical minimum margin
    // across the five themes is 4.78 (calm textMuted/surfaceMutedBg) — every
    // other pair, including this one, is >= that floor.
    const ratio = wcagRatio(calmManifestFixture.colors.textStrong, calmManifestFixture.colors.surfaceBg);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_THRESHOLD);
  });
});

describe('themes/contrast: evaluateThemeContrast', () => {
  it('passes for the calm fixture (contentSurface falsy, appBg pairs included)', () => {
    const result = evaluateThemeContrast(calmManifestFixture);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('passes for the minecraft fixture (contentSurface true, appBg pairs exempt)', () => {
    const result = evaluateThemeContrast(minecraftManifestFixture);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('requires appBg pairs when contentSurface is falsy, and fails them for a dark-on-dark case', () => {
    const failing = {
      ...calmManifestFixture,
      contentSurface: false,
      colors: { ...calmManifestFixture.colors, appBg: calmManifestFixture.colors.textStrong },
    };
    const result = evaluateThemeContrast(failing);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.surfaceToken === 'appBg')).toBe(true);
  });

  it('exempts appBg pairs when contentSurface is true, even if appBg would otherwise fail', () => {
    const wouldFailAppBgButExempt = {
      ...minecraftManifestFixture,
      contentSurface: true,
      colors: { ...minecraftManifestFixture.colors, appBg: minecraftManifestFixture.colors.textStrong },
    };
    const result = evaluateThemeContrast(wouldFailAppBgButExempt);
    expect(result.failures.some((f) => f.surfaceToken === 'appBg')).toBe(false);
  });

  it('reports the failing (text, surface) pair and its ratio', () => {
    const failing = {
      ...calmManifestFixture,
      colors: { ...calmManifestFixture.colors, surfaceBg: calmManifestFixture.colors.textStrong },
    };
    const result = evaluateThemeContrast(failing);
    const failure = result.failures.find((f) => f.textToken === 'textStrong' && f.surfaceToken === 'surfaceBg');
    expect(failure).toBeDefined();
    expect(failure?.ratio).toBeLessThan(WCAG_AA_THRESHOLD);
  });

  it('checks status pairs (success/warning/danger text vs their own bg) regardless of contentSurface', () => {
    const failing = {
      ...calmManifestFixture,
      colors: { ...calmManifestFixture.colors, dangerBg: calmManifestFixture.colors.dangerText },
    };
    const result = evaluateThemeContrast(failing);
    expect(result.failures.some((f) => f.textToken === 'dangerText' && f.surfaceToken === 'dangerBg')).toBe(true);
  });

  it('fails loud (does not silently pass) when a color token is a named CSS color instead of hex', () => {
    const nonHex = {
      ...calmManifestFixture,
      colors: { ...calmManifestFixture.colors, surfaceBg: 'rebeccapurple' },
    };
    const result = evaluateThemeContrast(nonHex);
    expect(result.pass).toBe(false);
    const failure = result.failures.find((f) => f.surfaceToken === 'surfaceBg');
    expect(failure).toBeDefined();
    expect(failure?.reason).toContain('surfaceBg');
    expect(failure?.reason).toContain('rebeccapurple');
  });

  it('fails loud (does not silently pass) when a color token is an rgb()-form value instead of hex', () => {
    const nonHex = {
      ...calmManifestFixture,
      colors: { ...calmManifestFixture.colors, dangerBg: 'rgb(0,0,0)' },
    };
    const result = evaluateThemeContrast(nonHex);
    expect(result.pass).toBe(false);
    const failure = result.failures.find((f) => f.surfaceToken === 'dangerBg');
    expect(failure).toBeDefined();
    expect(failure?.reason).toContain('dangerBg');
  });
});
