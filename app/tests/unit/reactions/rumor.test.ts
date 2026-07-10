/**
 * Unit tests for buildReactionRumor — Seam S3 producer.
 *
 * These tests run the real nostr-tools crypto (no mocking of getEventHash or
 * getPublicKey) to verify the canonical NIP-01 id computation, tag shape, and
 * error behaviour. No idb, no relay, no transport.
 *
 * crypto.subtle polyfill: nostr-tools/pure uses @noble/curves (pure JS Schnorr)
 * and @noble/hashes, which do NOT require crypto.subtle. The polyfill below
 * guards against any indirect path that might reach it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
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
const { buildReactionRumor } = await import('@/src/lib/reactions/rumor');
const { CURATED_EMOJI } = await import('@/src/lib/reactions/types');

// ─── Fixtures ────────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Fixed keypairs for deterministic assertions.
const alicePrivBytes = generateSecretKey();
const alicePrivHex = bytesToHex(alicePrivBytes);
const alicePubHex = getPublicKey(alicePrivBytes);

const bobPrivBytes = generateSecretKey();
const bobPubHex = getPublicKey(bobPrivBytes);

const TARGET_MSG_ID = 'a'.repeat(64); // 64-char hex string, realistic message id

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('buildReactionRumor', () => {

  // 1. Add path: full field assertion
  describe('add path (emoji reaction)', () => {
    it('returns kind 7 with correct content, tags, and pubkey', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });

      expect(rumor.kind).toBe(7);
      expect(rumor.content).toBe('👍');
      expect(rumor.pubkey).toBe(alicePubHex);
    });

    it('tags include [e, targetMessageId]', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });

      expect(rumor.tags).toContainEqual(['e', TARGET_MSG_ID]);
    });

    it('tags include [k, "14"] for kind-14 target', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });

      expect(rumor.tags).toContainEqual(['k', '14']);
    });

    it('tags include [p, targetAuthorPubkey] for DM path', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });

      expect(rumor.tags).toContainEqual(['p', bobPubHex]);
    });

    it('has no sig field', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });

      expect(rumor).not.toHaveProperty('sig');
    });

    it('id is a 64-char lowercase hex string', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });

      expect(rumor.id).toMatch(/^[0-9a-f]{64}$/);
    });

    it('id matches getEventHash of the canonical NIP-01 serialization', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });

      // Independently compute the id from the rumor fields.
      const expectedId = getEventHash({
        kind: rumor.kind,
        content: rumor.content,
        tags: rumor.tags,
        pubkey: rumor.pubkey,
        created_at: rumor.created_at,
      });

      expect(rumor.id).toBe(expectedId);
    });

    it('created_at is within ±5 seconds of the current unix timestamp', () => {
      const before = Math.floor(Date.now() / 1000) - 5;
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });
      const after = Math.floor(Date.now() / 1000) + 5;

      expect(rumor.created_at).toBeGreaterThanOrEqual(before);
      expect(rumor.created_at).toBeLessThanOrEqual(after);
    });

    it('does not add an [emoji, ...] tag on the add path', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });

      const emojiTags = rumor.tags.filter((t) => t[0] === 'emoji');
      expect(emojiTags).toHaveLength(0);
    });
  });

  // 2. Remove path: content = '-' + emoji disambiguation tag
  describe('remove path (isRemoval: true)', () => {
    it('content is "-" not the emoji glyph', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
        isRemoval: true,
      });

      expect(rumor.content).toBe('-');
    });

    it('adds ["emoji", "👍"] tag for multi-emoji removal disambiguation', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
        isRemoval: true,
      });

      expect(rumor.tags).toContainEqual(['emoji', '👍']);
    });

    it('still includes e, k, and p tags on removal', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
        isRemoval: true,
      });

      expect(rumor.tags).toContainEqual(['e', TARGET_MSG_ID]);
      expect(rumor.tags).toContainEqual(['k', '14']);
      expect(rumor.tags).toContainEqual(['p', bobPubHex]);
    });

    it('id still canonically matches getEventHash on removal', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
        isRemoval: true,
      });

      const expectedId = getEventHash({
        kind: rumor.kind,
        content: rumor.content,
        tags: rumor.tags,
        pubkey: rumor.pubkey,
        created_at: rumor.created_at,
      });

      expect(rumor.id).toBe(expectedId);
    });
  });

  // 3. Group path: no p tag
  describe('group path (targetAuthorPubkey: undefined)', () => {
    it('omits p tag when targetAuthorPubkey is undefined', () => {
      const rumor = buildReactionRumor({
        emoji: '🎉',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 9,
        targetAuthorPubkey: undefined,
        selfPrivKeyHex: alicePrivHex,
      });

      const pTags = rumor.tags.filter((t) => t[0] === 'p');
      expect(pTags).toHaveLength(0);
    });

    it('still includes e and k tags without p', () => {
      const rumor = buildReactionRumor({
        emoji: '🎉',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 9,
        selfPrivKeyHex: alicePrivHex,
      });

      expect(rumor.tags).toContainEqual(['e', TARGET_MSG_ID]);
      expect(rumor.tags).toContainEqual(['k', '9']);
    });
  });

  // 4. Kind-9 target (group chat rumor)
  describe('kind-9 target (group chat)', () => {
    it('produces ["k", "9"] tag for kind-9 target message', () => {
      const rumor = buildReactionRumor({
        emoji: '❤️',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 9,
        selfPrivKeyHex: alicePrivHex,
      });

      expect(rumor.tags).toContainEqual(['k', '9']);
    });
  });

  // 5. Empty emoji rejection
  describe('empty emoji validation', () => {
    it('throws synchronously when emoji is an empty string (add path)', () => {
      expect(() =>
        buildReactionRumor({
          emoji: '',
          targetMessageId: TARGET_MSG_ID,
          targetMessageKind: 14,
          selfPrivKeyHex: alicePrivHex,
        }),
      ).toThrow();
    });

    it('throws synchronously when emoji is an empty string (removal path)', () => {
      expect(() =>
        buildReactionRumor({
          emoji: '',
          targetMessageId: TARGET_MSG_ID,
          targetMessageKind: 14,
          selfPrivKeyHex: alicePrivHex,
          isRemoval: true,
        }),
      ).toThrow();
    });
  });

  // 6. Dash emoji rejection on the add path
  describe('dash emoji validation (add path)', () => {
    it('throws synchronously when emoji is "-" on the add path (isRemoval: false)', () => {
      expect(() =>
        buildReactionRumor({
          emoji: '-',
          targetMessageId: TARGET_MSG_ID,
          targetMessageKind: 14,
          selfPrivKeyHex: alicePrivHex,
          isRemoval: false,
        }),
      ).toThrow();
    });

    it('does NOT throw when emoji is "-" on the removal path (isRemoval: true)', () => {
      // isRemoval:true with emoji '-' is not a caller mistake, but the real-world use is
      // always a glyph (e.g. '👍') — this test confirms the add-path guard is the only gate.
      // The removal path only guards against empty emoji, not against '-'.
      expect(() =>
        buildReactionRumor({
          emoji: '-',
          targetMessageId: TARGET_MSG_ID,
          targetMessageKind: 14,
          selfPrivKeyHex: alicePrivHex,
          isRemoval: true,
        }),
      ).not.toThrow();
    });

    it('removal path with a real emoji glyph still sets content to "-" and adds [emoji] tag', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
        isRemoval: true,
      });

      expect(rumor.content).toBe('-');
      expect(rumor.tags).toContainEqual(['emoji', '👍']);
    });
  });

  // 7. Empty targetAuthorPubkey rejection
  describe('targetAuthorPubkey empty-string validation', () => {
    it('throws synchronously when targetAuthorPubkey is an empty string', () => {
      expect(() =>
        buildReactionRumor({
          emoji: '👍',
          targetMessageId: TARGET_MSG_ID,
          targetMessageKind: 14,
          targetAuthorPubkey: '',
          selfPrivKeyHex: alicePrivHex,
        }),
      ).toThrow();
    });

    it('omits p tag when targetAuthorPubkey is undefined (group path unaffected)', () => {
      const rumor = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: undefined,
        selfPrivKeyHex: alicePrivHex,
      });

      const pTags = rumor.tags.filter((t) => t[0] === 'p');
      expect(pTags).toHaveLength(0);
    });
  });

  // 8. Curated set sanity: all curated glyphs produce a valid rumor
  describe('CURATED_EMOJI sanity', () => {
    it('builds a valid rumor for every glyph in CURATED_EMOJI without throwing', () => {
      for (const glyph of CURATED_EMOJI) {
        expect(() =>
          buildReactionRumor({
            emoji: glyph,
            targetMessageId: TARGET_MSG_ID,
            targetMessageKind: 14,
            targetAuthorPubkey: bobPubHex,
            selfPrivKeyHex: alicePrivHex,
          }),
        ).not.toThrow();

        const rumor = buildReactionRumor({
          emoji: glyph,
          targetMessageId: TARGET_MSG_ID,
          targetMessageKind: 14,
          targetAuthorPubkey: bobPubHex,
          selfPrivKeyHex: alicePrivHex,
        });

        expect(rumor.kind).toBe(7);
        expect(rumor.content).toBe(glyph);
        expect(rumor.id).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  // 9. Idempotence of id derivation under frozen time
  describe('id derivation idempotence', () => {
    it('same inputs with frozen time produce the same id', () => {
      // Freeze Date.now() so created_at is deterministic.
      const FROZEN_NOW = 1_700_000_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);

      const rumor1 = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });

      const rumor2 = buildReactionRumor({
        emoji: '👍',
        targetMessageId: TARGET_MSG_ID,
        targetMessageKind: 14,
        targetAuthorPubkey: bobPubHex,
        selfPrivKeyHex: alicePrivHex,
      });

      vi.restoreAllMocks();

      expect(rumor1.id).toBe(rumor2.id);
      expect(rumor1.created_at).toBe(rumor2.created_at);
    });
  });
});
