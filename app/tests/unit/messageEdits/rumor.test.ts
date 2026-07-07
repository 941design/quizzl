/**
 * Unit tests for the messageEdits wire builders — Seam S2 producer
 * (buildDeleteRumor, buildEditReplacementRumor, buildEditMarkedCompanionKind5,
 * clampRev).
 *
 * These tests run the real nostr-tools crypto (no mocking of getEventHash or
 * getPublicKey) to verify the canonical NIP-01 id computation and tag shape,
 * per this project's rumor-builder testing convention (see
 * app/tests/unit/reactions/rumor.test.ts). No idb, no relay, no transport.
 *
 * crypto.subtle polyfill: nostr-tools/pure uses @noble/curves (pure JS Schnorr)
 * and @noble/hashes, which do NOT require crypto.subtle. The polyfill below
 * guards against any indirect path that might reach it.
 */
import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

// Dynamic imports AFTER crypto polyfill is in place.
const { getPublicKey, generateSecretKey, getEventHash } = await import('nostr-tools/pure');
const { buildDeleteRumor, buildEditReplacementRumor, buildEditMarkedCompanionKind5, clampRev, DELETE_EDIT_RUMOR_KIND } =
  await import('@/src/lib/messageEdits/rumor');

// ─── Fixtures ────────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const alicePrivBytes = generateSecretKey();
const alicePrivHex = bytesToHex(alicePrivBytes);
const alicePubHex = getPublicKey(alicePrivBytes);

const ORIGINAL_ID = 'a'.repeat(64);
const REPLACEMENT_1_ID = 'b'.repeat(64);
const REPLACEMENT_2_ID = 'c'.repeat(64);
const REPLACEMENT_3_ID = 'd'.repeat(64);

const ORIGINAL_CREATED_AT_SECONDS = 1_700_000_000; // arbitrary fixed Unix-seconds anchor

// ─── DELETE_EDIT_RUMOR_KIND ────────────────────────────────────────────────

describe('DELETE_EDIT_RUMOR_KIND', () => {
  it('is 5', () => {
    expect(DELETE_EDIT_RUMOR_KIND).toBe(5);
  });
});

// ─── buildDeleteRumor ───────────────────────────────────────────────────────

