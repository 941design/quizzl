/**
 * Unit tests for shareCard.ts — Story S6, "Share contact card"; extended by
 * epic: contact-pairing-code, story S2 (RD-2 active-nonce lifecycle wiring).
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
 *     pubkey-only parse result (buildOwnShareCard, the v1 path — untouched
 *     by S2 and kept as-is).
 *   - VQ-S6-001 / VQ-S6-006: the cache rebuilds on the first open and on a
 *     nickname or signer-mode change, but NOT on a repeat open with an
 *     unchanged key — asserted by counting signer invocations.
 *   - AC-NONCE-1/2/3/7 (story S2): getOwnShareCard now always produces a v2
 *     pairing card, and its active-nonce dimension is exercised BOTH via an
 *     injected `getActiveNonce` stub (deterministic, most tests below) AND,
 *     in the dedicated "real nonce-store wiring" describe block, via the
 *     REAL default `nonceStore.getOrMintActiveNonce` (fake-indexeddb — see
 *     profileRequestStorage.integration.test.ts for the pattern) so the
 *     actual production wiring is proven, not just the pure comparator.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  buildOwnShareCardV2,
  getOwnShareCard,
  hasShareableName,
  type ShareCardCacheEntry,
} from '@/src/lib/shareCard';
import {
  getStoredNonce,
  clearAllNonces,
  _resetActiveNonceForTests,
  NONCE_TTL_SEC,
} from '@/src/lib/pairing/nonceStore';

const FIXED_CREATED_AT = 1735689600; // 2025-01-01T00:00:00Z
const FIXED_NONCE_A = 'a'.repeat(32);
const FIXED_NONCE_B = 'b'.repeat(32);

/** Deterministic getActiveNonce stub for tests that don't care about nonce rotation itself. */
function fixedNonceProvider(nonce = FIXED_NONCE_A, expiresAt = FIXED_CREATED_AT + NONCE_TTL_SEC) {
  return vi.fn(async () => ({ nonce, expiresAt }));
}

// getOwnShareCard tests default to a nonce-store-independent stub above; the
// dedicated "real nonce-store wiring" describe block below still needs a
// clean nonceStore between cases (both in-memory pointer and persisted
// store), mirroring profileRequestStorage.integration.test.ts's beforeEach.
beforeEach(async () => {
  await clearAllNonces();
  _resetActiveNonceForTests();
});

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

  // buildOwnShareCard is the low-level production PRIMITIVE and keeps its
  // codec-level graceful degradation (AC-CARD-6): an empty nickname yields an
  // unsigned pubkey-only card. The product rule "sharing requires a name" is
  // enforced one layer up, at getOwnShareCard / the Profile UI — see the
  // `hasShareableName` and getOwnShareCard-guard tests below.
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

// ── Sharing requires a name — the product rule the Share action enforces ────

describe('hasShareableName', () => {
  it('is false for an empty string', () => {
    expect(hasShareableName('')).toBe(false);
  });

  it('is false for a whitespace-only nickname (a name of only spaces is not "set")', () => {
    expect(hasShareableName('   ')).toBe(false);
    expect(hasShareableName('\t\n ')).toBe(false);
  });

  it('is true for a non-empty name', () => {
    expect(hasShareableName('Alice')).toBe(true);
  });

  it('is true for a name with surrounding whitespace but non-empty content', () => {
    expect(hasShareableName('  Alice  ')).toBe(true);
  });
});

// ── VQ-S6-001 / VQ-S6-006 — cache staleness ─────────────────────────────────

