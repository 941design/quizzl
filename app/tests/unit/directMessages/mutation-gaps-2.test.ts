/**
 * Mutation-gap tests (pass 2) for app/src/lib/directMessages.ts.
 *
 * Closes the Real-gap / NoCoverage survivors that remained after the
 * first gate-mutation pass (tests/unit/directMessages/mutation-gaps.test.ts).
 * A fresh Stryker 9.6.1 run flagged these because the code paths are
 * reached only via helpers that no existing test calls directly:
 *
 *   1. normalizeDirectPayload (L88-99) — exported, ZERO coverage. The
 *      round-trip tests serialise via encryptDirectPayload/JSON.stringify
 *      and never call normalizeDirectPayload. We pin its output contract
 *      for both the image and text branches.
 *
 *   2. buildPayload image branch via buildChatRumor (L74). buildChatRumor
 *      was only ever tested with text content, so the image branch
 *      (attachments present) was unexercised. We build a rumor WITH
 *      attachments and assert the serialised payload is an image envelope.
 *
 *   3. decryptDirectPayload empty-decrypt guard (L153-154). The
 *      `if (decrypted === '') return null` path had no coverage. We feed a
 *      ciphertext that decrypts to the empty string and assert null.
 *
 *   4. unwrapAndOpen sender-binding isolation (L262). The existing forgery
 *      test is masked: its forged rumor keeps the attacker's id, so the
 *      step-5 id check rejects it even when the step-4 sender-binding is
 *      disabled. We craft a forgery whose id is CANONICAL for the forged
 *      sender, so only the L262 `rumor.pubkey !== seal.pubkey` check can
 *      reject it. (Mallory-forgery vector.)
 *
 *   5. crypto helper correctness — sha256Hex (L68) and bytesToHex padStart
 *      (L61). The media integrity check is self-consistent (both sides use
 *      the same helper), so helper mutations survive. We pin a KNOWN sha256
 *      vector (computed independently with node:crypto) against the
 *      attachment.sha256 that encryptDirectMedia produces. Input bytes
 *      include values < 16 so the leading-zero hex padding is load-bearing.
 *
 *   6. removeDirectReaction isRemoval flag (L435). The happy-path test only
 *      checks the returned rumorId length (identical whether isRemoval is
 *      true or false). We capture the wrap the function actually publishes,
 *      unwrap it, and assert the inner rumor content is "-" (removal), not
 *      the emoji glyph.
 *
 * Every assertion is anchored to a user-facing behaviour (payload shape,
 * parsed content, thrown error, tag/content of a published rumor), never to
 * an internal helper name.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createHash } from 'node:crypto';
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const { getPublicKey, generateSecretKey, getEventHash } = await import('nostr-tools/pure');
const { nip04 } = await import('nostr-tools');
const { createSeal, createWrap } = await import('nostr-tools/nip59');
const {
  normalizeDirectPayload,
  decryptDirectPayload,
  buildChatRumor,
  encryptDirectMedia,
  removeDirectReaction,
  unwrapAndOpen,
  CHAT_MESSAGE_KIND,
} = await import('@/src/lib/directMessages');

const { NDKEvent } = await import('@nostr-dev-kit/ndk');

const senderPrivBytes = generateSecretKey();
const recipientPrivBytes = generateSecretKey();
const senderPub = getPublicKey(senderPrivBytes);
const recipientPub = getPublicKey(recipientPrivBytes);
const senderPrivHex = bytesToHex(senderPrivBytes);
const recipientPrivHex = bytesToHex(recipientPrivBytes);

const sampleAttachments = {
  full: {
    url: 'https://example.test/full',
    sha256: 'a'.repeat(64),
    type: 'image/webp',
    filename: 'cat.webp',
    nonce: 'b'.repeat(24),
    version: DIRECT_MEDIA_VERSION,
  },
  thumb: null,
};

const thumbOnlyAttachments = {
  full: null,
  thumb: {
    url: 'https://example.test/thumb',
    sha256: 'c'.repeat(64),
    type: 'image/webp',
    filename: 'cat.thumb.webp',
    nonce: 'd'.repeat(24),
    version: DIRECT_MEDIA_VERSION,
  },
};

// ---------------------------------------------------------------------------
// 1. normalizeDirectPayload — output contract (closes L88-99 no-coverage)
// ---------------------------------------------------------------------------

describe('normalizeDirectPayload (closes L88-99 no-coverage cluster)', () => {
  it('image payload: content carries the caption and the SAME attachments object', () => {
    const result = normalizeDirectPayload({
      type: 'image',
      version: 1,
      caption: 'a sleeping cat',
      attachments: sampleAttachments as any,
    });
    // content is the rendered image-message string and must surface the caption.
    expect(result.content).toContain('a sleeping cat');
    // attachments are passed through unchanged (same reference/value).
    expect(result.attachments).toBe(sampleAttachments);
    expect(result.attachments?.full?.filename).toBe('cat.webp');
  });

  it('text payload: returns { content: text } with NO attachments key', () => {
    const result = normalizeDirectPayload({ type: 'text', text: 'plain hello' });
    expect(result).toEqual({ content: 'plain hello' });
    // The text branch must not invent an attachments key.
    expect(result.attachments).toBeUndefined();
  });

  it('image vs text produce structurally different results from the same caption text', () => {
    const asImage = normalizeDirectPayload({
      type: 'image',
      version: 1,
      caption: 'shared text',
      attachments: sampleAttachments as any,
    });
    const asText = normalizeDirectPayload({ type: 'text', text: 'shared text' });
    // The image branch attaches media; the text branch does not.
    expect(asImage.attachments).toBeDefined();
    expect(asText.attachments).toBeUndefined();
    // And the rendered contents differ (image content is wrapped, text is raw).
    expect(asImage.content).not.toBe(asText.content);
  });
});

// ---------------------------------------------------------------------------
// 2. buildPayload image branch via buildChatRumor (closes L74)
// ---------------------------------------------------------------------------

describe('buildChatRumor payload branch (closes L74 buildPayload image/text)', () => {
  it('with attachments → the rumor content serialises an IMAGE envelope', () => {
    const rumor = buildChatRumor({
      privateKeyHex: senderPrivHex,
      peerPubkeyHex: recipientPub,
      content: 'caption here',
      attachments: sampleAttachments as any,
    });
    const payload = JSON.parse(rumor.content);
    expect(payload.type).toBe('image');
    expect(payload.version).toBe(1);
    expect(payload.caption).toBe('caption here');
    expect(payload.attachments?.full?.filename).toBe('cat.webp');
  });

  it('with THUMB-only attachments → still an IMAGE envelope (L74 `||` short-circuit)', () => {
    const rumor = buildChatRumor({
      privateKeyHex: senderPrivHex,
      peerPubkeyHex: recipientPub,
      content: 'thumb caption',
      attachments: thumbOnlyAttachments as any,
    });
    const payload = JSON.parse(rumor.content);
    expect(payload.type).toBe('image');
    expect(payload.attachments?.thumb?.filename).toBe('cat.thumb.webp');
    expect(payload.attachments?.full).toBeNull();
  });

  it('without attachments → the rumor content serialises a TEXT envelope', () => {
    const rumor = buildChatRumor({
      privateKeyHex: senderPrivHex,
      peerPubkeyHex: recipientPub,
      content: 'just words',
    });
    const payload = JSON.parse(rumor.content);
    expect(payload.type).toBe('text');
    expect(payload.text).toBe('just words');
    expect(payload.attachments).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. decryptDirectPayload empty-decrypt guard (closes L153-154 no-coverage)
// ---------------------------------------------------------------------------

describe('decryptDirectPayload empty-decrypt guard (closes L153-154)', () => {
  it('returns null when the ciphertext decrypts to the empty string', async () => {
    // nip04-encrypt an empty plaintext: this round-trips back to "" on decrypt,
    // which the empty-after-decrypt guard must treat as "nothing to show".
    const enc = await nip04.encrypt(senderPrivHex, recipientPub, '');
    const result = await decryptDirectPayload(enc, senderPrivHex, recipientPub);
    expect(result).toBeNull();
  });

  it('returns null when the ciphertext is undecryptable garbage', async () => {
    // The nip04 decrypt throws internally → the function swallows and returns null.
    const result = await decryptDirectPayload('not-a-valid-ciphertext', senderPrivHex, recipientPub);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. unwrapAndOpen sender-binding isolation (closes L262)
// ---------------------------------------------------------------------------

describe('unwrapAndOpen sender-binding isolation (closes L262 — Mallory forgery)', () => {
  it('rejects a forged rumor whose id is canonical but whose seal is signed by a different key', async () => {
    // Three parties: Alice (the impersonated sender), Mallory (the attacker),
    // Bob (the recipient).
    const aliceSk = generateSecretKey();
    const alicePub = getPublicKey(aliceSk);
    const mallorySk = generateSecretKey();
    const bobSk = generateSecretKey();
    const bobPub = getPublicKey(bobSk);
    const bobPrivHex = bytesToHex(bobSk);

    // Mallory crafts a rumor that CLAIMS to be from Alice and — crucially —
    // computes the CANONICAL id for that forged (pubkey=Alice) content. This
    // defeats the step-5 id check, so the step-4 sender-binding
    // (rumor.pubkey !== seal.pubkey) is the ONLY barrier left. The existing
    // forgery test in sealAndWrap.test.ts keeps Mallory's id, so step-5 masks
    // L262; this test isolates it.
    const forgedBase = {
      pubkey: alicePub,
      kind: CHAT_MESSAGE_KIND,
      content: '{"type":"text","text":"I am Alice!"}',
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', bobPub]],
    };
    const forgedRumor = { ...forgedBase, id: getEventHash(forgedBase as any) };

    // Mallory seals with their OWN key (so the seal signature verifies and
    // seal.pubkey === Mallory), then wraps to Bob.
    const seal = createSeal(forgedRumor as any, mallorySk, bobPub);
    const wrap = createWrap(seal, bobPub);

    await expect(unwrapAndOpen(wrap as any, bobPrivHex)).rejects.toThrow(
      /gift wrap decryption failed/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. crypto helper correctness via a known sha256 vector (closes L61, L68)
// ---------------------------------------------------------------------------

describe('encryptDirectMedia integrity hash (closes L61 padStart / L68 sha256Hex)', () => {
  it('attachment.sha256 equals the independently-computed SHA-256 of the plaintext', async () => {
    // Bytes deliberately include values < 16 so each digest byte under 0x10
    // exercises the leading-zero hex padding. The expected hash is computed
    // with node:crypto — fully independent of the SUT's hashing helper — so a
    // mutated sha256Hex/bytesToHex produces an observably wrong value.
    const plaintext = new Uint8Array([0x00, 0x01, 0x02, 0x0f, 0x10, 0xff]);
    const expected = createHash('sha256').update(plaintext).digest('hex');

    const blob = new Blob([plaintext], { type: 'image/webp' });
    const { attachment } = await encryptDirectMedia(
      blob,
      { filename: 'vec.webp', type: 'image/webp' },
      senderPrivHex,
      recipientPub,
    );

    expect(attachment.sha256).toBe(expected);
    // Sanity: a 64-char lowercase hex string with leading zeros possible.
    expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// 6. removeDirectReaction isRemoval flag (closes L435)
// ---------------------------------------------------------------------------

describe('removeDirectReaction removal semantics (closes L435 isRemoval)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeChatMessage(): import('@/src/lib/marmot/chatPersistence').ChatMessage {
    return {
      id: 'aa'.repeat(32),
      content: 'hello world',
      senderPubkey: recipientPub,
      groupId: `dm:${recipientPub.toLowerCase()}`,
      createdAt: Date.now(),
    };
  }

  it('publishes a wrap whose inner rumor has content "-" (a removal), not the emoji', async () => {
    const captured: any[] = [];
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: any) {
      captured.push({ kind: this.kind, content: this.content, tags: this.tags, pubkey: this.pubkey, created_at: this.created_at, id: this.id, sig: this.sig });
      return new Set() as any;
    });

    await removeDirectReaction({
      ndk: {} as any,
      privateKeyHex: senderPrivHex,
      peerPubkeyHex: recipientPub,
      emoji: '👍',
      targetMessage: makeChatMessage(),
    });

    expect(captured).toHaveLength(1);
    // Unwrap the published gift wrap as the recipient to inspect the inner rumor.
    const recovered = await unwrapAndOpen(captured[0] as any, recipientPrivHex);
    // Removal is signalled by content "-" (not the emoji glyph).
    expect(recovered.content).toBe('-');
    // The emoji tag disambiguates WHICH reaction is being removed.
    const emojiTag = recovered.tags.find((t) => t[0] === 'emoji');
    expect(emojiTag).toEqual(['emoji', '👍']);
  });
});
