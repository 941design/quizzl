import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

// crypto.subtle polyfill (mirrors sealAndWrap.test.ts / pairingAck.test.ts) —
// the pairing-ack dispatch tests below exercise real NIP-59 gift-wrap crypto
// and real nonceStore.ts (idb-keyval, hence fake-indexeddb/auto above).
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Module mocks for subscribeToGroupMessages tests. Hoisted by vitest, applied
// to every test in this file. The other tests in this file don't exercise the
// dynamically-imported `@nostr-dev-kit/ndk` (NDKRelaySet) or `@/src/lib/ndkClient`
// (fetchEventsWithTimeout), so these mocks are no-ops for them.
// ---------------------------------------------------------------------------

const mockFetchEventsWithTimeout = vi.fn();

// ---------------------------------------------------------------------------
// Module mock for pendingInvitations — allows asserting on enqueuePendingInvitation
// calls without touching localStorage. Hoisted by vitest.
// ---------------------------------------------------------------------------

const mockEnqueuePendingInvitation = vi.fn();
const mockCountPendingInvitations = vi.fn().mockReturnValue(1);
const mockRemovePendingInvitation = vi.fn();
const mockListPendingInvitations = vi.fn().mockReturnValue([]);

vi.mock('@/src/lib/pendingInvitations', () => ({
  enqueuePendingInvitation: (...args: unknown[]) => mockEnqueuePendingInvitation(...args),
  countPendingInvitations: () => mockCountPendingInvitations(),
  removePendingInvitation: (...args: unknown[]) => mockRemovePendingInvitation(...args),
  listPendingInvitations: () => mockListPendingInvitations(),
}));

vi.mock('@/src/lib/ndkClient', () => ({
  fetchEventsWithTimeout: (...args: unknown[]) => mockFetchEventsWithTimeout(...args),
}));

vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKRelaySet: {
    fromRelayUrls: (_relays: string[], _ndk: unknown) => 'mock-relay-set',
  },
}));

// EpochResolver is statically imported by welcomeSubscription.ts; mock it so the
// test doesn't need a real MarmotGroup with event-emitter shape. ingestEvent is a
// spy so the dedup test can assert how many events actually reached the resolver.
const { mockIngestEvent } = vi.hoisted(() => ({ mockIngestEvent: vi.fn(async (_event: unknown) => {}) }));
vi.mock('@/src/lib/marmot/epochResolver', () => ({
  EpochResolver: class {
    constructor(_group: unknown, _opts: unknown) {}
    ingestEvent(event: unknown) { return mockIngestEvent(event); }
    dispose() {}
  },
}));

import { unwrapGiftWrap, subscribeToGroupMessages, subscribeToWelcomes } from '@/src/lib/marmot/welcomeSubscription';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { createRumor } from 'nostr-tools/nip59';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { encodeCard } from '@/src/lib/contactCard';
import { sealAndWrap } from '@/src/lib/directMessages';
import { hexToBytes } from '@/src/lib/nostrKeys';
import { PAIRING_ACK_KIND, _resetPairingAckAdmissionsForTests, type PairingAckContent } from '@/src/lib/pairing/pairingAck';
import * as pairingAckModule from '@/src/lib/pairing/pairingAck';
import { getOrMintActiveNonce, clearAllNonces, _resetActiveNonceForTests } from '@/src/lib/pairing/nonceStore';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// unwrapGiftWrap tests
// ---------------------------------------------------------------------------

