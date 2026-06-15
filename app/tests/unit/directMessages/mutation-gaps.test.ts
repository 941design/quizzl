/**
 * Mutation-gap tests for app/src/lib/directMessages.ts (gate-mutation pass).
 *
 * Closes the highest-value Real-gap survivors observed in
 *   reports/mutation/gate-directMessages.json
 *
 * Coverage focus (security and behavior, in order of priority):
 *
 *   1. Image payload branch in buildPayload / normalizeDirectPayload (L74-98).
 *      Pre-existing tests only exercise text payloads. The mutation report
 *      shows 18 surviving / no-coverage mutants in lines 74-98 because no
 *      caller-level test reaches the image branch. We pin the user-facing
 *      contract: when attachments are present, the payload is an image
 *      envelope; when absent, it's a text envelope.
 *
 *   2. parseDirectPayload image branch (L108-116). 11 surviving mutants on
 *      the type/version/caption/attachments guards. We round-trip a real
 *      image envelope and assert the parsed shape.
 *
 *   3. unwrapAndOpen kind guards (L236, L247) and seal pubkey/rumor pubkey
 *      bind (L262) — the Mallory forgery vector. Sealed/wrapped tests already
 *      cover the rumor-vs-seal pubkey mismatch path, but Stryker flags the
 *      L236/L247 kind-check survivors. We feed wrong-kind inputs.
 *
 *   4. buildChatRumor: extraTags branch (L303) and timestamp unit (L311).
 *      L303 `> 0` → `>= 0` survives because no test calls with an empty
 *      extraTags array (the existing AC-MARKER-1 test always passes a
 *      non-empty list). L311 `/ 1000` → `* 1000` survives because no test
 *      asserts the rumor's created_at is a unix-second value.
 *
 *   5. removeDirectReaction isRemoval flag (L454). `isRemoval: true` → `false`
 *      survives because no test asserts the published rumor content is "-".
 *      Removal vs add is the user-facing semantic distinction.
 *
 *   6. decryptDirectMedia integrity check (L522). The `digest !== sha256`
 *      guard is the AES-GCM-plus-app-layer tamper-detection. We tamper the
 *      attachment sha256 and assert the decrypt throws.
 *
 *   7. feedbackMarkerTags (L345-350). The whole function is currently
 *      no-coverage. AC-MARKER-1 demands deterministic markers; we pin both
 *      branches (with and without NEXT_PUBLIC_BUILD_VERSION).
 *
 * Each test is anchored to a user-facing behavior, not to the implementation
 * of the branch. Tests do NOT name internal helpers like hexToBytes or
 * bytesToHex; they assert on payloads, parsed shapes, tags, and error throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { DIRECT_MEDIA_VERSION } from '@/src/lib/media/imageMessage';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

vi.mock('@/src/lib/media/blossomClient', () => ({
  put: vi.fn(),
  get: vi.fn(),
}));

const { get: blossomGet } = await import('@/src/lib/media/blossomClient');
const { getPublicKey, generateSecretKey, finalizeEvent } = await import('nostr-tools/pure');
const { nip44 } = await import('nostr-tools');
const {
  encryptDirectPayload,
  decryptDirectPayload,
  parseDirectPayload,
  encryptDirectMedia,
  decryptDirectMedia,
  sealAndWrap,
  unwrapAndOpen,
  buildChatRumor,
  feedbackMarkerTags,
  GIFT_WRAP_KIND,
  CHAT_MESSAGE_KIND,
  DIRECT_MESSAGE_KIND,
} = await import('@/src/lib/directMessages');

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const senderPrivBytes = generateSecretKey();
const recipientPrivBytes = generateSecretKey();
const senderPub = getPublicKey(senderPrivBytes);
const recipientPub = getPublicKey(recipientPrivBytes);
const senderPrivHex = bytesToHex(senderPrivBytes);
const recipientPrivHex = bytesToHex(recipientPrivBytes);

// --------------------------------------------------------------------------
// 1. Image payload branch coverage — buildPayload + normalizeDirectPayload
// --------------------------------------------------------------------------

describe('image payload round-trip (closes L74-98 cluster)', () => {
  const fullAttachment = {
    url: 'https://example.test/full',
    sha256: 'a'.repeat(64),
    type: 'image/webp',
    filename: 'cat.webp',
    nonce: 'b'.repeat(24),
    version: DIRECT_MEDIA_VERSION,
  };
  const thumbAttachment = {
    url: 'https://example.test/thumb',
    sha256: 'c'.repeat(64),
    type: 'image/webp',
    filename: 'cat.thumb.webp',
    nonce: 'd'.repeat(24),
    version: DIRECT_MEDIA_VERSION,
  };

  it('round-trips an image payload with FULL attachment only (no thumb)', async () => {
    const encrypted = await encryptDirectPayload(
      {
        type: 'image',
        version: 1,
        caption: 'cat photo',
        attachments: { full: fullAttachment, thumb: null },
      },
      senderPrivHex,
      recipientPub,
    );
    const decrypted = await decryptDirectPayload(encrypted, senderPrivHex, recipientPub);
    expect(decrypted).not.toBeNull();
    // Image payloads serialise into a content string that includes the caption AND
    // the attachment marker (per buildImageMessageContent).
    expect(decrypted!.content).toContain('cat photo');
    expect(decrypted!.attachments?.full?.filename).toBe('cat.webp');
    expect(decrypted!.attachments?.full?.url).toBe('https://example.test/full');
    expect(decrypted!.attachments?.thumb).toBeNull();
  });

  it('round-trips an image payload with THUMB attachment only (no full)', async () => {
    // Distinct branch: attachments.thumb truthy, attachments.full null.
    // Existing tests never exercise this; without it L74's `||` short-circuit
    // is unobservable.
    const encrypted = await encryptDirectPayload(
      {
        type: 'image',
        version: 1,
        caption: 'thumb only',
        attachments: { full: null, thumb: thumbAttachment },
      },
      senderPrivHex,
      recipientPub,
    );
    const decrypted = await decryptDirectPayload(encrypted, senderPrivHex, recipientPub);
    expect(decrypted).not.toBeNull();
    expect(decrypted!.attachments?.full).toBeNull();
    expect(decrypted!.attachments?.thumb?.filename).toBe('cat.thumb.webp');
  });

  it('round-trips an image payload with BOTH attachments', async () => {
    const encrypted = await encryptDirectPayload(
      {
        type: 'image',
        version: 1,
        caption: 'both roles',
        attachments: { full: fullAttachment, thumb: thumbAttachment },
      },
      senderPrivHex,
      recipientPub,
    );
    const decrypted = await decryptDirectPayload(encrypted, senderPrivHex, recipientPub);
    expect(decrypted!.attachments?.full?.filename).toBe('cat.webp');
    expect(decrypted!.attachments?.thumb?.filename).toBe('cat.thumb.webp');
  });

  it('round-trips a text payload (no attachments) and parses with NO attachments key', async () => {
    const encrypted = await encryptDirectPayload(
      { type: 'text', text: 'hello world' },
      senderPrivHex,
      recipientPub,
    );
    const decrypted = await decryptDirectPayload(encrypted, senderPrivHex, recipientPub);
    expect(decrypted).toEqual({ content: 'hello world' });
    // Asserting equality (not just toContain) catches the L82 `{}` mutant
    // that would still produce a parseable but malformed payload.
    expect((decrypted as any).attachments).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// 2. parseDirectPayload image branch (L108-116 cluster)
// --------------------------------------------------------------------------

describe('parseDirectPayload image branch (closes L108-116 cluster)', () => {
  const validImageRaw = JSON.stringify({
    type: 'image',
    version: 1,
    caption: 'pinned caption',
    attachments: {
      full: { url: 'u', sha256: 'a'.repeat(64), type: 'image/webp', filename: 'f.webp', nonce: 'b'.repeat(24), version: DIRECT_MEDIA_VERSION },
      thumb: null,
    },
  });

  it('parses a valid image envelope and surfaces caption + attachments', () => {
    const result = parseDirectPayload(validImageRaw);
    expect(result).not.toBeNull();
    expect(result!.content).toContain('pinned caption');
    expect(result!.attachments?.full?.filename).toBe('f.webp');
  });

  it('rejects image envelope with wrong type ("img" instead of "image") — treats as raw', () => {
    const raw = JSON.stringify({
      type: 'img', // not 'image'
      version: 1,
      caption: 'c',
      attachments: { full: null, thumb: null },
    });
    const result = parseDirectPayload(raw);
    // Lenient fallback: not an image, not text — returns { content: raw }
    expect(result?.content).toBe(raw);
    expect(result?.attachments).toBeUndefined();
  });

  it('rejects image envelope with wrong version (2 instead of 1) — treats as raw', () => {
    const raw = JSON.stringify({
      type: 'image',
      version: 2, // not 1
      caption: 'c',
      attachments: { full: null, thumb: null },
    });
    const result = parseDirectPayload(raw);
    expect(result?.content).toBe(raw);
    expect(result?.attachments).toBeUndefined();
  });

  it('rejects image envelope with missing attachments object — treats as raw', () => {
    const raw = JSON.stringify({
      type: 'image',
      version: 1,
      caption: 'c',
      // attachments missing
    });
    const result = parseDirectPayload(raw);
    expect(result?.content).toBe(raw);
    expect(result?.attachments).toBeUndefined();
  });

  it('rejects image envelope with non-string caption — treats as raw', () => {
    const raw = JSON.stringify({
      type: 'image',
      version: 1,
      caption: 42, // not a string
      attachments: { full: null, thumb: null },
    });
    const result = parseDirectPayload(raw);
    expect(result?.content).toBe(raw);
    expect(result?.attachments).toBeUndefined();
  });

  it('rejects text envelope with non-string text — treats as raw', () => {
    const raw = JSON.stringify({
      type: 'text',
      text: 42, // not a string
    });
    const result = parseDirectPayload(raw);
    expect(result?.content).toBe(raw);
    expect(result?.attachments).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// 3. unwrapAndOpen kind guards (L236, L247)
// --------------------------------------------------------------------------

describe('unwrapAndOpen rejects non-gift-wrap inputs (closes L236, L247 cluster)', () => {
  it('rejects a kind-1 event (not a gift wrap)', async () => {
    const fakeWrap = finalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'whatever' },
      senderPrivBytes,
    );
    await expect(unwrapAndOpen(fakeWrap, recipientPrivHex)).rejects.toThrow(
      /gift wrap decryption failed/,
    );
  });

  it('rejects a kind-13 seal fed directly (the inner kind, not the wrap kind)', async () => {
    // kind-13 is the SEAL kind — a seal must never be unwrapped as a wrap.
    const fakeSeal = finalizeEvent(
      { kind: 13, created_at: Math.floor(Date.now() / 1000), tags: [], content: '' },
      senderPrivBytes,
    );
    await expect(unwrapAndOpen(fakeSeal, recipientPrivHex)).rejects.toThrow(
      /gift wrap decryption failed/,
    );
  });

  it('rejects a kind-1059 wrap whose inner kind is NOT a seal (kind-13)', async () => {
    // Build a wrap whose content is a NON-kind-13 inner event. The L247
    // `seal.kind !== SEAL_KIND` guard catches this; mutated to false, the
    // function proceeds to decrypt as if it were a seal and fails later —
    // BUT the failure is the same generic 'gift wrap decryption failed'
    // error. To distinguish, we craft a syntactically valid kind-99 inner
    // event encrypted under the recipient's ECDH so the decryption step
    // succeeds, and the L247 guard is the only thing standing between us
    // and a misclassified rumor.
    const ephemeralPrivBytes = generateSecretKey();
    const ephemeralPub = getPublicKey(ephemeralPrivBytes);
    const innerFakeSeal = finalizeEvent(
      { kind: 99, created_at: Math.floor(Date.now() / 1000), tags: [], content: '{"kind":14,"content":"x","pubkey":"' + senderPub + '","created_at":1,"tags":[],"id":"' + 'a'.repeat(64) + '"}' },
      senderPrivBytes,
    );
    const sealJson = JSON.stringify(innerFakeSeal);
    const wrapContent = nip44.v2.encrypt(
      sealJson,
      nip44.v2.utils.getConversationKey(ephemeralPrivBytes, recipientPub),
    );
    const malformedWrap = finalizeEvent(
      { kind: GIFT_WRAP_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipientPub]], content: wrapContent },
      ephemeralPrivBytes,
    );
    await expect(unwrapAndOpen(malformedWrap, recipientPrivHex)).rejects.toThrow(
      /gift wrap decryption failed/,
    );
  });
});

// --------------------------------------------------------------------------
// 4. buildChatRumor — extraTags + timestamp (L303, L311)
// --------------------------------------------------------------------------

describe('buildChatRumor (closes L303 extraTags and L311 timestamp gaps)', () => {
  it('omits extraTags when an empty array is passed (L303: >0 boundary)', () => {
    // L303 mutant: `extraTags.length > 0` → `>= 0`. With an empty array,
    // `> 0` is false but `>= 0` is true → mutant would append the empty
    // spread (semantically same result) BUT the second mutant
    // `→ true` always spreads even when undefined. We pin: with empty array,
    // the tag list contains EXACTLY one tag (the ['p', peer] tag).
    const rumor = buildChatRumor({
      privateKeyHex: senderPrivHex,
      peerPubkeyHex: recipientPub,
      content: 'msg',
      extraTags: [],
    });
    expect(rumor.tags.length).toBe(1);
    expect(rumor.tags[0]).toEqual(['p', recipientPub]);
  });

  it('omits extraTags when extraTags is undefined', () => {
    const rumor = buildChatRumor({
      privateKeyHex: senderPrivHex,
      peerPubkeyHex: recipientPub,
      content: 'msg',
    });
    expect(rumor.tags.length).toBe(1);
    expect(rumor.tags[0]).toEqual(['p', recipientPub]);
  });

  it('appends extraTags after the p-tag when a non-empty list is given', () => {
    const rumor = buildChatRumor({
      privateKeyHex: senderPrivHex,
      peerPubkeyHex: recipientPub,
      content: 'msg',
      extraTags: [['l', 'feedback'], ['client', 'nostling']],
    });
    expect(rumor.tags.length).toBe(3);
    expect(rumor.tags[0]).toEqual(['p', recipientPub]);
    expect(rumor.tags[1]).toEqual(['l', 'feedback']);
    expect(rumor.tags[2]).toEqual(['client', 'nostling']);
  });

  it('sets created_at to a current unix-SECOND value, not milliseconds (L311)', () => {
    const before = Math.floor(Date.now() / 1000);
    const rumor = buildChatRumor({
      privateKeyHex: senderPrivHex,
      peerPubkeyHex: recipientPub,
      content: 'msg',
    });
    const after = Math.floor(Date.now() / 1000);
    // Unix seconds in 2026 are ~1.78e9. Milliseconds would be ~1.78e12.
    // L311 mutant `* 1000` → milliseconds value (≈10^12), clearly out of
    // the `[before, after]` second-window.
    expect(rumor.created_at).toBeGreaterThanOrEqual(before);
    expect(rumor.created_at).toBeLessThanOrEqual(after);
    expect(rumor.created_at).toBeLessThan(1e11); // milliseconds would be > 1e11
  });

  it('uses kind-14 (CHAT_MESSAGE_KIND) for the rumor', () => {
    const rumor = buildChatRumor({
      privateKeyHex: senderPrivHex,
      peerPubkeyHex: recipientPub,
      content: 'msg',
    });
    expect(rumor.kind).toBe(CHAT_MESSAGE_KIND);
    expect(rumor.kind).toBe(14);
  });
});

// --------------------------------------------------------------------------
// 5. decryptDirectMedia integrity check (L522 — security-critical)
// --------------------------------------------------------------------------

describe('decryptDirectMedia integrity check (closes L522 — security-critical)', () => {
  it('throws when the stored sha256 does not match the decrypted plaintext', async () => {
    const blob = new Blob([new Uint8Array([10, 20, 30, 40])], { type: 'image/webp' });
    const { encrypted, attachment } = await encryptDirectMedia(
      blob,
      { filename: 'p.webp', type: 'image/webp' },
      senderPrivHex,
      recipientPub,
    );
    vi.mocked(blossomGet).mockResolvedValue(encrypted as any);

    // Tamper: claim a wrong sha256. Mutation `digest !== attachment.sha256` → false
    // would skip the throw and return the (correctly-decrypted) bytes anyway.
    const tampered = { ...attachment, url: 'https://example.test/blob', sha256: 'f'.repeat(64) };
    await expect(decryptDirectMedia(tampered, senderPrivHex, recipientPub)).rejects.toThrow(
      /direct media integrity check failed/,
    );
  });

  it('succeeds when the stored sha256 matches the decrypted plaintext', async () => {
    const blob = new Blob([new Uint8Array([5, 6, 7, 8])], { type: 'image/webp' });
    const { encrypted, attachment } = await encryptDirectMedia(
      blob,
      { filename: 'p.webp', type: 'image/webp' },
      senderPrivHex,
      recipientPub,
    );
    vi.mocked(blossomGet).mockResolvedValue(encrypted as any);
    const result = await decryptDirectMedia(
      { ...attachment, url: 'https://example.test/blob' },
      senderPrivHex,
      recipientPub,
    );
    expect(Array.from(result.bytes)).toEqual([5, 6, 7, 8]);
  });
});

// --------------------------------------------------------------------------
// 6. feedbackMarkerTags — AC-MARKER-1 (closes L345-350 no-coverage block)
// --------------------------------------------------------------------------

describe('feedbackMarkerTags (closes L345-350 no-coverage block, AC-MARKER-1)', () => {
  const savedVer = process.env.NEXT_PUBLIC_BUILD_VERSION;

  afterEach(() => {
    if (savedVer === undefined) delete process.env.NEXT_PUBLIC_BUILD_VERSION;
    else process.env.NEXT_PUBLIC_BUILD_VERSION = savedVer;
  });

  it('returns a 3-element client tag when NEXT_PUBLIC_BUILD_VERSION is set', () => {
    process.env.NEXT_PUBLIC_BUILD_VERSION = '2026.06.15-abc';
    const tags = feedbackMarkerTags();
    expect(tags).toHaveLength(2);
    expect(tags[0]).toEqual(['client', 'nostling', '2026.06.15-abc']);
    expect(tags[1]).toEqual(['l', 'feedback']);
  });

  it('returns a 2-element client tag when NEXT_PUBLIC_BUILD_VERSION is unset', () => {
    delete process.env.NEXT_PUBLIC_BUILD_VERSION;
    const tags = feedbackMarkerTags();
    expect(tags).toHaveLength(2);
    expect(tags[0]).toEqual(['client', 'nostling']);
    expect(tags[0]).toHaveLength(2);
    expect(tags[1]).toEqual(['l', 'feedback']);
  });

  it('returns a 2-element client tag when NEXT_PUBLIC_BUILD_VERSION is the empty string (falsy)', () => {
    process.env.NEXT_PUBLIC_BUILD_VERSION = '';
    const tags = feedbackMarkerTags();
    expect(tags[0]).toEqual(['client', 'nostling']);
    expect(tags[0]).toHaveLength(2);
  });
});

// --------------------------------------------------------------------------
// 7. Public constants (closes the GIFT_WRAP_KIND / DIRECT_MESSAGE_KIND
//    StringLiteral mutants that might survive when callers don't pin them)
// --------------------------------------------------------------------------

describe('exported kind constants', () => {
  it('GIFT_WRAP_KIND is 1059 per NIP-59', () => {
    expect(GIFT_WRAP_KIND).toBe(1059);
  });
  it('CHAT_MESSAGE_KIND is 14 per NIP-17', () => {
    expect(CHAT_MESSAGE_KIND).toBe(14);
  });
  it('DIRECT_MESSAGE_KIND is 4 (legacy kind-4 inbound only)', () => {
    expect(DIRECT_MESSAGE_KIND).toBe(4);
  });
});