describe('buildDeleteRumor', () => {
  it('is kind 5', () => {
    const rumor = buildDeleteRumor(ORIGINAL_ID, [], 14, 1_700_000_100, alicePrivHex);
    expect(rumor.kind).toBe(DELETE_EDIT_RUMOR_KIND);
  });

  it('is unmarked: does not carry an ["e", ..., "", "edit"] tag (AC-DEL-7 substrate)', () => {
    const rumor = buildDeleteRumor(ORIGINAL_ID, [REPLACEMENT_1_ID, REPLACEMENT_2_ID], 14, 1_700_000_100, alicePrivHex);
    const editMarkerTags = rumor.tags.filter((t) => t[0] === 'e' && t[3] === 'edit');
    expect(editMarkerTags).toHaveLength(0);
  });

  it('e-tags the original id (no prior replacements)', () => {
    const rumor = buildDeleteRumor(ORIGINAL_ID, [], 14, 1_700_000_100, alicePrivHex);
    expect(rumor.tags).toContainEqual(['e', ORIGINAL_ID]);
  });

  it('e-tags the original id AND every prior replacement id (AC-DEL-8), varying with input', () => {
    const rumor = buildDeleteRumor(ORIGINAL_ID, [REPLACEMENT_1_ID, REPLACEMENT_2_ID, REPLACEMENT_3_ID], 9, 1_700_000_200, alicePrivHex);

    expect(rumor.tags).toContainEqual(['e', ORIGINAL_ID]);
    expect(rumor.tags).toContainEqual(['e', REPLACEMENT_1_ID]);
    expect(rumor.tags).toContainEqual(['e', REPLACEMENT_2_ID]);
    expect(rumor.tags).toContainEqual(['e', REPLACEMENT_3_ID]);

    const eTags = rumor.tags.filter((t) => t[0] === 'e');
    expect(eTags).toHaveLength(4);
  });

  it('pins the exact ordered tag array (complete-shape assertion, no stray/leaked tags)', () => {
    const rumor = buildDeleteRumor(ORIGINAL_ID, [REPLACEMENT_1_ID, REPLACEMENT_2_ID], 14, 1_700_000_100, alicePrivHex);
    expect(rumor.tags).toEqual([
      ['e', ORIGINAL_ID],
      ['e', REPLACEMENT_1_ID],
      ['e', REPLACEMENT_2_ID],
      ['k', '14'],
    ]);
  });

  it('dedups priorReplacementIds against originalId and against each other, keeping originalId first (sev1)', () => {
    const rumor = buildDeleteRumor(
      ORIGINAL_ID,
      [REPLACEMENT_1_ID, ORIGINAL_ID, REPLACEMENT_1_ID, REPLACEMENT_2_ID],
      14,
      1_700_000_100,
      alicePrivHex,
    );
    expect(rumor.tags).toEqual([
      ['e', ORIGINAL_ID],
      ['e', REPLACEMENT_1_ID],
      ['e', REPLACEMENT_2_ID],
      ['k', '14'],
    ]);

    // Same canonical id as if the caller had passed the already-deduplicated list.
    const dedupedEquivalent = buildDeleteRumor(ORIGINAL_ID, [REPLACEMENT_1_ID, REPLACEMENT_2_ID], 14, 1_700_000_100, alicePrivHex);
    expect(rumor.id).toBe(dedupedEquivalent.id);
  });

  it('carries ["k", "14"] for a DM target', () => {
    const rumor = buildDeleteRumor(ORIGINAL_ID, [], 14, 1_700_000_100, alicePrivHex);
    expect(rumor.tags).toContainEqual(['k', '14']);
  });

  it('carries ["k", "9"] for a group target', () => {
    const rumor = buildDeleteRumor(ORIGINAL_ID, [], 9, 1_700_000_100, alicePrivHex);
    expect(rumor.tags).toContainEqual(['k', '9']);
  });

  it("its own created_at IS the passed rev", () => {
    const rumor = buildDeleteRumor(ORIGINAL_ID, [], 14, 1_700_000_555, alicePrivHex);
    expect(rumor.created_at).toBe(1_700_000_555);
  });

  it('has no sig field and a valid pubkey', () => {
    const rumor = buildDeleteRumor(ORIGINAL_ID, [], 14, 1_700_000_100, alicePrivHex);
    expect(rumor).not.toHaveProperty('sig');
    expect(rumor.pubkey).toBe(alicePubHex);
  });

  it('id matches getEventHash of the canonical NIP-01 serialization', () => {
    const rumor = buildDeleteRumor(ORIGINAL_ID, [REPLACEMENT_1_ID], 14, 1_700_000_100, alicePrivHex);
    const expectedId = getEventHash({
      kind: rumor.kind,
      content: rumor.content,
      tags: rumor.tags,
      pubkey: rumor.pubkey,
      created_at: rumor.created_at,
    });
    expect(rumor.id).toBe(expectedId);
  });

  it('same inputs produce the same id (determinism)', () => {
    const rumor1 = buildDeleteRumor(ORIGINAL_ID, [REPLACEMENT_1_ID], 14, 1_700_000_100, alicePrivHex);
    const rumor2 = buildDeleteRumor(ORIGINAL_ID, [REPLACEMENT_1_ID], 14, 1_700_000_100, alicePrivHex);
    expect(rumor1.id).toBe(rumor2.id);
  });

  it('varying priorReplacementIds changes the output tags and id', () => {
    const rumorA = buildDeleteRumor(ORIGINAL_ID, [REPLACEMENT_1_ID], 14, 1_700_000_100, alicePrivHex);
    const rumorB = buildDeleteRumor(ORIGINAL_ID, [REPLACEMENT_1_ID, REPLACEMENT_2_ID], 14, 1_700_000_100, alicePrivHex);
    expect(rumorA.tags).not.toEqual(rumorB.tags);
    expect(rumorA.id).not.toBe(rumorB.id);
  });

  it('varying rev changes created_at and id', () => {
    const rumorA = buildDeleteRumor(ORIGINAL_ID, [], 14, 1_700_000_100, alicePrivHex);
    const rumorB = buildDeleteRumor(ORIGINAL_ID, [], 14, 1_700_000_200, alicePrivHex);
    expect(rumorA.created_at).not.toBe(rumorB.created_at);
    expect(rumorA.id).not.toBe(rumorB.id);
  });

  it('varying originalId changes the e-tag and id', () => {
    const rumorA = buildDeleteRumor(ORIGINAL_ID, [], 14, 1_700_000_100, alicePrivHex);
    const rumorB = buildDeleteRumor(REPLACEMENT_1_ID, [], 14, 1_700_000_100, alicePrivHex);
    expect(rumorA.tags).not.toEqual(rumorB.tags);
    expect(rumorA.id).not.toBe(rumorB.id);
  });

  describe('input guards', () => {
    it('throws on empty originalId', () => {
      expect(() => buildDeleteRumor('', [], 14, 1_700_000_100, alicePrivHex)).toThrow();
    });

    it('throws on a non-empty-string entry in priorReplacementIds', () => {
      expect(() => buildDeleteRumor(ORIGINAL_ID, ['', REPLACEMENT_1_ID], 14, 1_700_000_100, alicePrivHex)).toThrow();
    });

    it('throws on an invalid targetKind', () => {
      // @ts-expect-error deliberate invalid input
      expect(() => buildDeleteRumor(ORIGINAL_ID, [], 5, 1_700_000_100, alicePrivHex)).toThrow();
    });

    it('throws when rev < 1', () => {
      expect(() => buildDeleteRumor(ORIGINAL_ID, [], 14, 0, alicePrivHex)).toThrow();
    });

    it('throws when rev is non-finite', () => {
      expect(() => buildDeleteRumor(ORIGINAL_ID, [], 14, NaN, alicePrivHex)).toThrow();
      expect(() => buildDeleteRumor(ORIGINAL_ID, [], 14, Infinity, alicePrivHex)).toThrow();
    });

    it('throws when rev is fractional (sev3: a bypassed clampRev must not produce a fractional wire created_at/rev tag)', () => {
      expect(() => buildDeleteRumor(ORIGINAL_ID, [], 14, 1_700_000_100.5, alicePrivHex)).toThrow();
    });

    it('throws on empty selfPrivKeyHex', () => {
      expect(() => buildDeleteRumor(ORIGINAL_ID, [], 14, 1_700_000_100, '')).toThrow();
    });
  });
});

