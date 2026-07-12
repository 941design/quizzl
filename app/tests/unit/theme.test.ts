import { describe, it, expect } from 'vitest';
import { APP_THEMES, getChakraTheme } from '@/src/lib/theme';

describe('theme definitions', () => {
  describe('contentSurface flag', () => {
    it('the light spring theme does not request a content panel', () => {
      // spring uses a light appBg — page text reads directly on the
      // background and a content panel would be redundant. (The appBg-
      // exemption path a dark contentSurface theme needs is covered by the
      // dark fixture in themes/contrast.test.ts.)
      expect(APP_THEMES.spring.contentSurface).toBeFalsy();
    });
  });

  describe('spring theme', () => {
    it('builds a Chakra theme whose appBg semantic token matches the manifest', () => {
      const { semanticTokens } = getChakraTheme('spring') as {
        semanticTokens: { colors: Record<string, string> };
      };
      expect(semanticTokens.colors.appBg).toBe(APP_THEMES.spring.colors.appBg);
    });
  });
});
