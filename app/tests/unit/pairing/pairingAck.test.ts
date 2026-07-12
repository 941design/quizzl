/**
 * Unit/integration tests for pairingAck.ts (epic: contact-pairing-code,
 * story S3). SECURITY-CRITICAL — covers AC-ACK-1..3, AC-ADMIT-1..5,
 * AC-SEC-1..4, AC-PRIV-1.
 *
 * Conventions mirrored from precedent in this repo:
 *   - crypto.subtle polyfill + real nostr-tools crypto (sealAndWrap.test.ts,
 *     dmReactions.test.ts) — no mocking of gift-wrap crypto primitives.
 *   - fake-indexeddb/auto for the real nonceStore.ts (nonceStore.integration.test.ts).
 *   - `vi.spyOn(NDKEvent.prototype, 'publish')` for the outbound relay call
 *     (dmReactions.test.ts).
 *   - `vi.mock` factories with shared, inspectable JS state for knownPeers.ts /
 *     contacts.ts (welcomeSubscription.test.ts's mockEnqueuePendingInvitation
 *     pattern) — this lets tests assert exact call ORDER (AC-ADMIT-1) without
 *     depending on jsdom/localStorage plumbing. walledGarden.ts's
 *     `isAllowedDmSender` is exercised for REAL (not mocked) against the
 *     tracked knownPeers state for AC-ADMIT-5 (VQ-S3-016).
 */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { encodeCard, decodeCard } from '@/src/lib/contactCard';
import { isAllowedDmSender } from '@/src/lib/walledGarden';
import {
  getOrMintActiveNonce,
  clearAllNonces,
  _resetActiveNonceForTests,
  getStoredNonce,
  NONCE_GRACE_SEC,
} from '@/src/lib/pairing/nonceStore';

// ── Tracked mocks for knownPeers.ts / contacts.ts ───────────────────────────
// Shared, inspectable JS state standing in for the real (localStorage-backed)
// stores — lets tests assert exact call order (AC-ADMIT-1) and exact
// dedup/idempotency behavior (AC-ACK-3) without jsdom.

const { knownPeersState, rememberKnownPeersCalls, rememberContactCalls, callOrder } = vi.hoisted(() => ({
  knownPeersState: new Set<string>(),
  rememberKnownPeersCalls: [] as string[][],
  rememberContactCalls: [] as string[],
  callOrder: [] as Array<'knownPeers' | 'contact'>,
}));

vi.mock('@/src/lib/knownPeers', () => ({
  rememberKnownPeers: (hexes: string[]) => {
    rememberKnownPeersCalls.push(hexes);
    callOrder.push('knownPeers');
    for (const h of hexes) knownPeersState.add(h.toLowerCase());
  },
}));

vi.mock('@/src/lib/contacts', () => ({
  rememberContact: (hex: string) => {
    rememberContactCalls.push(hex);
    callOrder.push('contact');
  },
}));

import * as directMessagesModule from '@/src/lib/directMessages';
const { sealAndWrap, unwrapAndOpen, CHAT_MESSAGE_KIND } = directMessagesModule;

import { NDKEvent } from '@nostr-dev-kit/ndk';

import {
  PAIRING_ACK_KIND,
  sendPairingAck,
  handlePairingAck,
  getPairingAckAdmissions,
  _resetPairingAckAdmissionsForTests,
  type PairingAckContent,
} from '@/src/lib/pairing/pairingAck';

// ── Key helpers ──────────────────────────────────────────────────────────

function makeIdentity() {
  const priv = generateSecretKey();
  const privHex = bytesToHex(priv);
  const pubHex = getPublicKey(priv);
  return { priv, privHex, pubHex, signer: createPrivateKeySigner(privHex) };
}

const T0 = 1_700_000_000; // unix seconds, matches nonceStore.integration.test.ts's anchor

/** Build a genuine identity-only card (no pairing field) for `identity`. */
async function buildIdentityCard(identity: ReturnType<typeof makeIdentity>, nickname: string): Promise<string> {
  return encodeCard(identity.pubHex, { nickname, createdAt: T0 }, identity.signer.signEvent);
}

