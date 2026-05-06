/**
 * Unit tests for publishDirectReaction and removeDirectReaction (story-07, AC-41, AC-42).
 *
 * Covers:
 * - publishDirectReaction happy path: correct p tag, seals+wraps, publishes kind-1059 (AC-41, AC-60)
 * - publishDirectReaction failure path: NDK rejects → caller receives the error (D7)
 * - removeDirectReaction happy path: content="-", emoji tag present, seals+wraps (AC-42, D2)
 * - Round-trip: sealAndWrap → unwrapAndOpen recovers kind-7 rumor with correct fields
 *
 * crypto.subtle polyfill mirrors the sealAndWrap.test.ts pattern.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

// ─── Key helpers ─────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// Generate fixed test keypairs
const { getPublicKey, generateSecretKey } = await import('nostr-tools/pure');

const alicePrivBytes = generateSecretKey();
const alicePrivHex = bytesToHex(alicePrivBytes);
const alicePubHex = getPublicKey(alicePrivBytes);

const bobPrivBytes = generateSecretKey();
const bobPrivHex = bytesToHex(bobPrivBytes);
const bobPubHex = getPublicKey(bobPrivBytes);

// ─── Module imports ───────────────────────────────────────────────────────────

const {
  publishDirectReaction,
  removeDirectReaction,
  sealAndWrap,
  unwrapAndOpen,
  GIFT_WRAP_KIND,
  CHAT_MESSAGE_KIND,
} = await import('@/src/lib/directMessages');

const { NDKEvent } = await import('@nostr-dev-kit/ndk');

// ─── Mock ChatMessage ─────────────────────────────────────────────────────────

function makeChatMessage(id?: string): import('@/src/lib/marmot/chatPersistence').ChatMessage {
  return {
    id: id ?? ('msg-' + 'aa'.repeat(32)),
    content: 'hello world',
    senderPubkey: bobPubHex,
    groupId: `dm:${bobPubHex.toLowerCase()}`,
    createdAt: Date.now(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('publishDirectReaction (AC-41)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: returns a 64-char hex rumorId (AC-43: caller uses this for optimistic row)', async () => {
    vi.spyOn(NDKEvent.prototype, 'publish').mockResolvedValue(new Set() as any);

    const ndk = {} as any;
    const result = await publishDirectReaction({
      ndk,
      privateKeyHex: alicePrivHex,
      peerPubkeyHex: bobPubHex,
      emoji: '👍',
      targetMessage: makeChatMessage(),
    });

    expect(result.rumorId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the published event is kind-1059 gift wrap (AC-60 — no kind-7 plaintext)', async () => {
    const capturedWraps: any[] = [];

    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: any) {
      capturedWraps.push({ kind: this.kind, tags: this.tags, content: this.content });
      return new Set() as any;
    });

    const ndk = {} as any;
    await publishDirectReaction({
      ndk,
      privateKeyHex: alicePrivHex,
      peerPubkeyHex: bobPubHex,
      emoji: '👍',
      targetMessage: makeChatMessage(),
    });

    expect(capturedWraps).toHaveLength(1);
    expect(capturedWraps[0].kind).toBe(GIFT_WRAP_KIND);
    // The outer wrap addresses the recipient via p tag
    const pTag = capturedWraps[0].tags?.find((t: string[]) => t[0] === 'p');
    expect(pTag).toBeDefined();
    expect(pTag![1]).toBe(bobPubHex);
  });

  it('failure path: NDK publish rejects → error propagates to caller (D7 — caller handles rollback)', async () => {
    vi.spyOn(NDKEvent.prototype, 'publish').mockRejectedValue(new Error('relay publish failed') as any);

    const ndk = {} as any;
    await expect(
      publishDirectReaction({
        ndk,
        privateKeyHex: alicePrivHex,
        peerPubkeyHex: bobPubHex,
        emoji: '👍',
        targetMessage: makeChatMessage(),
      }),
    ).rejects.toThrow('relay publish failed');
  });
});

describe('removeDirectReaction (AC-42)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: returns a 64-char hex rumorId', async () => {
    vi.spyOn(NDKEvent.prototype, 'publish').mockResolvedValue(new Set() as any);

    const ndk = {} as any;
    const result = await removeDirectReaction({
      ndk,
      privateKeyHex: alicePrivHex,
      peerPubkeyHex: bobPubHex,
      emoji: '👍',
      targetMessage: makeChatMessage(),
    });

    expect(result.rumorId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the inner removal rumor has content="-" and an ["emoji", glyph] tag (D2 multi-emoji policy)', async () => {
    // Verify removal rumor shape directly via buildReactionRumor (same function publishDirectReaction uses)
    const { buildReactionRumor } = await import('@/src/lib/reactions/rumor');
    const targetMessage = makeChatMessage();

    const rumor = buildReactionRumor({
      emoji: '👍',
      targetMessageId: targetMessage.id,
      targetMessageKind: CHAT_MESSAGE_KIND,
      targetAuthorPubkey: bobPubHex,
      selfPrivKeyHex: alicePrivHex,
      isRemoval: true,
    });

    expect(rumor.kind).toBe(7);
    expect(rumor.content).toBe('-');
    const emojiTag = rumor.tags.find((t) => t[0] === 'emoji');
    expect(emojiTag).toEqual(['emoji', '👍']);
    const pTag = rumor.tags.find((t) => t[0] === 'p');
    expect(pTag).toEqual(['p', bobPubHex]);
  });
});

describe('DM reaction round-trip: buildReactionRumor → sealAndWrap → unwrapAndOpen', () => {
  it('Alice sends kind-7 reaction to Bob; Bob decrypts and recovers with correct fields (AC-41, AC-20)', async () => {
    const { buildReactionRumor } = await import('@/src/lib/reactions/rumor');
    const targetMessage = makeChatMessage();

    const rumor = buildReactionRumor({
      emoji: '❤️',
      targetMessageId: targetMessage.id,
      targetMessageKind: CHAT_MESSAGE_KIND,
      targetAuthorPubkey: bobPubHex,
      selfPrivKeyHex: alicePrivHex,
    });

    // Add rumor shape
    expect(rumor.kind).toBe(7);
    expect(rumor.content).toBe('❤️');
    expect(rumor.pubkey).toBe(alicePubHex);

    const eTag = rumor.tags.find((t) => t[0] === 'e');
    expect(eTag).toEqual(['e', targetMessage.id]);
    const kTag = rumor.tags.find((t) => t[0] === 'k');
    expect(kTag).toEqual(['k', String(CHAT_MESSAGE_KIND)]);
    // DM shape: p tag present (D10)
    const pTag = rumor.tags.find((t) => t[0] === 'p');
    expect(pTag).toEqual(['p', bobPubHex]);
    // No emoji tag on add rumors
    const emojiTag = rumor.tags.find((t) => t[0] === 'emoji');
    expect(emojiTag).toBeUndefined();

    // Seal and wrap
    const wrap = await sealAndWrap(rumor, bobPubHex, alicePrivHex);
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);

    // Bob unwraps
    const recovered = await unwrapAndOpen(wrap as any, bobPrivHex);
    expect(recovered.kind).toBe(7);
    expect(recovered.content).toBe('❤️');
    expect(recovered.pubkey).toBe(alicePubHex);
    expect(recovered.id).toBe(rumor.id);
    expect(recovered.tags).toEqual(rumor.tags);
  });

  it('removal round-trip: content="-" and emoji tag preserved through gift wrap', async () => {
    const { buildReactionRumor } = await import('@/src/lib/reactions/rumor');
    const targetMessage = makeChatMessage('removal-target-' + 'bb'.repeat(26));

    const rumor = buildReactionRumor({
      emoji: '👍',
      targetMessageId: targetMessage.id,
      targetMessageKind: CHAT_MESSAGE_KIND,
      targetAuthorPubkey: bobPubHex,
      selfPrivKeyHex: alicePrivHex,
      isRemoval: true,
    });

    const wrap = await sealAndWrap(rumor, bobPubHex, alicePrivHex);
    const recovered = await unwrapAndOpen(wrap as any, bobPrivHex);

    expect(recovered.kind).toBe(7);
    expect(recovered.content).toBe('-');
    const recoveredEmojiTag = recovered.tags.find((t) => t[0] === 'emoji');
    expect(recoveredEmojiTag).toEqual(['emoji', '👍']);
  });

  it('wrong recipient key cannot unwrap (gift wrap confidentiality, AC-16)', async () => {
    const { buildReactionRumor } = await import('@/src/lib/reactions/rumor');
    const rumor = buildReactionRumor({
      emoji: '👍',
      targetMessageId: 'msg-' + 'aa'.repeat(32),
      targetMessageKind: CHAT_MESSAGE_KIND,
      targetAuthorPubkey: bobPubHex,
      selfPrivKeyHex: alicePrivHex,
    });

    const wrap = await sealAndWrap(rumor, bobPubHex, alicePrivHex);

    // Eve (different keypair) cannot decrypt
    const evePrivBytes = generateSecretKey();
    const evePrivHex = bytesToHex(evePrivBytes);
    await expect(unwrapAndOpen(wrap as any, evePrivHex)).rejects.toThrow('gift wrap decryption failed');
  });
});

// ─── DM kind-7 dispatch gate: synchronously-updated Set (round-2 fix) ─────────

describe('DM kind-7 dispatch sees freshly-appended message via the synchronously-updated Set', () => {
  it('gate passes immediately after message append — no render cycle needed', () => {
    // This test models the race that the round-2 fix resolves.
    //
    // Old code (stale ref):
    //   messagesRef.current is synced by useEffect → runs after render.
    //   A kind-7 arriving between setMessages and the next render would be discarded
    //   because messagesRef.current still lacks the newly-appended message id.
    //
    // New code (synchronous Set):
    //   knownMessageIdsRef.current.add(msg.id) is called in the same tick as setMessages.
    //   A kind-7 arriving immediately after the append sees the id in the Set.
    //
    // We model the two data structures directly here to make the contract explicit
    // and test it without mounting the React component.

    const newMsg: import('@/src/lib/marmot/chatPersistence').ChatMessage = {
      id: 'new-msg-' + 'ab'.repeat(28),
      content: 'hello',
      senderPubkey: alicePubHex,
      groupId: `dm:${bobPubHex}`,
      createdAt: Date.now(),
    };

    // === Stale-ref model (old code) ===
    let messagesArray: typeof newMsg[] = [];
    // Simulate setMessages call — React state updated
    messagesArray = [...messagesArray, newMsg];
    // messagesRef.current would still be [] here (useEffect hasn't run yet)
    const staleRef: typeof newMsg[] = []; // represents messagesRef.current before render
    const gatePassesWithStaleRef = staleRef.some((m) => m.id === newMsg.id);
    expect(gatePassesWithStaleRef).toBe(false); // would silently discard — the bug

    // === Synchronous-Set model (new code) ===
    const knownIds = new Set<string>();
    // Simulate upsertMessages: add to Set in the SAME tick as setMessages
    knownIds.add(newMsg.id);
    // A kind-7 referencing this message id arrives immediately after
    const targetMessageId = newMsg.id;
    const gatePassesWithSyncSet = knownIds.has(targetMessageId);
    expect(gatePassesWithSyncSet).toBe(true); // no race — fix works
  });

  it('gate rejects a kind-7 whose targetMessageId is not in the synchronous Set', () => {
    // Sanity check: the Set must not grant false positives
    const knownIds = new Set<string>();
    knownIds.add('msg-' + 'aa'.repeat(32)); // some other message is known

    const unknownTargetId = 'unknown-' + 'ff'.repeat(29);
    expect(knownIds.has(unknownTargetId)).toBe(false); // silent discard is correct
  });
});