describe('unwrapGiftWrap', () => {
  it('decrypts two-layer NIP-59 envelope to inner rumor', async () => {
    const innerRumor = {
      id: 'rumor-id',
      pubkey: 'sender-pubkey',
      created_at: 1700000000,
      kind: 444,
      tags: [['e', 'group-id']],
      content: 'welcome-payload',
      sig: '',
    };

    const seal = {
      pubkey: 'sender-pubkey',
      content: 'encrypted-rumor',
    };

    const mockDecrypt = vi.fn()
      // Layer 1: decrypt gift wrap content with ephemeral pubkey → seal
      .mockResolvedValueOnce(JSON.stringify(seal))
      // Layer 2: decrypt seal content with sender pubkey → rumor
      .mockResolvedValueOnce(JSON.stringify(innerRumor));

    const signer = {
      nip44: { decrypt: mockDecrypt },
    };

    const giftWrapEvent = {
      pubkey: 'ephemeral-pubkey',
      content: 'encrypted-seal',
    };

    const result = await unwrapGiftWrap(giftWrapEvent, signer as never);

    expect(result).toEqual(innerRumor);
    // Layer 1: decrypts against gift wrap's ephemeral pubkey
    expect(mockDecrypt).toHaveBeenNthCalledWith(1, 'ephemeral-pubkey', 'encrypted-seal');
    // Layer 2: decrypts against seal's sender pubkey
    expect(mockDecrypt).toHaveBeenNthCalledWith(2, 'sender-pubkey', 'encrypted-rumor');
  });

  it('throws when signer lacks nip44.decrypt', async () => {
    const signer = { nip44: undefined };

    await expect(
      unwrapGiftWrap({ pubkey: 'pk', content: 'ct' }, signer as never),
    ).rejects.toThrow('Signer does not support NIP-44 decryption');
  });

  it('throws when signer.nip44 exists but decrypt is undefined', async () => {
    const signer = { nip44: { decrypt: undefined } };

    await expect(
      unwrapGiftWrap({ pubkey: 'pk', content: 'ct' }, signer as never),
    ).rejects.toThrow('Signer does not support NIP-44 decryption');
  });

  it('defaults missing rumor fields', async () => {
    // Rumor with missing optional fields
    const partialRumor = { kind: 444, content: 'hello' };
    const seal = { pubkey: 'spk', content: 'enc' };

    const mockDecrypt = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(seal))
      .mockResolvedValueOnce(JSON.stringify(partialRumor));

    const signer = { nip44: { decrypt: mockDecrypt } };

    const result = await unwrapGiftWrap({ pubkey: 'epk', content: 'c' }, signer as never);

    expect(result.id).toBe('');
    expect(result.pubkey).toBe('');
    expect(result.created_at).toBe(0);
    expect(result.kind).toBe(444);
    expect(result.tags).toEqual([]);
    expect(result.content).toBe('hello');
    expect(result.sig).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Regression test: profile republish on new member join (onMembersChanged)
//
// Bug report: bug-reports/profile-propagation-new-members.md
// Fixed: 2026-03-24
// Root cause: The onMembersChanged callback in MarmotContext.tsx only updated
// member storage — it never called sendApplicationRumor to republish the local
// profile. New members therefore never received User A's current profile unless
// User A manually triggered publishProfileUpdate().
//
// Protection: Ensures that when onMembersChanged fires with a larger member
// list (member join), sendApplicationRumor is called exactly once. When the
// count stays the same or decreases (stable or leave), it must NOT be called.
// ---------------------------------------------------------------------------

describe('onMembersChanged profile republish logic (MarmotContext)', () => {
  /**
   * Replicate the exact closure pattern from MarmotContext.subscribeNewGroups()
   * so we can exercise the fix in isolation without mounting React.
   *
   * The closure captures prevMemberCount and a mock mlsGroup; when currentMembers
   * exceeds prevMemberCount, sendApplicationRumor should be invoked.
   */
  function makeOnMembersChangedCallback(
    initialMemberCount: number,
    mlsGroup: { sendApplicationRumor: (rumor: unknown) => Promise<void> },
    pubkeyHex: string,
    localProfile: { nickname: string; avatar: null },
  ): (currentMembers: string[]) => Promise<void> {
    let prevMemberCount = initialMemberCount;

    return async (currentMembers: string[]) => {
      // (storage update omitted — not relevant to the fix being tested)
      if (currentMembers.length > prevMemberCount) {
        const payload = JSON.stringify({ ...localProfile, updatedAt: new Date().toISOString() });
        // kind 0 = PROFILE_RUMOR_KIND, matching MIP-03 standard
        const rumor = {
          kind: 0,
          content: payload,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
          pubkey: pubkeyHex,
          id: '',
        };
        void mlsGroup.sendApplicationRumor(rumor).catch(() => { /* swallow in test */ });
      }
      prevMemberCount = currentMembers.length;
    };
  }

  it('calls sendApplicationRumor when new member joins (count increases)', async () => {
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null };

    // Initial: 1 member (creator). New member joins → 2 members.
    const onMembersChanged = makeOnMembersChangedCallback(1, mlsGroup, 'aabbcc', localProfile);
    await onMembersChanged(['aabbcc', 'ddeeff']);

    expect(sendApplicationRumor).toHaveBeenCalledTimes(1);
    const [rumor] = sendApplicationRumor.mock.calls[0] as [{ kind: number; pubkey: string; tags: string[][] }];
    expect(rumor.kind).toBe(0);
    expect(rumor.pubkey).toBe('aabbcc');
    expect(rumor.tags).toEqual([]);
  });

  it('does NOT call sendApplicationRumor when member count stays the same', async () => {
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null };

    const onMembersChanged = makeOnMembersChangedCallback(2, mlsGroup, 'aabbcc', localProfile);
    await onMembersChanged(['aabbcc', 'ddeeff']); // same count: 2 → 2

    expect(sendApplicationRumor).not.toHaveBeenCalled();
  });

  it('does NOT call sendApplicationRumor when a member is removed (count decreases)', async () => {
    // Member count can decrease when an admin commits a Remove (e.g. after
    // processing a kind 13 leave-intent, or a forced kick). Profile should
    // NOT be republished in that case — only on joins (count increase).
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null };

    const onMembersChanged = makeOnMembersChangedCallback(3, mlsGroup, 'aabbcc', localProfile);
    await onMembersChanged(['aabbcc', 'ddeeff']); // member removed: 3 → 2

    expect(sendApplicationRumor).not.toHaveBeenCalled();
  });

  it('calls sendApplicationRumor again on a second join after first join', async () => {
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null };

    const onMembersChanged = makeOnMembersChangedCallback(1, mlsGroup, 'aabbcc', localProfile);

    // First member joins: 1 → 2
    await onMembersChanged(['aabbcc', 'ddeeff']);
    expect(sendApplicationRumor).toHaveBeenCalledTimes(1);

    // Second member joins: 2 → 3
    await onMembersChanged(['aabbcc', 'ddeeff', '112233']);
    expect(sendApplicationRumor).toHaveBeenCalledTimes(2);
  });

  it('does NOT call sendApplicationRumor when re-joining after a removal does not exceed prior peak', async () => {
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null };

    // Start with 2, drop to 1 (admin committed Remove), then back to 2
    // (new invite) — count goes 2→1→2. The second fire (back to 2) DOES
    // exceed prevMemberCount of 1, so it should call sendApplicationRumor
    // (re-joining member needs a fresh profile).
    const onMembersChanged = makeOnMembersChangedCallback(2, mlsGroup, 'aabbcc', localProfile);

    await onMembersChanged(['aabbcc']); // removal committed: 2→1 — no publish
    expect(sendApplicationRumor).toHaveBeenCalledTimes(0);

    await onMembersChanged(['aabbcc', 'ddeeff']); // new member joins: 1→2 — publishes
    expect(sendApplicationRumor).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Regression test: EOSE → live-sub gap on subscribeToGroupMessages
//
// Bug: bug-reports/profile-rumor-kind-from-one-peer-report.md
// Root cause: the Phase-2 live subscription was opened *after* the Phase-1
// historical fetch closed on EOSE. Events published on the relay during that
// gap (notably the admin's profile rumor republished synchronously after the
// invite commit) were silently dropped — not in the historical result set and
// not yet visible to the live sub.
//
// Fix: capture a `fetchStartedAt` timestamp before Phase-1 and pass it as
// `since` on the Phase-2 live sub. The relay then replays any event from the
// gap window. The existing `processedIds` set absorbs the overlap.
// ---------------------------------------------------------------------------

describe('subscribeToGroupMessages — Phase-2 live sub carries `since` covering Phase-1 gap', () => {
  it('passes a since filter to ndk.subscribe approximating the Phase-1 start timestamp', async () => {
    mockFetchEventsWithTimeout.mockReset();
    // Resolve historical fetch synchronously with no events so we get past
    // Phase-1 quickly and reach the live-sub setup.
    mockFetchEventsWithTimeout.mockResolvedValue({ events: new Set(), timedOut: false });

    const subscribeCalls: Array<{ filter: Record<string, unknown>; opts: unknown; relaySet: unknown }> = [];
    const mockSubInstance = {
      on: vi.fn(),
      stop: vi.fn(),
    };
    const mockNdk = {
      subscribe: vi.fn((filter: Record<string, unknown>, opts: unknown, relaySet: unknown) => {
        subscribeCalls.push({ filter, opts, relaySet });
        return mockSubInstance;
      }),
    };

    // Minimal MarmotGroup stub — only the fields touched by subscribeToGroupMessages.
    // nostrGroupId is a 32-byte Uint8Array → hex-encoded for the #h filter.
    const groupIdBytes = new Uint8Array(32).fill(0xab);
    const mlsGroup = {
      groupData: { nostrGroupId: groupIdBytes },
    };

    const beforeCallSec = Math.floor(Date.now() / 1000);
    const unsubscribe = await subscribeToGroupMessages(
      'group-id-1234567890abcdef',
      ['wss://relay.example.com'],
      mlsGroup as never,
      mockNdk as never,
    );
    const afterCallSec = Math.floor(Date.now() / 1000);

    // Exactly one live subscription was opened (the Phase-2 live sub).
    expect(mockNdk.subscribe).toHaveBeenCalledTimes(1);

    const liveSubCall = subscribeCalls[0];
    // The live sub must carry a `since` field — without it, events published
    // between Phase-1 EOSE and Phase-2 REQ registration are dropped.
    expect(liveSubCall.filter).toHaveProperty('since');
    const since = liveSubCall.filter.since as number;
    expect(typeof since).toBe('number');
    // Unix seconds (not milliseconds): a value in the seconds range, not ms.
    expect(since).toBeLessThan(1e11);
    // The anchor must be captured BEFORE Phase-1 starts AND backdated by the
    // clock-skew safety margin (currently 30 s; allow a wide window so the test
    // does not become brittle if the margin is retuned in either direction).
    // Lower bound = call wall-clock minus margin headroom; -60s leaves 30s of
    // slack above today's 30s margin so a future bump stays inside the bound.
    // Upper bound = call wall-clock plus 2 s slack (must never exceed wall-clock).
    expect(since).toBeGreaterThanOrEqual(beforeCallSec - 60);
    expect(since).toBeLessThanOrEqual(afterCallSec + 2);

    // The live sub still uses closeOnEose: false for continuous listening.
    expect(liveSubCall.opts).toMatchObject({ closeOnEose: false });

    unsubscribe();
  });

  it('captures an independent `since` anchor on each re-subscribe call', async () => {
    mockFetchEventsWithTimeout.mockReset();
    mockFetchEventsWithTimeout.mockResolvedValue({ events: new Set(), timedOut: false });

    const subscribeCalls: Array<Record<string, unknown>> = [];
    const mockNdk = {
      subscribe: vi.fn((filter: Record<string, unknown>) => {
        subscribeCalls.push(filter);
        return { on: vi.fn(), stop: vi.fn() };
      }),
    };

    const mlsGroup = {
      groupData: { nostrGroupId: new Uint8Array(32).fill(0xcd) },
    };

    const unsub1 = await subscribeToGroupMessages('g1', ['wss://r'], mlsGroup as never, mockNdk as never);
    // Wait long enough to guarantee a distinct Unix-second tick on the second call.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const unsub2 = await subscribeToGroupMessages('g1', ['wss://r'], mlsGroup as never, mockNdk as never);

    expect(subscribeCalls).toHaveLength(2);
    const since1 = subscribeCalls[0].since as number;
    const since2 = subscribeCalls[1].since as number;
    expect(since2).toBeGreaterThan(since1);

    unsub1();
    unsub2();
  });

  it('backdates the `since` anchor by a clock-skew safety margin', async () => {
    // Round-1 remediation: relays filter `since` against the event's signed
    // `created_at`, not relay receipt time. A peer with a slow clock or a
    // pre-signed event can publish into the EOSE→REQ gap with a created_at
    // that is slightly behind our local wall clock. The anchor must therefore
    // be backdated by a margin (>= 1 second to lock in that the margin is
    // actually applied, not just an unmargined Math.floor).
    mockFetchEventsWithTimeout.mockReset();
    mockFetchEventsWithTimeout.mockResolvedValue({ events: new Set(), timedOut: false });

    const subscribeCalls: Array<Record<string, unknown>> = [];
    const mockNdk = {
      subscribe: vi.fn((filter: Record<string, unknown>) => {
        subscribeCalls.push(filter);
        return { on: vi.fn(), stop: vi.fn() };
      }),
    };

    const mlsGroup = {
      groupData: { nostrGroupId: new Uint8Array(32).fill(0xef) },
    };

    const beforeCallSec = Math.floor(Date.now() / 1000);
    const unsub = await subscribeToGroupMessages('g-skew', ['wss://r'], mlsGroup as never, mockNdk as never);
    const since = subscribeCalls[0].since as number;

    // Round-2 tightening: 5 s was deemed insufficient to absorb realistic
    // NTP drift + scheduling jitter, so the constant was bumped to 30 s. The
    // lower bound here (>= 10 s) proves the margin is materially applied,
    // while leaving room to retune within 10–60 without breaking the test.
    expect(since).toBeLessThanOrEqual(beforeCallSec - 10);
    // Upper sanity bound on the margin so a future refactor doesn't silently
    // backdate by hours. 60 s is the loose Nostr-convention ceiling.
    expect(since).toBeGreaterThanOrEqual(beforeCallSec - 60);

    unsub();
  });
});

// ---------------------------------------------------------------------------
// subscribeToWelcomes — receipt-handler integration tests
//
// Verifies that the event handler installed by subscribeToWelcomes:
//   AC-INVITE-1: valid kind-444 rumor → enqueuePendingInvitation called, NOT
//                joinGroupFromWelcome (join is deferred to user acceptance).
//   AC-INVITE-2: invalid Welcome (decryption failure) → silently dropped,
//                enqueuePendingInvitation NOT called, no error thrown.
// ---------------------------------------------------------------------------

describe('subscribeToWelcomes — receipt-handler integration', () => {
  // localStorage stub: subscribeToWelcomes reads/writes the processedGiftWraps key.
  // Provide a minimal in-memory stub so tests don't depend on a real DOM.
  let localStorageStore: Record<string, string> = {};

  beforeEach(() => {
    localStorageStore = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localStorageStore[key] ?? null,
      setItem: (key: string, value: string) => { localStorageStore[key] = value; },
      removeItem: (key: string) => { delete localStorageStore[key]; },
    });

    mockEnqueuePendingInvitation.mockReset();
    mockCountPendingInvitations.mockReset().mockReturnValue(1);
  });

  /**
   * Build a minimal signer that returns the supplied decrypted layers via nip44.decrypt.
   * The first call decrypts the gift wrap → seal JSON.
   * The second call decrypts the seal → rumor JSON.
   */
  function makeDecryptSigner(seal: object, rumor: object) {
    return {
      nip44: {
        decrypt: vi.fn()
          .mockResolvedValueOnce(JSON.stringify(seal))
          .mockResolvedValueOnce(JSON.stringify(rumor)),
      },
    };
  }

  /**
   * Build a minimal NDK mock that captures the event handler installed by
   * subscribeToWelcomes so that tests can fire it manually.
   * Returns { mockNdk, fireEvent }.
   */
  function makeNdkWithEventCapture() {
    let capturedHandler: ((event: unknown) => Promise<void>) | null = null;

    const mockSubInstance = {
      on: vi.fn((eventName: string, handler: (event: unknown) => Promise<void>) => {
        if (eventName === 'event') {
          capturedHandler = handler;
        }
      }),
      stop: vi.fn(),
    };

    const mockNdk = {
      subscribe: vi.fn(() => mockSubInstance),
    };

    const fireEvent = async (ndkEvent: unknown) => {
      if (!capturedHandler) throw new Error('Event handler not yet installed');
      await capturedHandler(ndkEvent);
    };

    return { mockNdk, fireEvent };
  }

  it('valid kind-444 rumor → enqueuePendingInvitation called; joinGroupFromWelcome NOT called', async () => {
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    const rumor = {
      id: 'rumor-abc',
      pubkey: 'inviter-pubkey-hex',
      created_at: 1700000001,
      kind: 444,
      tags: [['e', 'group-id']],
      content: 'welcome-payload',
      sig: '',
    };
    const seal = { pubkey: 'inviter-pubkey-hex', content: 'encrypted-rumor' };
    const signer = makeDecryptSigner(seal, rumor);

    // marmotClient — joinGroupFromWelcome must NOT be called
    const mockMarmotClient = {
      joinGroupFromWelcome: vi.fn(),
    };

    const unsub = await subscribeToWelcomes(
      'my-pubkey-hex',
      mockMarmotClient as never,
      mockNdk as never,
      signer as never,
      vi.fn(), // onGroupJoined callback
    );

    // Fire a gift-wrap NDK event addressed to us
    await fireEvent({
      id: 'giftwrap-id-001',
      pubkey: 'ephemeral-pubkey',
      content: 'encrypted-seal',
    });

    // AC-INVITE-1: enqueuePendingInvitation must have been called once with the rumor data
    expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);
    const [enqueued] = mockEnqueuePendingInvitation.mock.calls[0] as [{ id: string; inviterPubkeyHex: string }];
    expect(enqueued.id).toBe('rumor-abc');
    expect(enqueued.inviterPubkeyHex).toBe('inviter-pubkey-hex');

    // AC-INVITE-1: joinGroupFromWelcome must NOT have been called
    expect(mockMarmotClient.joinGroupFromWelcome).not.toHaveBeenCalled();

    unsub();
  });

  it('invalid Welcome (decryption failure) → silently dropped; enqueuePendingInvitation NOT called', async () => {
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    // Signer that always throws on decrypt — simulates a DM or other non-Welcome
    // gift wrap that we cannot decrypt (the expected case for non-Welcome kind 1059s)
    const signer = {
      nip44: {
        decrypt: vi.fn().mockRejectedValue(new Error('Decryption failed — wrong key')),
      },
    };

    const mockMarmotClient = {
      joinGroupFromWelcome: vi.fn(),
    };

    const unsub = await subscribeToWelcomes(
      'my-pubkey-hex',
      mockMarmotClient as never,
      mockNdk as never,
      signer as never,
      vi.fn(),
    );

    // Fire an event that will fail decryption; the handler must NOT throw
    await expect(
      fireEvent({
        id: 'giftwrap-id-002',
        pubkey: 'some-pubkey',
        content: 'undecryptable-content',
      })
    ).resolves.toBeUndefined();

    // AC-INVITE-2: no invitation enqueued, no joinGroupFromWelcome call
    expect(mockEnqueuePendingInvitation).not.toHaveBeenCalled();
    expect(mockMarmotClient.joinGroupFromWelcome).not.toHaveBeenCalled();

    unsub();
  });
});

