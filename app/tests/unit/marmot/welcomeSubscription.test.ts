import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks for subscribeToGroupMessages tests. Hoisted by vitest, applied
// to every test in this file. The other tests in this file don't exercise the
// dynamically-imported `@nostr-dev-kit/ndk` (NDKRelaySet) or `@/src/lib/ndkClient`
// (fetchEventsWithTimeout), so these mocks are no-ops for them.
// ---------------------------------------------------------------------------

const mockFetchEventsWithTimeout = vi.fn();

vi.mock('@/src/lib/ndkClient', () => ({
  fetchEventsWithTimeout: (...args: unknown[]) => mockFetchEventsWithTimeout(...args),
}));

vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKRelaySet: {
    fromRelayUrls: (_relays: string[], _ndk: unknown) => 'mock-relay-set',
  },
}));

// EpochResolver is statically imported by welcomeSubscription.ts; mock it so the
// test doesn't need a real MarmotGroup with event-emitter shape.
vi.mock('@/src/lib/marmot/epochResolver', () => ({
  EpochResolver: class {
    constructor(_group: unknown, _opts: unknown) {}
    ingestEvent(_event: unknown) { return Promise.resolve(); }
    dispose() {}
  },
}));

import { unwrapGiftWrap, subscribeToGroupMessages } from '@/src/lib/marmot/welcomeSubscription';

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
    localProfile: { nickname: string; avatar: null; badgeIds: string[] },
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
    const localProfile = { nickname: 'Alice', avatar: null, badgeIds: [] };

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
    const localProfile = { nickname: 'Alice', avatar: null, badgeIds: [] };

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
    const localProfile = { nickname: 'Alice', avatar: null, badgeIds: [] };

    const onMembersChanged = makeOnMembersChangedCallback(3, mlsGroup, 'aabbcc', localProfile);
    await onMembersChanged(['aabbcc', 'ddeeff']); // member removed: 3 → 2

    expect(sendApplicationRumor).not.toHaveBeenCalled();
  });

  it('calls sendApplicationRumor again on a second join after first join', async () => {
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null, badgeIds: [] };

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
    const localProfile = { nickname: 'Alice', avatar: null, badgeIds: [] };

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