/**
 * Build a genuine gift-wrapped rumor of the given kind/content, sealed with
 * `senderIdentity`'s real private key and addressed to `recipientPubHex` —
 * i.e. an authentic NIP-59 envelope indistinguishable (at the transport
 * layer) from a real client's output. Uses the real `sealAndWrap`.
 */
async function buildGiftWrap(params: {
  senderIdentity: ReturnType<typeof makeIdentity>;
  recipientPubHex: string;
  kind: number;
  content: string;
}) {
  return sealAndWrap(
    {
      kind: params.kind,
      content: params.content,
      tags: [['p', params.recipientPubHex]],
      pubkey: params.senderIdentity.pubHex,
      created_at: T0,
      id: 'a'.repeat(64), // placeholder — sealAndWrap/wrapEvent re-derives id+pubkey from the private key
    },
    params.recipientPubHex,
    params.senderIdentity.privHex,
  );
}

function ackContent(nonce: string, card: string): string {
  return JSON.stringify({ type: 'pairing-ack', nonce, card } satisfies PairingAckContent);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  knownPeersState.clear();
  rememberKnownPeersCalls.length = 0;
  rememberContactCalls.length = 0;
  callOrder.length = 0;
  await clearAllNonces();
  _resetActiveNonceForTests();
  _resetPairingAckAdmissionsForTests();
});

// ── AC-SEC-3 — kind sentinel isolation ──────────────────────────────────

describe('PAIRING_ACK_KIND (AC-SEC-3)', () => {
  it('does not collide with any reserved sentinel kind', () => {
    expect(PAIRING_ACK_KIND).toBe(21060);
    for (const sentinel of [444, 21059, 5, 7, 14]) {
      expect(PAIRING_ACK_KIND).not.toBe(sentinel);
    }
  });
});

// ── AC-ACK-1 — sendPairingAck rumor shape ───────────────────────────────

