/**
 * Unit tests for shareCard.ts — Story S6, "Share contact card".
 *
 * Covers:
 *   - VQ-S6-004 / AC-UX-4: card production verifies via REAL getEventHash/
 *     verifyEvent in local-key, NIP-07 (stubbed remote sign), and NIP-46
 *     (stubbed remote sign) modes. nostr-tools/pure is NEVER mocked here —
 *     only the remote NDK signer's `.sign()`/`.getPublicKey()` surface is a
 *     stub, and that stub signs with a real test private key so the
 *     produced signature genuinely verifies (see contactCard.test.ts and
 *     tests/unit/calls/callSignaling.test.ts for the sibling precedents).
 *   - AC-CARD-6: no nickname set -> unsigned card, round-tripping to a
 *     pubkey-only parse result.
 *   - VQ-S6-001 / VQ-S6-006: the cache rebuilds on the first open and on a
 *     nickname or signer-mode change, but NOT on a repeat open with an
 *     unchanged key — asserted by counting signer invocations.
 */
import { describe, it, expect, vi } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import type { NDKNip46Signer, NDKNip07Signer } from '@nostr-dev-kit/ndk';
import {
  createPrivateKeySigner,
  createNip46EventSigner,
  createNip07EventSigner,
} from '@/src/lib/marmot/signerAdapter';
import { parseContactCard } from '@/src/lib/contactCard';
import {
  shouldRebuildShareCard,
  buildOwnShareCard,
  getOwnShareCard,
  type ShareCardCacheEntry,
} from '@/src/lib/shareCard';

const FIXED_CREATED_AT = 1735689600; // 2025-01-01T00:00:00Z

type EventDraft = { kind: number; created_at: number; tags: string[][]; content: string };

function makeIdentity() {
  const sk = generateSecretKey();
  const skHex = bytesToHex(sk);
  const pubkeyHex = getPublicKey(sk);
  return { sk, skHex, pubkeyHex };
}

/**
 * A fake NDKNip46Signer whose `.sign()` is a stub for the REMOTE ROUND TRIP
 * only — it computes a genuine schnorr signature over the given event using
 * a real test private key (via nostr-tools' own finalizeEvent), so the card
 * this produces verifies for real. Never stubs getEventHash/verifyEvent.
 */
function makeFakeNip46Signer(sk: Uint8Array, pubkeyHex: string) {
  const signSpy = vi.fn(async (event: EventDraft) => {
    const signed = finalizeEvent(
      { kind: event.kind, created_at: event.created_at, tags: event.tags, content: event.content },
      sk,
    );
    return signed.sig;
  });
  const fake = {
    getPublicKey: vi.fn(async () => pubkeyHex),
    sign: signSpy,
  };
  return { fake: fake as unknown as NDKNip46Signer, signSpy };
}

/** Same idea as makeFakeNip46Signer, shaped for the NDKNip07Signer adapter (sync `.pubkey` getter). */
function makeFakeNip07Signer(sk: Uint8Array, pubkeyHex: string) {
  const signSpy = vi.fn(async (event: EventDraft) => {
    const signed = finalizeEvent(
      { kind: event.kind, created_at: event.created_at, tags: event.tags, content: event.content },
      sk,
    );
    return signed.sig;
  });
  const fake = { pubkey: pubkeyHex, sign: signSpy };
  return { fake: fake as unknown as NDKNip07Signer, signSpy };
}

// ── VQ-S6-004 / AC-UX-4 — adapter-level production + real verification ─────