// ─── buildEditReplacementRumor ─────────────────────────────────────────────

describe('buildEditReplacementRumor', () => {
  it('is kind 14 for a DM target', () => {
    const rumor = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_300, alicePrivHex);
    expect(rumor.kind).toBe(14);
  });

  it('is kind 9 for a group target', () => {
    const rumor = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 9, 1_700_000_300, alicePrivHex);
    expect(rumor.kind).toBe(9);
  });

  it('content is the new text', () => {
    const rumor = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'hello edited world', 14, 1_700_000_300, alicePrivHex);
    expect(rumor.content).toBe('hello edited world');
  });

  it('wire created_at (seconds) equals the ORIGINAL message created_at, not the rev (AC-EDIT-4)', () => {
    const rumor = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_999, alicePrivHex);
    expect(rumor.created_at).toBe(ORIGINAL_CREATED_AT_SECONDS);
    expect(rumor.created_at).not.toBe(1_700_000_999);
  });

  it('carries the ["e", originalId, "", "edit"] anchor tag', () => {
    const rumor = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_300, alicePrivHex);
    expect(rumor.tags).toContainEqual(['e', ORIGINAL_ID, '', 'edit']);
  });

  it('carries a separate ["rev", <seconds>] tag matching the passed rev', () => {
    const rumor = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_321, alicePrivHex);
    expect(rumor.tags).toContainEqual(['rev', '1700000321']);
  });

  it('does not carry a bare ["e", originalId] tag without the marker (only the marked form)', () => {
    const rumor = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_300, alicePrivHex);
    const bareETags = rumor.tags.filter((t) => t[0] === 'e' && t.length === 2);
    expect(bareETags).toHaveLength(0);
  });

  it('pins the exact ordered tag array (complete-shape assertion, no stray/leaked tags)', () => {
    const rumor = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_321, alicePrivHex);
    expect(rumor.tags).toEqual([
      ['e', ORIGINAL_ID, '', 'edit'],
      ['rev', '1700000321'],
    ]);
  });

  it('id matches getEventHash of the canonical NIP-01 serialization', () => {
    const rumor = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_300, alicePrivHex);
    const expectedId = getEventHash({
      kind: rumor.kind,
      content: rumor.content,
      tags: rumor.tags,
      pubkey: rumor.pubkey,
      created_at: rumor.created_at,
    });
    expect(rumor.id).toBe(expectedId);
  });

  it('same inputs produce the same id (determinism)', () => {
    const rumor1 = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_300, alicePrivHex);
    const rumor2 = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_300, alicePrivHex);
    expect(rumor1.id).toBe(rumor2.id);
  });

  it('varying content changes the id', () => {
    const rumorA = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'text A', 14, 1_700_000_300, alicePrivHex);
    const rumorB = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'text B', 14, 1_700_000_300, alicePrivHex);
    expect(rumorA.id).not.toBe(rumorB.id);
  });

  it('varying rev changes the rev tag and id but not created_at (AC-EDIT-4 separation)', () => {
    const rumorA = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_300, alicePrivHex);
    const rumorB = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'new text', 14, 1_700_000_400, alicePrivHex);
    expect(rumorA.created_at).toBe(rumorB.created_at);
    expect(rumorA.tags).not.toEqual(rumorB.tags);
    expect(rumorA.id).not.toBe(rumorB.id);
  });

  describe('AC-EDIT-6: repeated edits always anchor to the FIRST message id/created_at', () => {
    it('a 3-edit chain: every replacement e-tags and pins created_at to the original, never the prior edit', () => {
      // Edit #1: built from the original.
      const edit1 = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'edit one', 14, 1_700_000_100, alicePrivHex);
      expect(edit1.tags).toContainEqual(['e', ORIGINAL_ID, '', 'edit']);
      expect(edit1.created_at).toBe(ORIGINAL_CREATED_AT_SECONDS);

      // Edit #2: caller MUST still pass the original id/createdAt, not edit1's.
      const edit2 = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'edit two', 14, 1_700_000_200, alicePrivHex);
      expect(edit2.tags).toContainEqual(['e', ORIGINAL_ID, '', 'edit']);
      expect(edit2.created_at).toBe(ORIGINAL_CREATED_AT_SECONDS);
      // Never references edit1's id.
      expect(edit2.tags.some((t) => t[0] === 'e' && t[1] === edit1.id)).toBe(false);

      // Edit #3: same anchor again.
      const edit3 = buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'edit three', 14, 1_700_000_300, alicePrivHex);
      expect(edit3.tags).toContainEqual(['e', ORIGINAL_ID, '', 'edit']);
      expect(edit3.created_at).toBe(ORIGINAL_CREATED_AT_SECONDS);
      expect(edit3.tags.some((t) => t[0] === 'e' && t[1] === edit2.id)).toBe(false);

      // All three share the same anchor created_at.
      expect(edit1.created_at).toBe(edit2.created_at);
      expect(edit2.created_at).toBe(edit3.created_at);
    });
  });

  describe('input guards', () => {
    it('throws on empty originalId', () => {
      expect(() => buildEditReplacementRumor('', ORIGINAL_CREATED_AT_SECONDS, 'text', 14, 1_700_000_300, alicePrivHex)).toThrow();
    });

    it('throws on empty content', () => {
      expect(() => buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, '', 14, 1_700_000_300, alicePrivHex)).toThrow();
    });

    it('throws on a negative originalCreatedAt', () => {
      expect(() => buildEditReplacementRumor(ORIGINAL_ID, -1, 'text', 14, 1_700_000_300, alicePrivHex)).toThrow();
    });

    it('throws on a non-finite originalCreatedAt', () => {
      expect(() => buildEditReplacementRumor(ORIGINAL_ID, NaN, 'text', 14, 1_700_000_300, alicePrivHex)).toThrow();
    });

    it('throws on a fractional originalCreatedAt (e.g. an unfloored createdAt/1000)', () => {
      expect(() => buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS + 0.5, 'text', 14, 1_700_000_300, alicePrivHex)).toThrow();
    });

    it('throws when originalCreatedAt looks like a milliseconds epoch instead of Unix seconds (sev4 ms-vs-seconds hazard)', () => {
      // A raw ChatMessage.createdAt (milliseconds) — e.g. Date.now()-scale, ~1.7e12 — must be rejected,
      // not silently pinned as a wire created_at ~1000x in the future.
      const msEpoch = ORIGINAL_CREATED_AT_SECONDS * 1000;
      expect(() => buildEditReplacementRumor(ORIGINAL_ID, msEpoch, 'text', 14, 1_700_000_300, alicePrivHex)).toThrow(/milliseconds/i);
    });

    it('accepts an originalCreatedAt just below the milliseconds plausibility ceiling', () => {
      expect(() =>
        buildEditReplacementRumor(ORIGINAL_ID, 99_999_999_999, 'text', 14, 1_700_000_300, alicePrivHex),
      ).not.toThrow();
    });

    it('throws on an invalid targetKind', () => {
      // @ts-expect-error deliberate invalid input
      expect(() => buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'text', 5, 1_700_000_300, alicePrivHex)).toThrow();
    });

    it('throws when rev < 1', () => {
      expect(() => buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'text', 14, 0, alicePrivHex)).toThrow();
    });

    it('throws when rev is fractional', () => {
      expect(() => buildEditReplacementRumor(ORIGINAL_ID, ORIGINAL_CREATED_AT_SECONDS, 'text', 14, 1_700_000_300.5, alicePrivHex)).toThrow();
    });
  });
});

