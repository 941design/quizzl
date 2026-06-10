import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MemberProfile, ProfileRequestMemo } from '@/src/lib/marmot/profileRequestSync';
import { RELAY_BACKOFF_MAX_MS, RELAY_BACKOFF_MIN_MS } from '@/src/lib/marmot/profileRequestSync';
import type { SignedProfileEvent } from '@/src/types';
import { handleIncomingProfileRequest, notifyProfileObserved, sweepStaleProfiles } from '@/src/lib/marmot/profileRequestRunner';

// ---------------------------------------------------------------------------
// Fake injections factory
// ---------------------------------------------------------------------------

function makeFakes() {
  return {
    getGroupMembers: vi.fn<(groupId: string) => Promise<string[]>>(),
    loadProfile: vi.fn<(groupId: string, pubkeyHex: string) => Promise<MemberProfile | undefined>>(),
    loadMemo: vi.fn<(groupId: string, targetPubkey: string) => Promise<ProfileRequestMemo | null>>(),
    recordEmitted: vi.fn<(groupId: string, targetPubkey: string, now: number) => Promise<void>>(),
    sendRumor: vi.fn<(groupId: string, content: string) => Promise<void>>(),
  };
}

// ---------------------------------------------------------------------------
// sweepStaleProfiles
// ---------------------------------------------------------------------------

