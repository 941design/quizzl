import { describe, expect, it } from 'vitest';
import { buildFontLinkHref, buildThemeFonts, type FontLoad } from '@/src/themes/fontUnion';
import { lightManifestFixture, darkContentSurfaceManifestFixture } from './fixtures';

describe('themes/fontUnion: buildThemeFonts', () => {
  it('unions fontLoad entries across manifests', () => {
    const fonts = buildThemeFonts([lightManifestFixture, darkContentSurfaceManifestFixture]);
    const families = fonts.map((f) => f.family).sort();
    expect(families).toEqual(['Inter', 'Press Start 2P', 'VT323'].sort());
  });

  it('dedupes a family appearing in more than one manifest, merging weights', () => {
    const manifestA = {
      ...lightManifestFixture,
      id: 'a',
      typography: { ...lightManifestFixture.typography, fontLoad: [{ family: 'Shared', weights: [400] }] },
    };
    const manifestB = {
      ...lightManifestFixture,
      id: 'b',
      typography: { ...lightManifestFixture.typography, fontLoad: [{ family: 'Shared', weights: [700] }] },
    };
    const fonts = buildThemeFonts([manifestA, manifestB]);
    expect(fonts).toHaveLength(1);
    expect(fonts[0].family).toBe('Shared');
    expect(fonts[0].weights).toEqual([400, 700]);
  });

  it('ORs the ital flag across duplicate-family entries', () => {
    const manifestA = {
      ...lightManifestFixture,
      id: 'a',
      typography: { ...lightManifestFixture.typography, fontLoad: [{ family: 'Shared', ital: false }] },
    };
    const manifestB = {
      ...lightManifestFixture,
      id: 'b',
      typography: { ...lightManifestFixture.typography, fontLoad: [{ family: 'Shared', ital: true }] },
    };
    const fonts = buildThemeFonts([manifestA, manifestB]);
    expect(fonts[0].ital).toBe(true);
  });
});

describe('themes/fontUnion: buildFontLinkHref', () => {
  it('sorts families alphabetically before encoding', () => {
    const fonts: FontLoad[] = [{ family: 'Zeta' }, { family: 'Alpha' }];
    const href = buildFontLinkHref(fonts);
    expect(href.indexOf('family=Alpha')).toBeLessThan(href.indexOf('family=Zeta'));
  });

  it('encodes ital-only as Family:ital@0;1', () => {
    const href = buildFontLinkHref([{ family: 'DM Serif Display', ital: true }]);
    expect(href).toContain('family=DM+Serif+Display:ital@0;1');
  });

  it('encodes weights-only as Family:wght@w1;w2 (ascending)', () => {
    const href = buildFontLinkHref([{ family: 'Fredoka', weights: [700, 400, 600, 500] }]);
    expect(href).toContain('family=Fredoka:wght@400;500;600;700');
  });

  it('encodes neither axis as a bare family name', () => {
    const href = buildFontLinkHref([{ family: 'VT323' }]);
    expect(href).toContain('family=VT323');
    expect(href).not.toContain('VT323:');
  });

  it('encodes both ital and weights per the generalized 0/1 pairing', () => {
    const href = buildFontLinkHref([{ family: 'Both Axes', ital: true, weights: [400] }]);
    expect(href).toContain('family=Both+Axes:ital,wght@0,400;1,400');
  });

  it('always appends &display=swap exactly once, at the end', () => {
    const href = buildFontLinkHref([{ family: 'A' }, { family: 'B', weights: [400] }]);
    expect(href.endsWith('&display=swap')).toBe(true);
    expect(href.match(/display=swap/g)).toHaveLength(1);
  });

  it('begins with the Google Fonts CSS2 base URL', () => {
    const href = buildFontLinkHref([{ family: 'Solo' }]);
    expect(href.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
  });

  it('sorts deterministically (code-unit order, not locale-dependent) for a shared-prefix family pair', () => {
    const href = buildFontLinkHref([{ family: 'Fredoka Sans' }, { family: 'Fredoka' }]);
    expect(href).toBe('https://fonts.googleapis.com/css2?family=Fredoka&family=Fredoka+Sans&display=swap');
  });

  it('preserves the D<F<N<P<V order for the five current theme families', () => {
    const fonts: FontLoad[] = [
      { family: 'VT323' },
      { family: 'Press Start 2P' },
      { family: 'Nunito' },
      { family: 'Fredoka' },
      { family: 'DM Serif Display' },
    ];
    const href = buildFontLinkHref(fonts);
    const positions = ['DM+Serif+Display', 'Fredoka', 'Nunito', 'Press+Start+2P', 'VT323'].map((f) =>
      href.indexOf(`family=${f}`),
    );
    expect(positions.every((p) => p !== -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