// ─── buildEditMarkedCompanionKind5 ─────────────────────────────────────────

describe('buildEditMarkedCompanionKind5', () => {
  it('is kind 5', () => {
    const rumor = buildEditMarkedCompanionKind5(ORIGINAL_ID, [], 14, 1_700_000_300, alicePrivHex);
    expect(rumor.kind).toBe(DELETE_EDIT_RUMOR_KIND);
  });

  it('carries the edit marker tag (distinguishing it from a delete, AC-DEL-7)', () => {
    const rumor = buildEditMarkedCompanionKind5(ORIGINAL_ID, [], 14, 1_700_000_300, alicePrivHex);
    expect(rumor.tags).toContainEqual(['e', ORIGINAL_ID, '', 'edit']);
  });

  it('e-tags the original id AND every prior replacement id (same chain as buildDeleteRumor, AC-DEL-8)', () => {
    const rumor = buildEditMarkedCompanionKind5(ORIGINAL_ID, [REPLACEMENT_1_ID, REPLACEMENT_2_ID], 9, 1_700_000_300, alicePrivHex);

    expect(rumor.tags).toContainEqual(['e', ORIGINAL_ID]);
    expect(rumor.tags).toContainEqual(['e', REPLACEMENT_1_ID]);
    expect(rumor.tags).toContainEqual(['e', REPLACEMENT_2_ID]);
    expect(rumor.tags).toContainEqual(['e', ORIGINAL_ID, '', 'edit']);

    const eTags = rumor.tags.filter((t) => t[0] === 'e');
    // original (bare) + 2 priors (bare) + original (marked) = 4
    expect(eTags).toHaveLength(4);
  });

  it('pins the exact ordered tag array (complete-shape assertion, no stray/leaked tags)', () => {
    const rumor = buildEditMarkedCompanionKind5(ORIGINAL_ID, [REPLACEMENT_1_ID, REPLACEMENT_2_ID], 14, 1_700_000_300, alicePrivHex);
    expect(rumor.tags).toEqual([
      ['e', ORIGINAL_ID],
      ['e', REPLACEMENT_1_ID],
      ['e', REPLACEMENT_2_ID],
      ['k', '14'],
      ['e', ORIGINAL_ID, '', 'edit'],
    ]);
  });

  it('dedups priorReplacementIds against originalId and against each other in the bare chain, but keeps the intentional bare+marked originalId duplication (sev1)', () => {
    const rumor = buildEditMarkedCompanionKind5(
      ORIGINAL_ID,
      [REPLACEMENT_1_ID, ORIGINAL_ID, REPLACEMENT_1_ID],
      14,
      1_700_000_300,
      alicePrivHex,
    );
    expect(rumor.tags).toEqual([
      ['e', ORIGINAL_ID],
      ['e', REPLACEMENT_1_ID],
      ['k', '14'],
      ['e', ORIGINAL_ID, '', 'edit'],
    ]);
  });

  it('carries ["k", String(targetKind)]', () => {
    const dmRumor = buildEditMarkedCompanionKind5(ORIGINAL_ID, [], 14, 1_700_000_300, alicePrivHex);
    expect(dmRumor.tags).toContainEqual(['k', '14']);

    const groupRumor = buildEditMarkedCompanionKind5(ORIGINAL_ID, [], 9, 1_700_000_300, alicePrivHex);
    expect(groupRumor.tags).toContainEqual(['k', '9']);
  });

  it('has a different tag shape (and id) than the unmarked delete for identical original/replacements/rev', () => {
    const deleteRumor = buildDeleteRumor(ORIGINAL_ID, [REPLACEMENT_1_ID], 14, 1_700_000_300, alicePrivHex);
    const companionRumor = buildEditMarkedCompanionKind5(ORIGINAL_ID, [REPLACEMENT_1_ID], 14, 1_700_000_300, alicePrivHex);

    expect(companionRumor.tags).not.toEqual(deleteRumor.tags);
    expect(companionRumor.id).not.toBe(deleteRumor.id);
  });

  it('id matches getEventHash of the canonical NIP-01 serialization', () => {
    const rumor = buildEditMarkedCompanionKind5(ORIGINAL_ID, [REPLACEMENT_1_ID], 14, 1_700_000_300, alicePrivHex);
    const expectedId = getEventHash({
      kind: rumor.kind,
      content: rumor.content,
      tags: rumor.tags,
      pubkey: rumor.pubkey,
      created_at: rumor.created_at,
    });
    expect(rumor.id).toBe(expectedId);
  });

  it('same inputs produce the same id (determinism)', () => {
    const rumor1 = buildEditMarkedCompanionKind5(ORIGINAL_ID, [REPLACEMENT_1_ID], 14, 1_700_000_300, alicePrivHex);
    const rumor2 = buildEditMarkedCompanionKind5(ORIGINAL_ID, [REPLACEMENT_1_ID], 14, 1_700_000_300, alicePrivHex);
    expect(rumor1.id).toBe(rumor2.id);
  });

  describe('input guards', () => {
    it('throws on empty originalId', () => {
      expect(() => buildEditMarkedCompanionKind5('', [], 14, 1_700_000_300, alicePrivHex)).toThrow();
    });

    it('throws when rev < 1', () => {
      expect(() => buildEditMarkedCompanionKind5(ORIGINAL_ID, [], 14, 0, alicePrivHex)).toThrow();
    });

    it('throws when rev is fractional', () => {
      expect(() => buildEditMarkedCompanionKind5(ORIGINAL_ID, [], 14, 1_700_000_300.5, alicePrivHex)).toThrow();
    });

    it('throws on an invalid targetKind', () => {
      // @ts-expect-error deliberate invalid input
      expect(() => buildEditMarkedCompanionKind5(ORIGINAL_ID, [], 5, 1_700_000_300, alicePrivHex)).toThrow();
    });
  });
});

