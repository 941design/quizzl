import { describe, it, expect } from 'vitest';
import { APP_THEMES, getChakraTheme } from '@/src/lib/theme';

describe('theme definitions', () => {
  describe('contentSurface flag', () => {
    it('minecraft floats content on a light surface panel', () => {
      // minecraft is the only theme with a dark appBg; its text tokens are
      // tuned for light surfaces, so page content must sit on a light panel.
      expect(APP_THEMES.minecraft.contentSurface).toBe(true);
    });

    it('light-background themes do not request a content panel', () => {
      // calm/playful/lego/flower all use a light appBg — page text reads
      // directly on the background and a panel would be redundant.
      expect(APP_THEMES.calm.contentSurface).toBeFalsy();
      expect(APP_THEMES.playful.contentSurface).toBeFalsy();
      expect(APP_THEMES.lego.contentSurface).toBeFalsy();
      expect(APP_THEMES.flower.contentSurface).toBeFalsy();
    });
  });

  describe('minecraft font sizing', () => {
    it('uses an enlarged pixel-font scale for legibility', () => {
      const { fontSizes } = getChakraTheme('minecraft') as {
        fontSizes: Record<string, string>;
      };
      // The VT323/Press Start 2P scale was bumped ~12% over the original
      // (md was '1rem'); guard the floor so it cannot silently shrink back.
      expect(parseFloat(fontSizes.md)).toBeGreaterThanOrEqual(1.1);
      expect(parseFloat(fontSizes.lg)).toBeGreaterThan(parseFloat(fontSizes.md));
      expect(parseFloat(fontSizes['4xl'])).toBeGreaterThan(parseFloat(fontSizes.xl));
    });
  });
});