describe('sendPairingAck (AC-ACK-1, AC-PRIV-1)', () => {
  it('sends exactly one gift-wrapped kind=PAIRING_ACK_KIND rumor addressed to the issuer, whose decoded card is identity-only and pubkey-matches the sender', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const echoedNonceHex = 'ab'.repeat(16);

    let published: NDKEvent | undefined;
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
      published = this;
      return new Set() as never;
    });

    const result = await sendPairingAck({
      ndk: {} as never,
      issuerPubkeyHex: issuer.pubHex,
      echoedNonceHex,
      ownPubkeyHex: scanner.pubHex,
      ownPrivateKeyHex: scanner.privHex,
      ownProfile: { nickname: 'Bob', createdAt: T0 },
      signEvent: scanner.signer.signEvent,
    });

    expect(result).toEqual({
      issuerPubkeyHex: issuer.pubHex,
      echoedNonceHex,
      result: 'sent',
    });
    expect(NDKEvent.prototype.publish).toHaveBeenCalledTimes(1);
    expect(published).toBeDefined();

    // AC-PRIV-1: the ONLY published event is the kind-1059 gift wrap — never a kind-0.
    const rawWrap = (published as unknown as { rawEvent: () => { kind: number; pubkey: string; tags: string[][] } }).rawEvent();
    expect(rawWrap.kind).toBe(1059);
    expect(rawWrap.kind).not.toBe(0);
    const pTag = rawWrap.tags.find((t) => t[0] === 'p');
    expect(pTag?.[1]).toBe(issuer.pubHex);

    // Decode the wrap the way the issuer would, through the REAL codec — the
    // built card is never hand-constructed independently (VQ-S3-009).
    const recoveredRumor = await unwrapAndOpen(rawWrap as never, issuer.privHex);
    expect(recoveredRumor.kind).toBe(PAIRING_ACK_KIND);
    expect(recoveredRumor.pubkey).toBe(scanner.pubHex);

    const content = JSON.parse(recoveredRumor.content) as PairingAckContent;
    expect(content.type).toBe('pairing-ack');
    expect(content.nonce).toBe(echoedNonceHex);

    const decoded = decodeCard(content.card);
    if ('error' in decoded) throw new Error(`card failed to decode: ${decoded.error}`);
    expect(decoded.pubkeyHex).toBe(scanner.pubHex);
    expect(decoded.pairing).toBeUndefined(); // identity-only — no nonce field
    expect(decoded.profile?.nickname).toBe('Bob');
  });

  it('returns "queued-for-retry" (never throws) when the relay publish fails — e.g. offline (AC-SCAN-3 mechanics)', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    vi.spyOn(NDKEvent.prototype, 'publish').mockRejectedValue(new Error('offline'));

    const result = await sendPairingAck({
      ndk: {} as never,
      issuerPubkeyHex: issuer.pubHex,
      echoedNonceHex: 'cd'.repeat(16),
      ownPubkeyHex: scanner.pubHex,
      ownPrivateKeyHex: scanner.privHex,
      ownProfile: { nickname: 'Bob', createdAt: T0 },
      signEvent: scanner.signer.signEvent,
    });

    expect(result.result).toBe('queued-for-retry');
  });

  it('the result.result field is exhaustively "sent" | "queued-for-retry" — no third silent value', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    vi.spyOn(NDKEvent.prototype, 'publish').mockResolvedValue(new Set() as never);

    const result = await sendPairingAck({
      ndk: {} as never,
      issuerPubkeyHex: issuer.pubHex,
      echoedNonceHex: 'ef'.repeat(16),
      ownPubkeyHex: scanner.pubHex,
      ownPrivateKeyHex: scanner.privHex,
      ownProfile: { nickname: 'Bob', createdAt: T0 },
      signEvent: scanner.signer.signEvent,
    });

    expect(['sent', 'queued-for-retry']).toContain(result.result);
  });

  it('throws (does not return "queued-for-retry") on a malformed issuerPubkeyHex — a caller bug, not a transient condition', async () => {
    const scanner = makeIdentity();
    await expect(
      sendPairingAck({
        ndk: {} as never,
        issuerPubkeyHex: 'not-hex',
        echoedNonceHex: 'ab'.repeat(16),
        ownPubkeyHex: scanner.pubHex,
        ownPrivateKeyHex: scanner.privHex,
        ownProfile: { nickname: 'Bob', createdAt: T0 },
        signEvent: scanner.signer.signEvent,
      }),
    ).rejects.toThrow();
  });

  // Mutation-gap closure (Step 5.7): the hex guards are ANCHORED (/^…$/). A
  // 64-hex prefix followed by a trailing character must still be rejected —
  // this kills the "regex anchor removal" mutant that an over-length input
  // would otherwise slip past.
  it('throws on an over-length issuerPubkeyHex (valid 64-hex prefix + trailing char) — anchor is load-bearing', async () => {
    const scanner = makeIdentity();
    await expect(
      sendPairingAck({
        ndk: {} as never,
        issuerPubkeyHex: 'a'.repeat(64) + '0', // 65 chars: valid hex prefix, over length
        echoedNonceHex: 'ab'.repeat(16),
        ownPubkeyHex: scanner.pubHex,
        ownPrivateKeyHex: scanner.privHex,
        ownProfile: { nickname: 'Bob', createdAt: T0 },
        signEvent: scanner.signer.signEvent,
      }),
    ).rejects.toThrow();
  });

  it('throws on an over-length echoedNonceHex (valid 32-hex prefix + trailing char) — anchor is load-bearing', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    await expect(
      sendPairingAck({
        ndk: {} as never,
        issuerPubkeyHex: issuer.pubHex,
        echoedNonceHex: 'ab'.repeat(16) + '0', // 33 chars: valid hex prefix, over length
        ownPubkeyHex: scanner.pubHex,
        ownPrivateKeyHex: scanner.privHex,
        ownProfile: { nickname: 'Bob', createdAt: T0 },
        signEvent: scanner.signer.signEvent,
      }),
    ).rejects.toThrow();
  });
});

// ── AC-ADMIT-1/2/3 + AC-SEC-1/2 — handlePairingAck core ─────────────────