describe('buildOwnShareCard — adapter modes verify via real getEventHash/verifyEvent', () => {
  it('local-key mode', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);

    const shareUrl = await buildOwnShareCard(
      pubkeyHex,
      { nickname: 'Alice', createdAt: FIXED_CREATED_AT },
      signer.signEvent,
    );

    expect(shareUrl.startsWith('https://few.chat/add#c=')).toBe(true);
    const parsed = parseContactCard(shareUrl);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) throw new Error('unreachable');
    expect(parsed.pubkeyHex).toBe(pubkeyHex);
    expect('profile' in parsed).toBe(true);
    if ('profile' in parsed) expect(parsed.profile.nickname).toBe('Alice');
  });

  it('NIP-07 mode (stubbed remote sign only)', async () => {
    const { sk, pubkeyHex } = makeIdentity();
    const { fake, signSpy } = makeFakeNip07Signer(sk, pubkeyHex);
    const signer = createNip07EventSigner(fake);

    const shareUrl = await buildOwnShareCard(
      pubkeyHex,
      { nickname: 'Bob', createdAt: FIXED_CREATED_AT },
      signer.signEvent,
    );

    expect(signSpy).toHaveBeenCalledTimes(1);
    const parsed = parseContactCard(shareUrl);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) throw new Error('unreachable');
    expect(parsed.pubkeyHex).toBe(pubkeyHex);
    if ('profile' in parsed) expect(parsed.profile.nickname).toBe('Bob');
  });

  it('NIP-46 mode (stubbed remote sign only)', async () => {
    const { sk, pubkeyHex } = makeIdentity();
    const { fake, signSpy } = makeFakeNip46Signer(sk, pubkeyHex);
    const signer = createNip46EventSigner(fake);

    const shareUrl = await buildOwnShareCard(
      pubkeyHex,
      { nickname: 'Carol', createdAt: FIXED_CREATED_AT },
      signer.signEvent,
    );

    expect(signSpy).toHaveBeenCalledTimes(1);
    const parsed = parseContactCard(shareUrl);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) throw new Error('unreachable');
    expect(parsed.pubkeyHex).toBe(pubkeyHex);
    if ('profile' in parsed) expect(parsed.profile.nickname).toBe('Carol');
  });

  it('rejects a signer whose pubkey does not match the card subject (guards the AC-SIG-3 intent at production time)', async () => {
    // This exercises encodeCard's own pre-sign guard (contactCard.ts:
    // "signer pubkey does not match the supplied pubkeyHex"), not
    // decode-time verifyEvent — it's a different, earlier failure mode from
    // AC-SIG-3 (a name altered AFTER signing), included here so a future
    // change to buildOwnShareCard can't silently drop this guard.
    const { pubkeyHex } = makeIdentity();
    const otherIdentity = makeIdentity();
    const otherSigner = createPrivateKeySigner(otherIdentity.skHex);

    await expect(
      buildOwnShareCard(pubkeyHex, { nickname: 'Mallory', createdAt: FIXED_CREATED_AT }, otherSigner.signEvent),
    ).rejects.toThrow(/signer pubkey does not match/);
  });

  it('no nickname set -> unsigned card; round-trips to a pubkey-only parse result (AC-CARD-6)', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);

    const shareUrl = await buildOwnShareCard(pubkeyHex, { nickname: '', createdAt: FIXED_CREATED_AT }, signer.signEvent);

    const parsed = parseContactCard(shareUrl);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) throw new Error('unreachable');
    expect(parsed.pubkeyHex).toBe(pubkeyHex);
    expect('profile' in parsed).toBe(false);
    expect(Object.keys(parsed)).toEqual(['pubkeyHex']);
  });
});

// ── VQ-S6-001 / VQ-S6-006 — cache staleness ─────────────────────────────────

describe('shouldRebuildShareCard', () => {
  it('rebuilds when there is no cache yet', () => {
    expect(
      shouldRebuildShareCard(null, { nickname: 'Alice', signerMode: 'local', pubkeyHex: 'pk-a' }),
    ).toBe(true);
  });

  it('does NOT rebuild when nickname, signerMode, and pubkeyHex are unchanged', () => {
    const cached: ShareCardCacheEntry = {
      key: { nickname: 'Alice', signerMode: 'local', pubkeyHex: 'pk-a' },
      shareUrl: 'x',
    };
    expect(
      shouldRebuildShareCard(cached, { nickname: 'Alice', signerMode: 'local', pubkeyHex: 'pk-a' }),
    ).toBe(false);
  });

  it('rebuilds when the nickname changes', () => {
    const cached: ShareCardCacheEntry = {
      key: { nickname: 'Alice', signerMode: 'local', pubkeyHex: 'pk-a' },
      shareUrl: 'x',
    };
    expect(
      shouldRebuildShareCard(cached, { nickname: 'Alicia', signerMode: 'local', pubkeyHex: 'pk-a' }),
    ).toBe(true);
  });

  it('rebuilds when the signer mode changes (e.g. local -> NIP-46 mid-session)', () => {
    const cached: ShareCardCacheEntry = {
      key: { nickname: 'Alice', signerMode: 'local', pubkeyHex: 'pk-a' },
      shareUrl: 'x',
    };
    expect(
      shouldRebuildShareCard(cached, { nickname: 'Alice', signerMode: 'nip46', pubkeyHex: 'pk-a' }),
    ).toBe(true);
  });

  // Regression test — review finding (severity 6, impl_bug): the cache key
  // previously omitted pubkeyHex entirely. Bug scenario: share as identity A
  // (empty nickname, local signer) -> restore identity B via
  // NostrIdentityContext's replaceIdentity (also empty nickname, local — the
  // common default; replaceIdentity swaps identity in place with NO page
  // reload, so shareCardCacheRef in settings.tsx survives the restore) ->
  // reopen Share -> without this check, (nickname, signerMode) is unchanged
  // so the cache would HIT and silently serve identity A's already-signed
  // card (A's pubkey, stale signature) for identity B. The pubkeyHex
  // comparison is what makes this a correct MISS.
  it('rebuilds when only pubkeyHex changes (mid-session identity restore, same nickname/signerMode)', () => {
    const cached: ShareCardCacheEntry = {
      key: { nickname: '', signerMode: 'local', pubkeyHex: 'pk-identity-a' },
      shareUrl: 'x',
    };
    expect(
      shouldRebuildShareCard(cached, { nickname: '', signerMode: 'local', pubkeyHex: 'pk-identity-b' }),
    ).toBe(true);
  });
});

