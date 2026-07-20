import { describe, it, expect } from 'vitest';
import { BADGE_ACCENTS, BADGE_ACCENT } from '@/src/lib/badgeAccent';

describe('badgeAccent — decorative badge palette', () => {
  it('exposes the theme\'s five hued scales as the palette', () => {
    expect(BADGE_ACCENTS).toEqual(['brand', 'success', 'warning', 'danger', 'neutral']);
  });

  it('every badge-kind accent is drawn from the palette (no raw Chakra colors)', () => {
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