// ─── clampRev ───────────────────────────────────────────────────────────────

describe('clampRev', () => {
  describe('table-driven: max(wallClockSeconds, lastKnownRevForSlot + 1)', () => {
    const cases: Array<{ label: string; wall: number; last: number; expected: number }> = [
      { label: 'wall greater than last+1 (ordinary forward tick)', wall: 1_700_000_100, last: 1_700_000_050, expected: 1_700_000_100 },
      { label: 'wall equal to last (stale/equal clock) — bumps to last+1', wall: 1_700_000_100, last: 1_700_000_100, expected: 1_700_000_101 },
      { label: 'wall less than last (stale clock, e.g. clock skew) — bumps to last+1', wall: 1_700_000_050, last: 1_700_000_100, expected: 1_700_000_101 },
      { label: 'wall far in the future relative to last (future-skewed clock) — wall wins unchanged', wall: 1_900_000_000, last: 1_700_000_100, expected: 1_900_000_000 },
      { label: 'no prior rev known (last=0) — wall wins when wall>=1', wall: 1_700_000_100, last: 0, expected: 1_700_000_100 },
      { label: 'no prior rev known and wall is 0 — floors to 1', wall: 0, last: 0, expected: 1 },
      { label: 'fractional wallClockSeconds is floored before the max (wall-wins branch)', wall: 1_700_000_100.9, last: 0, expected: 1_700_000_100 },
      { label: 'fractional lastKnownRevForSlot is floored before +1 (last-wins branch)', wall: 100, last: 1_700_000_100.5, expected: 1_700_000_101 },
    ];

    for (const { label, wall, last, expected } of cases) {
      it(label, () => {
        const result = clampRev(wall, last);
        expect(result).toBe(expected);
        expect(Number.isInteger(result)).toBe(true);
      });
    }
  });

  it('is monotonic per slot across a sequence of calls (each result feeds the next lastKnownRevForSlot)', () => {
    let lastKnownRev = 0;
    const wallClockSequence = [1_700_000_100, 1_700_000_100, 1_700_000_050, 1_700_000_200, 1_700_000_050];
    const revs: number[] = [];

    for (const wall of wallClockSequence) {
      const rev = clampRev(wall, lastKnownRev);
      revs.push(rev);
      lastKnownRev = rev;
    }

    for (let i = 1; i < revs.length; i++) {
      expect(revs[i]).toBeGreaterThan(revs[i - 1]);
    }
  });

  describe('never returns < 1 or a non-finite value, even under malformed input', () => {
    const malformedInputs: Array<[string, number, number]> = [
      ['both zero', 0, 0],
      ['negative wall', -100, 0],
      ['negative last', 100, -50],
      ['both negative', -100, -50],
      ['NaN wall', NaN, 100],
      ['NaN last', 100, NaN],
      ['both NaN', NaN, NaN],
      ['Infinity wall', Infinity, 100],
      ['-Infinity wall', -Infinity, 100],
      ['Infinity last', 100, Infinity],
      ['-Infinity last', 100, -Infinity],
    ];

    for (const [label, wall, last] of malformedInputs) {
      it(label, () => {
        const result = clampRev(wall, last);
        expect(Number.isFinite(result)).toBe(true);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe('exact pinned values for malformed input, proving strictly-greater semantics (not just >=1)', () => {
    it('NaN wall with a well-formed last: sanitizes wall to 1 but last+1 still wins (101)', () => {
      expect(clampRev(NaN, 100)).toBe(101);
    });

    it('NaN last with a well-formed wall: sanitizes last to 0, wall wins unchanged (100)', () => {
      expect(clampRev(100, NaN)).toBe(100);
    });

    it('negative wall with a well-formed last: sanitizes wall to 1 but last+1 still wins (101)', () => {
      expect(clampRev(-100, 100)).toBe(101);
    });

    it('negative last with a well-formed wall: sanitizes last to 0, wall wins unchanged (100)', () => {
      expect(clampRev(100, -50)).toBe(100);
    });
  });

  it('a real-looking wall clock and a stale lastKnownRev of 0 both yield a result >= 1', () => {
    expect(clampRev(1_700_000_000, 0)).toBeGreaterThanOrEqual(1);
  });
});