describe('handlePairingAck', () => {
  it('AC-ADMIT-1/AC-ADMIT-2: admissible nonce + valid card → admits, calling rememberKnownPeers strictly BEFORE rememberContact (ADR-005)', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);
    const card = await buildIdentityCard(scanner, 'Bob');
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, card),
    });

    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 + 60 });

    expect(result).toEqual({ status: 'admitted', senderPubkeyHex: scanner.pubHex });
    expect(rememberKnownPeersCalls).toEqual([[scanner.pubHex]]);
    expect(rememberContactCalls).toEqual([scanner.pubHex]);
    // ADR-005: rememberKnownPeers must appear BEFORE rememberContact in the recorded order.
    expect(callOrder).toEqual(['knownPeers', 'contact']);
  });

  it('AC-ADMIT-2: unknown nonce → no admission, no error thrown, real isNonceAdmissible consulted', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const card = await buildIdentityCard(scanner, 'Bob');
    const neverIssuedNonce = 'ff'.repeat(16);
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(neverIssuedNonce, card),
    });

    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 });
    expect(result).toEqual({ status: 'nonce-inadmissible' });
    expect(rememberKnownPeersCalls).toEqual([]);
    expect(rememberContactCalls).toEqual([]);
  });

  it('AC-ADMIT-2: nonce past its grace window → no admission, no error thrown, real isNonceAdmissible consulted', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);
    const card = await buildIdentityCard(scanner, 'Bob');
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, card),
    });

    const pastGrace = minted.expiresAt + NONCE_GRACE_SEC + 1;
    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: pastGrace });

    expect(result).toEqual({ status: 'nonce-inadmissible' });
    expect(rememberKnownPeersCalls).toEqual([]);
    expect(rememberContactCalls).toEqual([]);
  });

  it('AC-ADMIT-3: two distinct senders echoing the SAME still-admissible nonce are BOTH independently admitted; the nonce is not consumed by the first admission', async () => {
    const issuer = makeIdentity();
    const bob = makeIdentity();
    const carol = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);

    const bobCard = await buildIdentityCard(bob, 'Bob');
    const bobWrap = await buildGiftWrap({
      senderIdentity: bob,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, bobCard),
    });
    const bobResult = await handlePairingAck(bobWrap as never, issuer.privHex, { nowSec: T0 + 10 });
    expect(bobResult).toEqual({ status: 'admitted', senderPubkeyHex: bob.pubHex });

    // The nonce must still be admissible for a second, distinct sender.
    const carolCard = await buildIdentityCard(carol, 'Carol');
    const carolWrap = await buildGiftWrap({
      senderIdentity: carol,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, carolCard),
    });
    const carolResult = await handlePairingAck(carolWrap as never, issuer.privHex, { nowSec: T0 + 20 });
    expect(carolResult).toEqual({ status: 'admitted', senderPubkeyHex: carol.pubHex });

    expect(knownPeersState.has(bob.pubHex)).toBe(true);
    expect(knownPeersState.has(carol.pubHex)).toBe(true);
    expect(rememberContactCalls).toEqual([bob.pubHex, carol.pubHex]);
  });

  it('AC-ACK-3: a second ack from an already-admitted sender is idempotent — no duplicate remember calls, digest count unchanged', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);
    const card = await buildIdentityCard(scanner, 'Bob');
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, card),
    });

    const first = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 + 5 });
    expect(first).toEqual({ status: 'admitted', senderPubkeyHex: scanner.pubHex });
    expect(getPairingAckAdmissions().size).toBe(1);

    // Replay — possibly redelivered by a relay, or a genuine second scan.
    const second = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 + 6 });
    expect(second).toEqual({ status: 'already-admitted', senderPubkeyHex: scanner.pubHex });

    // No duplicate side effects, and the digest source (the SAME map backing
    // the idempotency check, VQ-S3-011) did not grow.
    expect(rememberKnownPeersCalls).toHaveLength(1);
    expect(rememberContactCalls).toHaveLength(1);
    expect(getPairingAckAdmissions().size).toBe(1);
  });

  it('AC-ACK-2: handlePairingAck never constructs or sends a further ack — sealAndWrap is never called as a side effect', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);
    const card = await buildIdentityCard(scanner, 'Bob');
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, card),
    });

    const sealAndWrapSpy = vi.spyOn(directMessagesModule, 'sealAndWrap');
    sealAndWrapSpy.mockClear();

    await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 + 5 });

    expect(sealAndWrapSpy).not.toHaveBeenCalled();
  });

  it('a rumor of a different kind (e.g. CHAT_MESSAGE_KIND) → "wrong-kind", no admission, falls through for the caller to handle', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: CHAT_MESSAGE_KIND,
      content: JSON.stringify({ type: 'text', text: 'hello' }),
    });

    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 });
    expect(result).toEqual({ status: 'wrong-kind' });
    expect(rememberKnownPeersCalls).toEqual([]);
  });

  it('a gift wrap addressed to a different recipient → "unwrap-failed", falls through, never throws', async () => {
    const issuer = makeIdentity();
    const wrongRecipient = makeIdentity();
    const scanner = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);
    const card = await buildIdentityCard(scanner, 'Bob');
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: wrongRecipient.pubHex, // NOT the issuer
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, card),
    });

    await expect(handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 })).resolves.toEqual({
      status: 'unwrap-failed',
    });
    expect(rememberKnownPeersCalls).toEqual([]);
  });

  it('malformed content (not the PairingAckContent shape) → "malformed-content", no admission', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: 'not json at all',
    });

    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 });
    expect(result).toEqual({ status: 'malformed-content' });
    expect(rememberKnownPeersCalls).toEqual([]);
  });

  it('AC-NONCE-6: processing an ack (any outcome) sweeps a DIFFERENT, unrelated nonce that is already past its grace window (the ack-processing-pass prune trigger)', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();

    // A long-dead, unrelated nonce minted far in the past — already past grace.
    _resetActiveNonceForTests();
    const staleNonce = await getOrMintActiveNonce(T0 - 100_000);
    expect(await getStoredNonce(staleNonce.nonce)).toBeDefined();

    // Mint the CURRENT active nonce fresh (simulating a reload) and use it
    // for a genuine, unrelated ack — the prune sweep is a side effect of
    // processing this ack, not of the stale nonce itself.
    _resetActiveNonceForTests();
    const minted = await getOrMintActiveNonce(T0);
    const card = await buildIdentityCard(scanner, 'Bob');
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, card),
    });

    // T0 is already well past staleNonce.expiresAt + NONCE_GRACE_SEC (the
    // stale nonce was minted 100,000s in the past) — and still comfortably
    // within the freshly-minted nonce's own admissible window, so the ack
    // itself succeeds normally too.
    expect(T0).toBeGreaterThan(staleNonce.expiresAt + NONCE_GRACE_SEC);
    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 + 5 });
    expect(result.status).toBe('admitted');

    expect(await getStoredNonce(staleNonce.nonce)).toBeUndefined();
  });

  it('an invalid/tampered enclosed card → "card-invalid", no admission', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);
    const goodCard = await buildIdentityCard(scanner, 'Bob');
    const tamperedCard = goodCard.slice(0, -4) + 'AAAA'; // corrupt the trailing signature bytes
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, tamperedCard),
    });

    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 });
    expect(result).toEqual({ status: 'card-invalid' });
    expect(rememberKnownPeersCalls).toEqual([]);
  });
});