describe('sweepStaleProfiles', () => {
  const NOW = 10_000_000_000; // Unix ms — consistent timestamp for all tests
  const SELF = 'self-pk';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('calls getGroupMembers once per groupId', async () => {
    const fakes = makeFakes();
    fakes.getGroupMembers.mockResolvedValue([]);

    await sweepStaleProfiles({
      groupIds: ['g1', 'g2'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.getGroupMembers).toHaveBeenCalledTimes(2);
    expect(fakes.getGroupMembers).toHaveBeenCalledWith('g1');
    expect(fakes.getGroupMembers).toHaveBeenCalledWith('g2');
  });

  it('skips selfPubkeyHex even when present in group members', async () => {
    const fakes = makeFakes();
    fakes.getGroupMembers.mockResolvedValue([SELF, 'other-pk']);
    // other-pk: undefined profile → stale + null memo → eligible → should emit
    fakes.loadProfile.mockResolvedValue(undefined);
    fakes.loadMemo.mockResolvedValue(null);

    await sweepStaleProfiles({
      groupIds: ['g1'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    // 'other-pk' should be emitted (stale + eligible)
    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
    expect(fakes.sendRumor).toHaveBeenCalledWith('g1', expect.stringContaining('"targetPubkey":"other-pk"'));
    // Self should never be loaded or emitted
    expect(fakes.loadProfile).not.toHaveBeenCalledWith('g1', SELF);
  });

  it('does NOT emit when isProfileStale returns false (fresh profile)', async () => {
    const fakes = makeFakes();
    fakes.getGroupMembers.mockResolvedValue(['fresh-pk']);
    const freshProfile: MemberProfile = {
      pubkeyHex: 'fresh-pk',
      nickname: 'F',
      avatar: null,      updatedAt: new Date(NOW).toISOString(), // age = 0 → not stale
    };
    fakes.loadProfile.mockResolvedValue(freshProfile);
    fakes.loadMemo.mockResolvedValue(null);

    await sweepStaleProfiles({
      groupIds: ['g1'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.sendRumor).not.toHaveBeenCalled();
    expect(fakes.recordEmitted).not.toHaveBeenCalled();
  });

  it('emits when profile is undefined (never seen → stale)', async () => {
    const fakes = makeFakes();
    fakes.getGroupMembers.mockResolvedValue(['unknown-pk']);
    fakes.loadProfile.mockResolvedValue(undefined);
    fakes.loadMemo.mockResolvedValue(null);

    await sweepStaleProfiles({
      groupIds: ['g1'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
    expect(fakes.recordEmitted).toHaveBeenCalledTimes(1);
    expect(fakes.recordEmitted).toHaveBeenCalledWith('g1', 'unknown-pk', NOW);
  });

  it('emits when profile is older than PROFILE_STALENESS_MS', async () => {
    const fakes = makeFakes();
    fakes.getGroupMembers.mockResolvedValue(['old-pk']);
    fakes.loadProfile.mockResolvedValue(undefined); // stale
    fakes.loadMemo.mockResolvedValue(null);

    await sweepStaleProfiles({
      groupIds: ['g1'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
    expect(fakes.recordEmitted).toHaveBeenCalledTimes(1);
  });

  it('does NOT emit when shouldEmitRequest returns false', async () => {
    const fakes = makeFakes();
    fakes.getGroupMembers.mockResolvedValue(['stale-pk']);
    fakes.loadProfile.mockResolvedValue(undefined); // stale
    fakes.loadMemo.mockResolvedValue({
      groupId: 'g1',
      targetPubkey: 'stale-pk',
      lastRequestAt: NOW - 1,
      lastAnsweredAt: NOW - 1, // answered 1ms ago → within dedupe window → skip
      attempts: 1,
    });

    await sweepStaleProfiles({
      groupIds: ['g1'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.sendRumor).not.toHaveBeenCalled();
    expect(fakes.recordEmitted).not.toHaveBeenCalled();
  });

  it('calls recordEmitted before sendRumor for each eligible member', async () => {
    const fakes = makeFakes();
    fakes.getGroupMembers.mockResolvedValue(['eligible-pk']);
    fakes.loadProfile.mockResolvedValue(undefined);
    fakes.loadMemo.mockResolvedValue(null);
    let recordCallTime = 0;
    let rumorCallTime = 0;
    fakes.recordEmitted.mockImplementation(async () => { recordCallTime = Date.now(); });
    fakes.sendRumor.mockImplementation(async () => { rumorCallTime = Date.now(); });

    await sweepStaleProfiles({
      groupIds: ['g1'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.recordEmitted).toHaveBeenCalled();
    expect(fakes.sendRumor).toHaveBeenCalled();
    // recordEmitted runs first (awaited before sendRumor)
    expect(recordCallTime).toBeLessThanOrEqual(rumorCallTime);
  });

  it('emits exactly one rumor per eligible member (no double-emission)', async () => {
    const fakes = makeFakes();
    // 'a': undefined → stale → emit
    // 'b': undefined → stale → emit
    // 'c': fresh profile (age=0) → NOT stale → skip
    fakes.getGroupMembers.mockResolvedValue(['a', 'b', 'c']);
    fakes.loadProfile
      .mockResolvedValueOnce(undefined) // a → stale
      .mockResolvedValueOnce(undefined) // b → stale
      .mockResolvedValueOnce({
        pubkeyHex: 'c',
        nickname: 'C',
        avatar: null,
        updatedAt: new Date(NOW).toISOString(), // age = 0 → fresh
      });
    fakes.loadMemo.mockResolvedValue(null);

    await sweepStaleProfiles({
      groupIds: ['g1'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.sendRumor).toHaveBeenCalledTimes(2);
    expect(fakes.recordEmitted).toHaveBeenCalledTimes(2);
    const [call1, call2] = fakes.sendRumor.mock.calls;
    expect(call1[0]).toBe('g1');
    expect(call1[1]).toContain('"targetPubkey":"a"');
    expect(call2[0]).toBe('g1');
    expect(call2[1]).toContain('"targetPubkey":"b"');
  });

  it('includes sinceUpdatedAt in the rumor content when a stored profile exists', async () => {
    const fakes = makeFakes();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const staleProfile: MemberProfile = {
      pubkeyHex: 'stale-pk',
      nickname: 'Stale',
      avatar: null,      updatedAt: new Date(NOW - SEVEN_DAYS - 1).toISOString(), // 8 days old → stale
    };
    fakes.getGroupMembers.mockResolvedValue(['stale-pk']);
    fakes.loadProfile.mockResolvedValue(staleProfile);
    fakes.loadMemo.mockResolvedValue(null);

    await sweepStaleProfiles({
      groupIds: ['g1'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
    const content = fakes.sendRumor.mock.calls[0][1];
    // Content is a JSON string (output of serialiseProfileRequest)
    expect(() => JSON.parse(content)).not.toThrow();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed.targetPubkey).toBe('stale-pk');
    expect(parsed.sinceUpdatedAt).toBe(staleProfile.updatedAt);
  });

  it('omits sinceUpdatedAt when no stored profile exists', async () => {
    const fakes = makeFakes();
    fakes.getGroupMembers.mockResolvedValue(['unknown-pk']);
    fakes.loadProfile.mockResolvedValue(undefined); // stale
    fakes.loadMemo.mockResolvedValue(null);

    await sweepStaleProfiles({
      groupIds: ['g1'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
    const content = fakes.sendRumor.mock.calls[0][1];
    expect(() => JSON.parse(content)).not.toThrow();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed.sinceUpdatedAt).toBeUndefined();
  });

  it('walks multiple groups independently', async () => {
    const fakes = makeFakes();
    fakes.getGroupMembers
      .mockResolvedValueOnce(['stale-pk']) // g1: one stale member
      .mockResolvedValueOnce([]); // g2: no members
    fakes.loadProfile.mockResolvedValue(undefined);
    fakes.loadMemo.mockResolvedValue(null);

    await sweepStaleProfiles({
      groupIds: ['g1', 'g2'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
    expect(fakes.sendRumor.mock.calls[0][0]).toBe('g1');
  });

  it('handles an empty groupIds array gracefully (no calls)', async () => {
    const fakes = makeFakes();

    await sweepStaleProfiles({
      groupIds: [],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.getGroupMembers).not.toHaveBeenCalled();
    expect(fakes.sendRumor).not.toHaveBeenCalled();
    expect(fakes.recordEmitted).not.toHaveBeenCalled();
  });

  it('handles a group with no members gracefully', async () => {
    const fakes = makeFakes();
    fakes.getGroupMembers.mockResolvedValue([]);

    await sweepStaleProfiles({
      groupIds: ['g1'],
      selfPubkeyHex: SELF,
      now: NOW,
      ...fakes,
    });

    expect(fakes.getGroupMembers).toHaveBeenCalledWith('g1');
    expect(fakes.sendRumor).not.toHaveBeenCalled();
    expect(fakes.recordEmitted).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleIncomingProfileRequest + notifyProfileObserved
// ---------------------------------------------------------------------------

const FAKE_SIGNED_EVENT: SignedProfileEvent = {
  id: 'aabbcc',
  pubkey: 'target-pk',
  created_at: 1700000000,
  kind: 0,
  tags: [],
  content: JSON.stringify({ nickname: 'Target', avatar: null, updatedAt: '2026-01-01T00:00:00.000Z' }),
  sig: 'deadbeef',
};

const PROFILE_WITH_SIGNED_EVENT: MemberProfile = {
  pubkeyHex: 'target-pk',
  nickname: 'Target',
  avatar: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  signedEvent: FAKE_SIGNED_EVENT,
};

function makeRelayFakes() {
  return {
    loadProfile: vi.fn<(groupId: string, targetPubkey: string) => Promise<MemberProfile | undefined>>(),
    sendRumor: vi.fn<(groupId: string, content: string) => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe('handleIncomingProfileRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does nothing when no cached profile exists (AC-037)', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue(undefined);

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: { type: 'profile_request', targetPubkey: 'target-pk', nonce: 'n1' },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    vi.runAllTimers();
    expect(fakes.sendRumor).not.toHaveBeenCalled();
  });

  it('does nothing when cached profile has no signedEvent (AC-037)', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue({
      pubkeyHex: 'target-pk',
      nickname: 'T',
      avatar: null,      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: { type: 'profile_request', targetPubkey: 'target-pk', nonce: 'n1' },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    vi.runAllTimers();
    expect(fakes.sendRumor).not.toHaveBeenCalled();
  });

  it('does not schedule when sinceUpdatedAt >= cached.updatedAt (AC-038)', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue(PROFILE_WITH_SIGNED_EVENT);

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: {
        type: 'profile_request',
        targetPubkey: 'target-pk',
        sinceUpdatedAt: '2026-01-01T00:00:00.000Z', // equal to cached.updatedAt
        nonce: 'n1',
      },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    vi.runAllTimers();
    expect(fakes.sendRumor).not.toHaveBeenCalled();
  });

  it('schedules relay when sinceUpdatedAt is absent (AC-033)', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue(PROFILE_WITH_SIGNED_EVENT);

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: { type: 'profile_request', targetPubkey: 'target-pk', nonce: 'n1' },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    expect(fakes.sendRumor).not.toHaveBeenCalled(); // timer not fired yet
    vi.runAllTimers();
    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
    expect(fakes.sendRumor).toHaveBeenCalledWith('g1', JSON.stringify(FAKE_SIGNED_EVENT));
  });

  it('schedules relay when cached.updatedAt > sinceUpdatedAt (AC-033)', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue(PROFILE_WITH_SIGNED_EVENT);

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: {
        type: 'profile_request',
        targetPubkey: 'target-pk',
        sinceUpdatedAt: '2025-12-01T00:00:00.000Z', // older than cached
        nonce: 'n1',
      },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    vi.runAllTimers();
    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
  });

  it('backoff delay is within [RELAY_BACKOFF_MIN_MS, RELAY_BACKOFF_MAX_MS]', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue(PROFILE_WITH_SIGNED_EVENT);

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: { type: 'profile_request', targetPubkey: 'target-pk', nonce: 'n1' },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    // Timer not fired before min backoff
    vi.advanceTimersByTime(RELAY_BACKOFF_MIN_MS - 1);
    // May or may not have fired depending on random value — but max must fire it
    vi.advanceTimersByTime(RELAY_BACKOFF_MAX_MS + 1);
    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
  });

  it('replaces existing pending timer when called twice for same target', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue(PROFILE_WITH_SIGNED_EVENT);

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: { type: 'profile_request', targetPubkey: 'target-pk', nonce: 'n1' },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: { type: 'profile_request', targetPubkey: 'target-pk', nonce: 'n2' },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    vi.runAllTimers();
    // Only one send — the second call replaced the first timer
    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
  });
});

describe('notifyProfileObserved', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does nothing when no pending timer exists', () => {
    // No scheduled relay — should not throw
    expect(() => {
      notifyProfileObserved({ groupId: 'g1', targetPubkey: 'nobody', observedUpdatedAt: '2026-01-01T00:00:00.000Z' });
    }).not.toThrow();
  });

  it('cancels pending relay when observedUpdatedAt equals scheduledForUpdatedAt (AC-035)', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue(PROFILE_WITH_SIGNED_EVENT);

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: { type: 'profile_request', targetPubkey: 'target-pk', nonce: 'n1' },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    notifyProfileObserved({
      groupId: 'g1',
      targetPubkey: 'target-pk',
      observedUpdatedAt: PROFILE_WITH_SIGNED_EVENT.updatedAt, // same age
    });

    vi.runAllTimers();
    expect(fakes.sendRumor).not.toHaveBeenCalled();
  });

  it('cancels pending relay when observedUpdatedAt is newer (AC-035)', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue(PROFILE_WITH_SIGNED_EVENT);

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: { type: 'profile_request', targetPubkey: 'target-pk', nonce: 'n1' },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    notifyProfileObserved({
      groupId: 'g1',
      targetPubkey: 'target-pk',
      observedUpdatedAt: '2026-06-01T00:00:00.000Z', // newer than cached '2026-01-01'
    });

    vi.runAllTimers();
    expect(fakes.sendRumor).not.toHaveBeenCalled();
  });

  it('does NOT cancel relay when observedUpdatedAt is older (AC-035)', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue(PROFILE_WITH_SIGNED_EVENT);

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: { type: 'profile_request', targetPubkey: 'target-pk', nonce: 'n1' },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    notifyProfileObserved({
      groupId: 'g1',
      targetPubkey: 'target-pk',
      observedUpdatedAt: '2025-01-01T00:00:00.000Z', // older than cached '2026-01-01'
    });

    vi.runAllTimers();
    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
  });

  it('only cancels matching (groupId, targetPubkey) — unrelated timers unaffected', async () => {
    const fakes = makeRelayFakes();
    fakes.loadProfile.mockResolvedValue(PROFILE_WITH_SIGNED_EVENT);

    await handleIncomingProfileRequest({
      groupId: 'g1',
      payload: { type: 'profile_request', targetPubkey: 'target-pk', nonce: 'n1' },
      selfPubkeyHex: 'self-pk',
      now: Date.now(),
      ...fakes,
    });

    // Notify for a different group — should NOT cancel g1's relay
    notifyProfileObserved({
      groupId: 'g2',
      targetPubkey: 'target-pk',
      observedUpdatedAt: PROFILE_WITH_SIGNED_EVENT.updatedAt,
    });

    vi.runAllTimers();
    expect(fakes.sendRumor).toHaveBeenCalledTimes(1);
  });
});