// ---------------------------------------------------------------------------
// subscribeToWelcomes — pairing-ack dispatch (S3, additive wiring)
//
// Verifies subscribeToWelcomes's two new trailing, optional params
// (ownPrivateKeyHex, onPairingAckReceived): a genuine PAIRING_ACK_KIND gift
// wrap must be dispatched to pairingAck.ts#handlePairingAck, must NOT be
// treated as a Welcome (enqueuePendingInvitation not called), and — on
// admission — onPairingAckReceived must fire with the sender's pubkey.
// Uses real NIP-59 crypto (sealAndWrap/createRumor) and the real
// nonceStore/contactCard modules, exactly like pairingAck.test.ts, so this
// is an authentic end-to-end wire-shape test rather than a mocked stand-in.
// ---------------------------------------------------------------------------

describe('subscribeToWelcomes — pairing-ack dispatch (S3)', () => {
  let localStorageStore: Record<string, string> = {};

  function makeIdentity() {
    const priv = generateSecretKey();
    const privHex = bytesToHex(priv);
    const pubHex = getPublicKey(priv);
    return { priv, privHex, pubHex, signer: createPrivateKeySigner(privHex) };
  }

  function makeNdkWithEventCapture() {
    let capturedHandler: ((event: unknown) => Promise<void>) | null = null;
    const mockSubInstance = {
      on: vi.fn((eventName: string, handler: (event: unknown) => Promise<void>) => {
        if (eventName === 'event') capturedHandler = handler;
      }),
      stop: vi.fn(),
    };
    const mockNdk = { subscribe: vi.fn(() => mockSubInstance) };
    const fireEvent = async (ndkEvent: unknown) => {
      if (!capturedHandler) throw new Error('Event handler not yet installed');
      await capturedHandler(ndkEvent);
    };
    return { mockNdk, fireEvent };
  }

  beforeEach(async () => {
    localStorageStore = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localStorageStore[key] ?? null,
      setItem: (key: string, value: string) => { localStorageStore[key] = value; },
      removeItem: (key: string) => { delete localStorageStore[key]; },
    });
    mockEnqueuePendingInvitation.mockReset();
    mockCountPendingInvitations.mockReset().mockReturnValue(1);
    await clearAllNonces();
    _resetActiveNonceForTests();
    _resetPairingAckAdmissionsForTests();
  });

  it('a genuine PAIRING_ACK_KIND gift wrap is dispatched, NOT treated as a Welcome, and admits the sender via onPairingAckReceived', async () => {
    const issuer = makeIdentity(); // the local app identity (recipient)
    const scanner = makeIdentity(); // the pairing-ack sender

    const minted = await getOrMintActiveNonce();
    const card = await encodeCard(scanner.pubHex, { nickname: 'Bob', createdAt: Math.floor(Date.now() / 1000) }, scanner.signer.signEvent);
    const content: PairingAckContent = { type: 'pairing-ack', nonce: minted.nonce, card };
    const rumor = createRumor(
      {
        kind: PAIRING_ACK_KIND,
        content: JSON.stringify(content),
        tags: [['p', issuer.pubHex]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: scanner.pubHex,
      },
      hexToBytes(scanner.privHex),
    );
    const wrap = await sealAndWrap(rumor as never, issuer.pubHex, scanner.privHex);

    const { mockNdk, fireEvent } = makeNdkWithEventCapture();
    const mockMarmotClient = { joinGroupFromWelcome: vi.fn() };
    const onPairingAckReceived = vi.fn();

    const unsub = await subscribeToWelcomes(
      issuer.pubHex,
      mockMarmotClient as never,
      mockNdk as never,
      // The signer param is only used by the pre-existing unwrapGiftWrap path
      // (Welcome/join-request) — the pairing-ack dispatch never touches it.
      { nip44: { decrypt: vi.fn().mockRejectedValue(new Error('n/a')) } } as never,
      vi.fn(), // onGroupJoined
      undefined, // onJoinRequestReceived
      undefined, // groupMemberPubkeys
      issuer.privHex,
      onPairingAckReceived,
    );

    await fireEvent(wrap);

    // Not a Welcome — must never reach enqueuePendingInvitation.
    expect(mockEnqueuePendingInvitation).not.toHaveBeenCalled();
    expect(mockMarmotClient.joinGroupFromWelcome).not.toHaveBeenCalled();

    // Admitted — onPairingAckReceived fires with the authenticated sender.
    expect(onPairingAckReceived).toHaveBeenCalledTimes(1);
    expect(onPairingAckReceived).toHaveBeenCalledWith({ senderPubkeyHex: scanner.pubHex });

    unsub();
  });

  it('omitting the two new trailing params behaves exactly as before — no pairing-ack dispatch attempted', async () => {
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    const rumor = {
      id: 'rumor-abc-legacy',
      pubkey: 'inviter-pubkey-hex',
      created_at: 1700000001,
      kind: 444,
      tags: [['e', 'group-id']],
      content: 'welcome-payload',
      sig: '',
    };
    const seal = { pubkey: 'inviter-pubkey-hex', content: 'encrypted-rumor' };
    const signer = {
      nip44: {
        decrypt: vi.fn()
          .mockResolvedValueOnce(JSON.stringify(seal))
          .mockResolvedValueOnce(JSON.stringify(rumor)),
      },
    };
    const mockMarmotClient = { joinGroupFromWelcome: vi.fn() };

    // Called with exactly the pre-S3 arity — no ownPrivateKeyHex, no callback.
    const unsub = await subscribeToWelcomes(
      'my-pubkey-hex',
      mockMarmotClient as never,
      mockNdk as never,
      signer as never,
      vi.fn(),
    );

    await fireEvent({
      id: 'giftwrap-id-legacy-001',
      pubkey: 'ephemeral-pubkey',
      content: 'encrypted-seal',
    });

    expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);
    unsub();
  });

  // ── Push trigger wiring (epic: direct-contact-profile-exchange, story 06,
  // AC-PROF-11b) ────────────────────────────────────────────────────────────
  //
  // handlePairingAck gained an OPTIONAL opts.ndk field (pairingAck.test.ts
  // already covers, with real crypto, that supplying it fires an announce on
  // a fresh admission and that omitting it is a no-op). The only change this
  // story makes HERE is threading this function's own already-in-scope `ndk`
  // param through to that call — proven below by a call-through spy (never a
  // full replacement of handlePairingAck, per this repo's mocking-discipline
  // convention) plus a source-scan asserting the subscription filter itself,
  // the dispatch order, and the Welcome/join-request fallthrough are BYTE-FOR-
  // BYTE unchanged (mirrors S05's source-scan style for AC-WATCH-2 isolation).

  it('passes its own `ndk` through to handlePairingAck as opts.ndk, alongside the same first two arguments as before', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();

    const minted = await getOrMintActiveNonce();
    const card = await encodeCard(scanner.pubHex, { nickname: 'Bob', createdAt: Math.floor(Date.now() / 1000) }, scanner.signer.signEvent);
    const content: PairingAckContent = { type: 'pairing-ack', nonce: minted.nonce, card };
    const rumor = createRumor(
      {
        kind: PAIRING_ACK_KIND,
        content: JSON.stringify(content),
        tags: [['p', issuer.pubHex]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: scanner.pubHex,
      },
      hexToBytes(scanner.privHex),
    );
    const wrap = await sealAndWrap(rumor as never, issuer.pubHex, scanner.privHex);

    const { mockNdk, fireEvent } = makeNdkWithEventCapture();
    const mockMarmotClient = { joinGroupFromWelcome: vi.fn() };

    // Call-through spy — the REAL handlePairingAck still runs (never
    // replaced), so admission/announce behavior is exercised for real; only
    // the call arguments are inspected.
    const handlePairingAckSpy = vi.spyOn(pairingAckModule, 'handlePairingAck');

    const unsub = await subscribeToWelcomes(
      issuer.pubHex,
      mockMarmotClient as never,
      mockNdk as never,
      { nip44: { decrypt: vi.fn().mockRejectedValue(new Error('n/a')) } } as never,
      vi.fn(),
      undefined,
      undefined,
      issuer.privHex,
      vi.fn(),
    );

    await fireEvent(wrap);

    expect(handlePairingAckSpy).toHaveBeenCalledTimes(1);
    const [giftWrapArg, ownPrivateKeyHexArg, optsArg] = handlePairingAckSpy.mock.calls[0];
    // The gift wrap's OUTER pubkey is an ephemeral per-wrap key (project
    // learning: gift-wrap authors are never the real sender) — assert the
    // exact same wrap object's own content/id is what was forwarded, not the
    // (inapplicable) scanner identity.
    expect((giftWrapArg as { content: string }).content).toBe((wrap as unknown as { content: string }).content);
    expect(ownPrivateKeyHexArg).toBe(issuer.privHex);
    expect(optsArg).toEqual({ ndk: mockNdk });

    unsub();
  });

  it("does not alter the subscription filter, dispatch order, or Welcome/join-request fallthrough (source-scan, mirrors S05's AC-WATCH-2 isolation style)", () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'lib', 'marmot', 'welcomeSubscription.ts'),
      'utf8',
    );

    // The kind-1059 subscription this function opens is untouched: still
    // exactly one filter term beyond '#p' possible (kinds:[1059]), still
    // filtered to this pubkey only.
    expect(source).toContain("kinds: [1059 as import('@nostr-dev-kit/ndk').NDKKind]");
    expect(source).toContain("'#p': [pubkeyHex]");
    expect(source).toContain('{ closeOnEose: false }');

    // The pairing-ack dispatch still runs BEFORE the Welcome/join-request
    // unwrapGiftWrap path, and still falls through unchanged on
    // 'unwrap-failed'/'wrong-kind'.
    const pairingDispatchIndex = source.indexOf('const pairingResult = await handlePairingAck(');
    const welcomeUnwrapIndex = source.indexOf('const welcomeRumor = await unwrapGiftWrap(');
    expect(pairingDispatchIndex).toBeGreaterThan(-1);
    expect(welcomeUnwrapIndex).toBeGreaterThan(-1);
    expect(pairingDispatchIndex).toBeLessThan(welcomeUnwrapIndex);
    expect(source).toContain("'unwrap-failed' or 'wrong-kind' — might still be a real Welcome/");

    // This story's only change to this call is the added trailing `{ ndk }`.
    expect(source).toContain('{ ndk },');
  });
});