// ── AC-SEC-1/AC-SEC-2 — sender binding (the security-critical negative case) ──

describe('handlePairingAck — sender binding (AC-SEC-1, AC-SEC-2)', () => {
  it('a gift wrap whose enclosed card names pubkey X but is authenticated as sender Y admits NEITHER X nor Y', async () => {
    const issuer = makeIdentity();
    const victim = makeIdentity(); // "X" — a real person whose card got harvested
    const attacker = makeIdentity(); // "Y" — genuinely, independently generated; wraps under their OWN gift-wrap identity
    const minted = await getOrMintActiveNonce(T0);

    // The attacker has somehow obtained (e.g. copied/harvested) the victim's
    // signed identity card — but can only gift-wrap it under their OWN key,
    // because sealAndWrap requires the victim's private key to forge a
    // wrap that would authenticate as the victim, which the attacker does
    // not possess. This is exactly the attack unwrapAndOpen's step 4 closes.
    const victimCard = await buildIdentityCard(victim, 'Victim');
    const forgedWrap = await buildGiftWrap({
      senderIdentity: attacker, // gift-wrap sender is the ATTACKER's real key
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, victimCard), // but the enclosed card claims the VICTIM's identity
    });

    const result = await handlePairingAck(forgedWrap as never, issuer.privHex, { nowSec: T0 + 5 });

    expect(result).toEqual({ status: 'sender-mismatch' });
    // Neither the victim (named in the card) nor the attacker (the
    // authenticated sender) is ever admitted.
    expect(knownPeersState.has(victim.pubHex)).toBe(false);
    expect(knownPeersState.has(attacker.pubHex)).toBe(false);
    expect(rememberKnownPeersCalls).toEqual([]);
    expect(rememberContactCalls).toEqual([]);
  });

  it('AC-SEC-2: sender binding is authenticated (unwrapAndOpen), not tautological — swapping ONLY the enclosed card pubkey (self-consistent forged wrap) still fails to admit the forged identity', async () => {
    // A tautological check (e.g. comparing the card's pubkey to a value
    // derived from the SAME untrusted gift wrap rather than the
    // cryptographically authenticated unwrap result) would trivially pass
    // here. The real check must bind to unwrapAndOpen's authenticated
    // rumor.pubkey, which — for THIS wrap — equals the attacker, not the
    // card's claimed identity.
    const issuer = makeIdentity();
    const attacker = makeIdentity();
    const claimedIdentity = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);

    const claimedCard = await buildIdentityCard(claimedIdentity, 'NotTheAttacker');
    const wrap = await buildGiftWrap({
      senderIdentity: attacker,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, claimedCard),
    });

    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 + 5 });
    expect(result.status).toBe('sender-mismatch');
    expect(knownPeersState.size).toBe(0);
  });
});

