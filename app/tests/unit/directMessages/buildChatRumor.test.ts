/**
 * Tests for buildChatRumor extraTags extension (S2 — DM source marker).
 *
 * Property tested:
 *   For any valid extra tags, the resulting rumor always carries ["p", peerPubkeyHex]
 *   as its first tag, followed by the extra tags in order, and the rumor id is
 *   correctly computed (round-trip structural contract).
 *
 * Ensures that ordinary callers (no extraTags) are unaffected and that
 * the feedback marker tags surface on the inner rumor.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
const { buildChatRumor, feedbackMarkerTags } = await import('@/src/lib/directMessages');

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function makeKey() {
  const sk = generateSecretKey();
  return { privateKeyHex: bytesToHex(sk), pubkeyHex: getPublicKey(sk) };
}

describe('buildChatRumor — extraTags (S2)', () => {
  let sender: { privateKeyHex: string; pubkeyHex: string };
  let peer: { privateKeyHex: string; pubkeyHex: string };

  beforeAll(() => {
    sender = makeKey();
    peer = makeKey();
  });

  it('ordinary call produces only ["p", peerPubkeyHex] tag', () => {
    const rumor = buildChatRumor({
      privateKeyHex: sender.privateKeyHex,
      peerPubkeyHex: peer.pubkeyHex,
      content: 'hello',
    });
    expect(rumor.tags).toEqual([['p', peer.pubkeyHex]]);
  });

  it('extraTags are appended after ["p", peerPubkeyHex]', () => {
    const extra: string[][] = [['client', 'few', '1.0.0'], ['l', 'feedback']];
    const rumor = buildChatRumor({
      privateKeyHex: sender.privateKeyHex,
      peerPubkeyHex: peer.pubkeyHex,
      content: 'feedback message',
      extraTags: extra,
    });
    expect(rumor.tags[0]).toEqual(['p', peer.pubkeyHex]);
    expect(rumor.tags[1]).toEqual(['client', 'few', '1.0.0']);
    expect(rumor.tags[2]).toEqual(['l', 'feedback']);
    expect(rumor.tags.length).toBe(3);
  });

  it('passing empty extraTags array has same result as omitting it', () => {
    const withEmpty = buildChatRumor({
      privateKeyHex: sender.privateKeyHex,
      peerPubkeyHex: peer.pubkeyHex,
      content: 'same',
      extraTags: [],
    });
    const withOmitted = buildChatRumor({
      privateKeyHex: sender.privateKeyHex,
      peerPubkeyHex: peer.pubkeyHex,
      content: 'same',
    });
    expect(withEmpty.tags).toEqual(withOmitted.tags);
  });

  it('rumor has a valid id (non-empty string)', () => {
    const rumor = buildChatRumor({
      privateKeyHex: sender.privateKeyHex,
      peerPubkeyHex: peer.pubkeyHex,
      content: 'check id',
      extraTags: [['l', 'feedback']],
    });
    expect(typeof rumor.id).toBe('string');
    expect(rumor.id.length).toBe(64); // 32-byte sha256 hex
  });

  it('rumor id changes when extra tags change (tags are part of the NIP-01 hash)', () => {
    const base = buildChatRumor({
      privateKeyHex: sender.privateKeyHex,
      peerPubkeyHex: peer.pubkeyHex,
      content: 'same content',
    });
    const withExtra = buildChatRumor({
      privateKeyHex: sender.privateKeyHex,
      peerPubkeyHex: peer.pubkeyHex,
      content: 'same content',
      extraTags: [['l', 'feedback']],
    });
    // Different tags → different id (NIP-01 canonical hash includes tags)
    expect(base.id).not.toBe(withExtra.id);
  });
});

describe('feedbackMarkerTags (AC-MARKER-1)', () => {
  it('returns a client tag and an l=feedback discriminator', () => {
    const tags = feedbackMarkerTags();
    // First tag is the client identifier; with no build version it is 2-element.
    expect(tags[0][0]).toBe('client');
    expect(tags[0][1]).toBe('few');
    // The label discriminator is always present and exact.
    const labelTag = tags.find((t) => t[0] === 'l');
    expect(labelTag).toEqual(['l', 'feedback']);
  });

  it('includes the build version in the client tag when NEXT_PUBLIC_BUILD_VERSION is set', () => {
    const prev = process.env.NEXT_PUBLIC_BUILD_VERSION;
    process.env.NEXT_PUBLIC_BUILD_VERSION = '2026.06.15-abc';
    try {
      const tags = feedbackMarkerTags();
      expect(tags[0]).toEqual(['client', 'few', '2026.06.15-abc']);
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_BUILD_VERSION;
      else process.env.NEXT_PUBLIC_BUILD_VERSION = prev;
    }
  });

  it('omits the version slot when NEXT_PUBLIC_BUILD_VERSION is unset (2-element client tag)', () => {
    const prev = process.env.NEXT_PUBLIC_BUILD_VERSION;
    delete process.env.NEXT_PUBLIC_BUILD_VERSION;
    try {
      const tags = feedbackMarkerTags();
      expect(tags[0]).toEqual(['client', 'few']);
    } finally {
      if (prev !== undefined) process.env.NEXT_PUBLIC_BUILD_VERSION = prev;
    }
  });

  it('a feedback rumor carries both markers on the inner rumor tags', () => {
    const s = makeKey();
    const p = makeKey();
    const rumor = buildChatRumor({
      privateKeyHex: s.privateKeyHex,
      peerPubkeyHex: p.pubkeyHex,
      content: 'bug report',
      extraTags: feedbackMarkerTags(),
    });
    expect(rumor.tags[0]).toEqual(['p', p.pubkeyHex]);
    expect(rumor.tags.some((t) => t[0] === 'client' && t[1] === 'few')).toBe(true);
    expect(rumor.tags.some((t) => t[0] === 'l' && t[1] === 'feedback')).toBe(true);
  });
});