describe('shouldRebuildShareCard', () => {
  it('rebuilds when there is no cache yet', () => {
    expect(
      shouldRebuildShareCard(null, {
        nickname: 'Alice',
        signerMode: 'local',
        pubkeyHex: 'pk-a',
        nonceHex: FIXED_NONCE_A,
      }),
    ).toBe(true);
  });

  it('does NOT rebuild when nickname, signerMode, pubkeyHex, AND nonceHex are all unchanged', () => {
    const cached: ShareCardCacheEntry = {
      key: { nickname: 'Alice', signerMode: 'local', pubkeyHex: 'pk-a', nonceHex: FIXED_NONCE_A },
      shareUrl: 'x',
    };
    expect(
      shouldRebuildShareCard(cached, {
        nickname: 'Alice',
        signerMode: 'local',
        pubkeyHex: 'pk-a',
        nonceHex: FIXED_NONCE_A,
      }),
    ).toBe(false);
  });

  it('rebuilds when the nickname changes', () => {
    const cached: ShareCardCacheEntry = {
      key: { nickname: 'Alice', signerMode: 'local', pubkeyHex: 'pk-a', nonceHex: FIXED_NONCE_A },
      shareUrl: 'x',
    };
    expect(
      shouldRebuildShareCard(cached, {
        nickname: 'Alicia',
        signerMode: 'local',
        pubkeyHex: 'pk-a',
        nonceHex: FIXED_NONCE_A,
      }),
    ).toBe(true);
  });

  it('rebuilds when the signer mode changes (e.g. local -> NIP-46 mid-session)', () => {
    const cached: ShareCardCacheEntry = {
      key: { nickname: 'Alice', signerMode: 'local', pubkeyHex: 'pk-a', nonceHex: FIXED_NONCE_A },
      shareUrl: 'x',
    };
    expect(
      shouldRebuildShareCard(cached, {
        nickname: 'Alice',
        signerMode: 'nip46',
        pubkeyHex: 'pk-a',
        nonceHex: FIXED_NONCE_A,
      }),
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
      key: { nickname: '', signerMode: 'local', pubkeyHex: 'pk-identity-a', nonceHex: FIXED_NONCE_A },
      shareUrl: 'x',
    };
    expect(
      shouldRebuildShareCard(cached, {
        nickname: '',
        signerMode: 'local',
        pubkeyHex: 'pk-identity-b',
        nonceHex: FIXED_NONCE_A,
      }),
    ).toBe(true);
  });

  // AC-NONCE-7: a nonce rotation (reload after prior expiry, or mid-session
  // expiry) with nickname/signerMode/pubkeyHex unchanged must still force a
  // rebuild — otherwise the QR-producing card would keep serving a
  // no-longer-active nonce indefinitely.
  it('rebuilds when only nonceHex changes (nickname/signerMode/pubkeyHex unchanged)', () => {
    const cached: ShareCardCacheEntry = {
      key: { nickname: 'Alice', signerMode: 'local', pubkeyHex: 'pk-a', nonceHex: FIXED_NONCE_A },
      shareUrl: 'x',
    };
    expect(
      shouldRebuildShareCard(cached, {
        nickname: 'Alice',
        signerMode: 'local',
        pubkeyHex: 'pk-a',
        nonceHex: FIXED_NONCE_B,
      }),
    ).toBe(true);
  });

  // Inverse of the above — proves the new dimension isn't an "always rebuild"
  // change: when ALL FOUR dimensions (including nonceHex) are unchanged,
  // there is still no rebuild.
  it('does NOT rebuild when all four dimensions, including nonceHex, are unchanged (inverse of the rotation test)', () => {
    const cached: ShareCardCacheEntry = {
      key: { nickname: 'Bob', signerMode: 'nip07', pubkeyHex: 'pk-b', nonceHex: FIXED_NONCE_B },
      shareUrl: 'x',
    };
    expect(
      shouldRebuildShareCard(cached, {
        nickname: 'Bob',
        signerMode: 'nip07',
        pubkeyHex: 'pk-b',
        nonceHex: FIXED_NONCE_B,
      }),
    ).toBe(false);
  });
});

