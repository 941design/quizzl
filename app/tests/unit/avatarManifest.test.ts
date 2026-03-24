import { describe, it, expect } from 'vitest';
import manifest from '@/src/data/avatarManifest.json';

describe('avatarManifest', () => {
  it('every imageUrl uses a protocol-relative or https URL, not http://', () => {
    /**
     * Regression test: avatar images blocked by mixed-content policy on HTTPS
     *
     * Bug report: bug-reports/avatar-images-placeholder-mobile.md
     * Fixed: 2026-03-24
     * Root cause: imageUrl fields were hardcoded as http:// URLs; browsers silently
     *   block HTTP image loads from HTTPS pages (mixed-content policy), causing
     *   all avatar images to show placeholders on mobile and production.
     *
     * Protection: Ensures no future manifest regeneration re-introduces http:// imageUrls.
     */
    for (const item of manifest.items) {
      expect(
        item.imageUrl,
        `Avatar ${item.id} has an http:// imageUrl — must use protocol-relative (//) or https://`
      ).not.toMatch(/^http:\/\//);
    }
  });
});
