import { describe, it, expect } from 'vitest';
import { APP_THEMES, getChakraTheme } from '@/src/lib/theme';

describe('theme definitions', () => {
  describe('contentSurface flag', () => {
    it('the light aquarelle theme does not request a content panel', () => {
      // aquarelle uses a light appBg — page text reads directly on the
      // background and a content panel would be redundant. (The appBg-
      // exemption path a dark contentSurface theme needs is covered by the
      // dark fixture in themes/contrast.test.ts.)
      expect(APP_THEMES.aquarelle.contentSurface).toBeFalsy();
    });
  });

  describe('aquarelle theme', () => {
    it('builds a Chakra theme whose appBg semantic token matches the manifest', () => {
      const { semanticTokens } = getChakraTheme('aquarelle') as {
        semanticTokens: { colors: Record<string, string> };
      };
      expect(semanticTokens.colors.appBg).toBe(APP_THEMES.aquarelle.colors.appBg);
    });
  });
});