describe('getOwnShareCard — cache-driven orchestration', () => {
  it('refuses to share with an empty nickname, without touching the signer', async () => {
    const { pubkeyHex } = makeIdentity();
    const getSignEvent = vi.fn(async () => {
      throw new Error('signer must not be resolved when there is no name');
    });

    await expect(
      getOwnShareCard({ pubkeyHex, nickname: '', signerMode: 'local', cache: null, getSignEvent }),
    ).rejects.toThrow(/without a name/);
    // The guard runs before any (possibly remote) signer round trip.
    expect(getSignEvent).not.toHaveBeenCalled();
  });

  it('refuses to share with a whitespace-only nickname', async () => {
    const { pubkeyHex } = makeIdentity();
    const getSignEvent = vi.fn(async () => {
      throw new Error('signer must not be resolved when the name is blank');
    });

    await expect(
      getOwnShareCard({ pubkeyHex, nickname: '   ', signerMode: 'local', cache: null, getSignEvent }),
    ).rejects.toThrow(/without a name/);
    expect(getSignEvent).not.toHaveBeenCalled();
  });

  it('rebuilds on the first open, then reuses the cache on a repeat open with an unchanged nickname (sign called exactly once)', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);
    const signEventSpy = vi.fn(signer.signEvent);
    const getSignEvent = vi.fn(async () => signEventSpy);
    const getActiveNonce = fixedNonceProvider();

    const first = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alice',
      signerMode: 'local',
      cache: null,
      getSignEvent,
      getActiveNonce,
    });
    expect(first.rebuilt).toBe(true);
    expect(signEventSpy).toHaveBeenCalledTimes(1);

    const second = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alice',
      signerMode: 'local',
      cache: first.cache,
      getSignEvent,
      getActiveNonce,
    });
    expect(second.rebuilt).toBe(false);
    expect(second.shareUrl).toBe(first.shareUrl);
    // The core "no remote NIP-46 round trip on every share-modal open" guard:
    // getSignEvent (and therefore the underlying signer) must not be
    // resolved again on a repeat open with an unchanged nickname/signerMode.
    expect(getSignEvent).toHaveBeenCalledTimes(1);
    expect(signEventSpy).toHaveBeenCalledTimes(1);
    // getActiveNonce IS still resolved on the cache-hit path (the cache-key
    // comparison needs to know the current nonce either way), but it never
    // triggers a rebuild by itself since the nonce is unchanged.
    expect(getActiveNonce).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when the nickname changes between opens', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);
    const getSignEvent = vi.fn(async () => signer.signEvent);
    const getActiveNonce = fixedNonceProvider();

    const first = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alice',
      signerMode: 'local',
      cache: null,
      getSignEvent,
      getActiveNonce,
    });
    const second = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alicia',
      signerMode: 'local',
      cache: first.cache,
      getSignEvent,
      getActiveNonce,
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
    const getActiveNonce = fixedNonceProvider();

    const first = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alice',
      signerMode: 'local',
      cache: null,
      getSignEvent: async () => localSigner.signEvent,
      getActiveNonce,
    });
    const second = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Alice',
      signerMode: 'nip46',
      cache: first.cache,
      getSignEvent: async () => nip46Signer.signEvent,
      getActiveNonce,
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

// ── buildOwnShareCardV2 — v2 pairing-card production (story S2) ────────────

describe('buildOwnShareCardV2 — produces a v2 pairing card carrying nonce + expiry', () => {
  it('round-trips pubkeyHex/name/nonce/expiresAt through parseContactCard, carrying a `pairing` field', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);
    const nonceHex = FIXED_NONCE_A;
    const expiresAt = FIXED_CREATED_AT + NONCE_TTL_SEC;

    const { shareUrl } = await buildOwnShareCardV2(
      pubkeyHex,
      { nickname: 'Dave', createdAt: FIXED_CREATED_AT },
      nonceHex,
      expiresAt,
      signer.signEvent,
    );

    const parsed = parseContactCard(shareUrl);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) throw new Error('unreachable');
    expect(parsed.pubkeyHex).toBe(pubkeyHex);
    expect('profile' in parsed).toBe(true);
    if ('profile' in parsed) expect(parsed.profile.nickname).toBe('Dave');
    expect('pairing' in parsed).toBe(true);
    if ('pairing' in parsed) {
      expect(parsed.pairing.nonce).toBe(nonceHex);
      expect(parsed.pairing.expiresAt).toBe(expiresAt);
    }
  });
});

// ── AC-NONCE-1/2/3/7 — real nonce-store wiring through getOwnShareCard ─────
//
// Unlike the orchestration tests above (which inject a deterministic
// getActiveNonce stub to isolate the nickname/signerMode/pubkeyHex
// dimensions), these tests deliberately do NOT override getActiveNonce —
// they exercise the REAL default (`nonceStore.getOrMintActiveNonce`,
// fake-indexeddb-backed) so the actual production wiring between
// shareCard.ts and nonceStore.ts is proven, not just the pure comparator.