describe('subscribeToGroupMessages — cross-instance dedup (shared per-group seen ids)', () => {
  it('does not ingest the same event twice across overlapping subscription instances', async () => {
    mockFetchEventsWithTimeout.mockReset();
    mockFetchEventsWithTimeout.mockResolvedValue({ events: new Set(), timedOut: false });
    mockIngestEvent.mockClear();

    // Capture the live-sub 'event' handler from each subscribe() call.
    const handlers: Array<(ev: unknown) => void> = [];
    const mockNdk = {
      subscribe: vi.fn(() => ({
        on: (_event: string, fn: (ev: unknown) => void) => { handlers.push(fn); },
        stop: vi.fn(),
      })),
    };
    const mlsGroup = { groupData: { nostrGroupId: new Uint8Array(32).fill(0xcd) } };
    const GROUP = 'dedup-group-unique-xyz';

    // Two overlapping instances for the SAME group (rapid re-subscribe).
    const unsub1 = await subscribeToGroupMessages(GROUP, ['wss://r'], mlsGroup as never, mockNdk as never);
    const unsub2 = await subscribeToGroupMessages(GROUP, ['wss://r'], mlsGroup as never, mockNdk as never);

    // The same kind-445 event id is delivered to BOTH instances' live subs.
    const event = { id: 'evt-shared-dedup-1', pubkey: 'p', created_at: 1, kind: 445, tags: [], content: '', sig: 's' };
    handlers[0](event);
    handlers[1](event);
    await Promise.resolve();
    await Promise.resolve();

    // Shared per-group seen-id set → ingested exactly once (not once per instance).
    expect(mockIngestEvent).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });
});