// ── AC-ADMIT-4/AC-ADMIT-5 — walled-garden bypass + flip ──────────────────

describe('handlePairingAck — walled garden (AC-ADMIT-4, AC-ADMIT-5)', () => {
  it('AC-ADMIT-5: isAllowedDmSender flips false -> true for the admitted sender (real walledGarden.ts, no re-implementation)', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);
    const card = await buildIdentityCard(scanner, 'Bob');
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, card),
    });

    // Before admission: scanner is a stranger, rejected.
    expect(isAllowedDmSender(scanner.pubHex, [], knownPeersState, issuer.pubHex)).toBe(false);

    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 + 5 });
    expect(result.status).toBe('admitted');

    // After admission: same real isAllowedDmSender, now true.
    expect(isAllowedDmSender(scanner.pubHex, [], knownPeersState, issuer.pubHex)).toBe(true);
  });
});

// ── AC-PRIV-1 — no unaddressed kind-0, epic-wide invariant ──────────────

describe('AC-PRIV-1 — no public kind-0 anywhere in the pairing-ack send/handle path', () => {
  it('sendPairingAck never publishes a kind-0 event', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const publishedKinds: number[] = [];
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
      publishedKinds.push((this as unknown as { rawEvent: () => { kind: number } }).rawEvent().kind);
      return new Set() as never;
    });

    await sendPairingAck({
      ndk: {} as never,
      issuerPubkeyHex: issuer.pubHex,
      echoedNonceHex: 'ab'.repeat(16),
      ownPubkeyHex: scanner.pubHex,
      ownPrivateKeyHex: scanner.privHex,
      ownProfile: { nickname: 'Bob', createdAt: T0 },
      signEvent: scanner.signer.signEvent,
    });

    expect(publishedKinds).not.toContain(0);
    expect(publishedKinds).toEqual([1059]);
  });

  it('handlePairingAck cannot publish anything at all — its signature carries no NDK/publish capability', async () => {
    // Structural guarantee: handlePairingAck's parameters are (giftWrapEvent,
    // ownPrivateKeyHex, opts) — no `ndk` reachable — so it is architecturally
    // incapable of calling a relay-publish primitive, kind-0 or otherwise.
    // A publish spy across the whole run stays untouched regardless of outcome.
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);
    const card = await buildIdentityCard(scanner, 'Bob');
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, card),
    });

    const publishSpy = vi.spyOn(NDKEvent.prototype, 'publish');
    await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 + 5 });
    expect(publishSpy).not.toHaveBeenCalled();
  });
});