describe('getOwnShareCard — real nonce-store wiring (no getActiveNonce override)', () => {
  it('AC-NONCE-1: repeated calls within the same session return a card carrying the SAME nonce (no rotation on repeat display)', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);
    const now = () => FIXED_CREATED_AT;

    const first = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Erin',
      signerMode: 'local',
      cache: null,
      getSignEvent: async () => signer.signEvent,
      now,
    });
    expect(first.rebuilt).toBe(true);
    const nonceAfterFirst = first.cache.key.nonceHex;

    // A second call within the same session (no _resetActiveNonceForTests,
    // no reload) with the cache already populated must reuse the cache
    // entirely — same nonce, no re-sign.
    const second = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Erin',
      signerMode: 'local',
      cache: first.cache,
      getSignEvent: async () => {
        throw new Error('signer must not be re-resolved on a cache hit');
      },
      now,
    });
    expect(second.rebuilt).toBe(false);
    expect(second.cache.key.nonceHex).toBe(nonceAfterFirst);

    const parsedFirst = parseContactCard(first.shareUrl);
    if ('error' in parsedFirst || !('pairing' in parsedFirst)) throw new Error('unreachable');
    expect(parsedFirst.pairing.nonce).toBe(nonceAfterFirst);
  });

  it('AC-NONCE-2: a simulated page reload mints a fresh nonce; the previous card (built with the old nonce) is not reused, and the old nonce is still admissible', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);

    const beforeReload = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Frank',
      signerMode: 'local',
      cache: null,
      getSignEvent: async () => signer.signEvent,
      now: () => FIXED_CREATED_AT,
    });
    const oldNonce = beforeReload.cache.key.nonceHex;

    // Simulate reload: in-memory pointer resets, persisted store survives.
    _resetActiveNonceForTests();

    const afterReload = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Frank',
      signerMode: 'local',
      // A real reload also loses the in-memory shareCardCacheRef (it lives
      // in a React ref in profile.tsx) — starting from null models that.
      cache: null,
      getSignEvent: async () => signer.signEvent,
      now: () => FIXED_CREATED_AT + 60,
    });

    expect(afterReload.cache.key.nonceHex).not.toBe(oldNonce);
    expect(afterReload.shareUrl).not.toBe(beforeReload.shareUrl);

    // The old nonce is read from REAL persisted storage and remains
    // admissible (well within its own grace window).
    const oldStored = await getStoredNonce(oldNonce);
    expect(oldStored).not.toBeUndefined();
  });

  it('AC-NONCE-3: the active nonce expiring mid-session (no reload) causes the next getOwnShareCard call to mint a fresh nonce and rebuild', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);

    const first = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Grace',
      signerMode: 'local',
      cache: null,
      getSignEvent: async () => signer.signEvent,
      now: () => FIXED_CREATED_AT,
    });
    const firstNonce = first.cache.key.nonceHex;

    // No reset — same "session" — but the clock advances past the nonce's
    // 30-minute expiry (NONCE_TTL_SEC), with the caller still holding the
    // previous cache entry (mirrors a share-modal reopened much later).
    const second = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Grace',
      signerMode: 'local',
      cache: first.cache,
      getSignEvent: async () => signer.signEvent,
      now: () => FIXED_CREATED_AT + NONCE_TTL_SEC + 1,
    });

    expect(second.rebuilt).toBe(true);
    expect(second.cache.key.nonceHex).not.toBe(firstNonce);
  });

  it('AC-NONCE-7: a nonce rotation (session expiry) with nickname/signerMode/pubkeyHex unchanged still rebuilds the QR-producing card', async () => {
    const { skHex, pubkeyHex } = makeIdentity();
    const signer = createPrivateKeySigner(skHex);
    const signEventSpy = vi.fn(signer.signEvent);

    const first = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Heidi',
      signerMode: 'local',
      cache: null,
      getSignEvent: async () => signEventSpy,
      now: () => FIXED_CREATED_AT,
    });
    expect(signEventSpy).toHaveBeenCalledTimes(1);

    const second = await getOwnShareCard({
      pubkeyHex,
      nickname: 'Heidi', // unchanged
      signerMode: 'local', // unchanged
      cache: first.cache,
      getSignEvent: async () => signEventSpy,
      now: () => FIXED_CREATED_AT + NONCE_TTL_SEC + 1, // past the active nonce's expiry
    });

    expect(second.rebuilt).toBe(true);
    expect(signEventSpy).toHaveBeenCalledTimes(2);
    expect(second.cache.key.nonceHex).not.toBe(first.cache.key.nonceHex);
    expect(second.shareUrl).not.toBe(first.shareUrl);
  });
});
