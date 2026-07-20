import { describe, it, expect } from 'vitest';
import { BADGE_ACCENTS, BADGE_ACCENT } from '@/src/lib/badgeAccent';

describe('badgeAccent — decorative badge palette', () => {
  it('exposes five neutral-named palette colors (no semantic scale names)', () => {
    expect(BADGE_ACCENTS).toEqual(['badge1', 'badge2', 'badge3', 'badge4', 'badge5']);
    // Guard the intent: no badge color is named after a status/severity scale.
    for (const accent of BADGE_ACCENTS) {
      expect(accent).not.toMatch(/danger|warning|success|alert|error/);
    }
  });

  it('every badge-kind color is drawn from the palette (no raw or semantic colors)', () => {
    for (const [kind, accent] of Object.entries(BADGE_ACCENT)) {
      expect(BADGE_ACCENTS, `${kind} -> ${accent}`).toContain(accent);
    }
  });

  it('MemberList badges that can co-occur in one row are pairwise distinct', () => {
    // admin, memberPending, and removalPending can all render in the same
    // member row, so their decorative accents must be visually distinct.
    const coOccurring = [BADGE_ACCENT.admin, BADGE_ACCENT.memberPending, BADGE_ACCENT.removalPending];
    expect(new Set(coOccurring).size).toBe(coOccurring.length);
  });

  it('the incoming-call video/voice badges are distinct', () => {
    expect(BADGE_ACCENT.callVideo).not.toBe(BADGE_ACCENT.callVoice);
  });
});