// ── AC-SEC-4 content-shape validation + card-invalid gate (mutation gate) ───
// The wire content of a pairing-ack is attacker-controlled: a peer can send a
// kind-1059 wrap enclosing any JSON. handlePairingAck must reject anything that
// is not a well-formed {type:'pairing-ack', nonce:string, card:string} rumor as
// 'malformed-content' BEFORE it consults the nonce or the card — otherwise a
// hostile sender could reach the admission path with a half-formed payload. The
// existing suite covers the happy path and the security gates but never feeds a
// structurally-broken content object, leaving every clause of the shape guard
// alive under mutation.
describe('handlePairingAck — content-shape rejection (mutation gate)', () => {
  it.each([
    ['a non-object JSON value (number)', '42'],
    ['a JSON null', 'null'],
    ['wrong type discriminator', JSON.stringify({ type: 'not-an-ack', nonce: 'ab'.repeat(16), card: 'x' })],
    ['missing nonce field', JSON.stringify({ type: 'pairing-ack', card: 'x' })],
    ['nonce is not a string', JSON.stringify({ type: 'pairing-ack', nonce: 123, card: 'x' })],
    ['missing card field', JSON.stringify({ type: 'pairing-ack', nonce: 'ab'.repeat(16) })],
    ['card is not a string', JSON.stringify({ type: 'pairing-ack', nonce: 'ab'.repeat(16), card: 999 })],
    ['content is not valid JSON at all', 'this-is-not-json'],
  ])('returns "malformed-content" for %s', async (_label, content) => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content,
    });

    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 });
    expect(result.status).toBe('malformed-content');
    // A structurally-broken ack never reaches admission.
    expect(rememberKnownPeersCalls).toEqual([]);
    expect(rememberContactCalls).toEqual([]);
  });

  it('AC-ADMIT-2: a well-shaped ack echoing an admissible nonce but carrying an undecodable card → "card-invalid" (never admitted)', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      // Shape is valid and the nonce is admissible, so the only remaining gate
      // is the enclosed card decoding — which must fail closed here.
      content: ackContent(minted.nonce, 'not-a-real-card'),
    });

    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 + 60 });
    expect(result.status).toBe('card-invalid');
    expect(rememberKnownPeersCalls).toEqual([]);
    expect(rememberContactCalls).toEqual([]);
  });

  it('AC-ADMIT-2: a well-shaped ack whose card DECODES but carries no profile (an unsigned/nameless bare-pubkey card) → "card-invalid" (never admitted)', async () => {
    // The card-invalid gate must reject on BOTH "failed to decode" AND "decoded
    // but identity-less". An identity-less (unsigned) card decodes successfully
    // yet has no profile — admitting it would pair with a nameless peer. This
    // is the case that distinguishes the two-clause guard from a decode-only
    // check.
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const minted = await getOrMintActiveNonce(T0);
    // Empty nickname → encodeCard emits an UNSIGNED, pubkey-only card (decodes
    // to a profile-less DecodedCard).
    const namelessCard = await buildIdentityCard(scanner, '');
    const wrap = await buildGiftWrap({
      senderIdentity: scanner,
      recipientPubHex: issuer.pubHex,
      kind: PAIRING_ACK_KIND,
      content: ackContent(minted.nonce, namelessCard),
    });

    const result = await handlePairingAck(wrap as never, issuer.privHex, { nowSec: T0 + 60 });
    expect(result.status).toBe('card-invalid');
    expect(rememberKnownPeersCalls).toEqual([]);
    expect(rememberContactCalls).toEqual([]);
  });
});