describe('getOwnShareCard — cache-driven orchestration', () => {
  it('rebuilds on the first open, then reuses the cache on a repeat open with an unchanged nickname (sign called exactly once)', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);
    const signEventSpy = vi.fn(signer.signEvent);
    const getSignEvent = vi.fn(async () => signEventSpy);

    const first = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alice',
      signerMode: 'local',
      cache: null,
      getSignEvent,
    });
    expect(first.rebuilt).toBe(true);
    expect(signEventSpy).toHaveBeenCalledTimes(1);

    const second = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alice',
      signerMode: 'local',
      cache: first.cache,
      getSignEvent,
    });
    expect(second.rebuilt).toBe(false);
    expect(second.shareUrl).toBe(first.shareUrl);
    // The core "no remote NIP-46 round trip on every share-modal open" guard:
    // getSignEvent (and therefore the underlying signer) must not be
    // resolved again on a repeat open with an unchanged nickname/signerMode.
    expect(getSignEvent).toHaveBeenCalledTimes(1);
    expect(signEventSpy).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when the nickname changes between opens', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);
    const getSignEvent = vi.fn(async () => signer.signEvent);

    const first = await getOwnShareCard({ pubkeyHex, nickname: 'Alice', signerMode: 'local', cache: null, getSignEvent });
    const second = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alicia',
      signerMode: 'local',
      cache: first.cache,
      getSignEvent,
    });

    expect(second.rebuilt).toBe(true);
    expect(getSignEvent).toHaveBeenCalledTimes(2);
    expect(second.shareUrl).not.toBe(first.shareUrl);
  });

  it('rebuilds when the signer mode changes between opens even if the nickname is unchanged', async () => {
    const { sk, skHex, pubkeyHex } = makeIdentity();
    const localSigner = createPrivateKeySigner(skHex);
    const { fake: nip46Fake } = makeFakeNip46Signer(sk, pubkeyHex);
    const nip46Signer = createNip46EventSigner(nip46Fake);

    const first = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alice',
      signerMode: 'local',
      cache: null,
      getSignEvent: async () => localSigner.signEvent,
    });
    const second = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alice',
      signerMode: 'nip46',
      cache: first.cache,
      getSignEvent: async () => nip46Signer.signEvent,
    });

    expect(second.rebuilt).toBe(true);
    // Both are validly-signed cards for the same identity/nickname, so the
    // payload content is identical byte-for-byte modulo the signature —
    // what matters here is only that a rebuild actually happened.
    expect(second.cache.key.signerMode).toBe('nip46');
  });

  // Regression test — review finding (severity 6, impl_bug): reproduces the
  // full mid-session identity-restore bug end-to-end at the orchestration
  // level (not just the pure predicate). Same nickname ('Alice', non-empty
  // so encodeCard actually signs on both calls — see AC-CARD-6) and
  // signerMode ('local') across both calls, mirroring settings.tsx's
  // shareCardCacheRef surviving a replaceIdentity() restore (no page
  // reload) — only the identity's pubkeyHex differs, as it does when the
  // user restores a DIFFERENT identity that happens to share the same saved
  // nickname. Asserts both that the signer is re-invoked for the new
  // identity (no stale-signature reuse from identity A) and that the
  // produced card encodes identity B's pubkey, not identity A's.
  it('rebuilds and re-signs when only the identity (pubkeyHex) changes between opens, even with an unchanged nickname/signerMode', async () => {
    const identityA = makeIdentity();
    const identityB = makeIdentity();
    const signerA = createPrivateKeySigner(identityA.skHex);
    const signerB = createPrivateKeySigner(identityB.skHex);
    const signEventSpyA = vi.fn(signerA.signEvent);
    const signEventSpyB = vi.fn(signerB.signEvent);

    const first = await getOwnShareCard({
      pubkeyHex: identityA.pubkeyHex,
      nickname: 'Alice',
      signerMode: 'local',
      cache: null,
      getSignEvent: async () => signEventSpyA,
    });
    expect(first.rebuilt).toBe(true);
    expect(signEventSpyA).toHaveBeenCalledTimes(1);

    const second = await getOwnShareCard({
      pubkeyHex: identityB.pubkeyHex,
      nickname: 'Alice',
      signerMode: 'local',
      cache: first.cache,
      getSignEvent: async () => signEventSpyB,
    });

    expect(second.rebuilt).toBe(true);
    // The old identity's signer must NOT be reused, and the new identity's
    // signer must actually be invoked — the bug this guards against is a
    // cache HIT that skips signing entirely and reuses identity A's stale
    // signed card.
    expect(signEventSpyA).toHaveBeenCalledTimes(1);
    expect(signEventSpyB).toHaveBeenCalledTimes(1);
    expect(second.shareUrl).not.toBe(first.shareUrl);
    expect(second.cache.key.pubkeyHex).toBe(identityB.pubkeyHex);

    const parsedFirst = parseContactCard(first.shareUrl);
    const parsedSecond = parseContactCard(second.shareUrl);
    if ('error' in parsedFirst || 'error' in parsedSecond) throw new Error('unreachable');
    expect(parsedFirst.pubkeyHex).toBe(identityA.pubkeyHex);
    expect(parsedSecond.pubkeyHex).toBe(identityB.pubkeyHex);
    expect(parsedSecond.pubkeyHex).not.toBe(parsedFirst.pubkeyHex);
  });
});
