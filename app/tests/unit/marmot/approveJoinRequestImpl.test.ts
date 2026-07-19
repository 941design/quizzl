/**
 * Unit tests for `approveJoinRequestImpl` (epic invite-link-lifecycle, story
 * S2 — AC-USAGE-1, AC-USAGE-2, AC-USAGE-3).
 *
 * `approveJoinRequestImpl` is the extracted, dependency-injected body of
 * MarmotContext.tsx's `approveJoinRequest` useCallback (see the exported
 * function's doc comment in that file for why the extraction exists: this
 * repo has no jsdom/@testing-library/renderHook precedent, and a
 * useCallback-wrapped closure cannot be invoked outside a live render —
 * pendingRequestsSection.test.ts's own comment already notes MarmotContext
 * "is difficult to unit test" without an extraction seam). Importing
 * MarmotContext.tsx directly (rather than mocking it) exercises the REAL
 * production function, not a hand-rolled stand-in.
 *
 * MarmotContext.tsx pulls in `@chakra-ui/react` and other browser-oriented
 * imports at module scope, but none of that executes DOM-dependent code at
 * plain import time (verified: importing the module under vitest's default
 * node environment succeeds without jsdom) — only rendering the component
 * would need a DOM, and this test never renders it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingJoinRequest } from '@/src/lib/marmot/joinRequestStorage';

const { approveJoinRequestImpl } = await import('@/src/context/MarmotContext');

function makeRequest(overrides: Partial<PendingJoinRequest> = {}): PendingJoinRequest {
  return {
    pubkeyHex: 'requester-pk',
    nonce: 'link-nonce',
    groupId: 'group-1',
    receivedAt: 1000,
    nickname: 'Alice',
    eventId: 'evt-1',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Parameters<typeof approveJoinRequestImpl>[0]> = {}) {
  return {
    inviteByNpub: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
    pubkeyToNpub: vi.fn((pubkeyHex: string) => `npub-${pubkeyHex}`),
    deletePendingJoinRequest: vi.fn(async () => {}),
    incrementInviteLinkUsage: vi.fn(async () => {}),
    decrementJoinRequest: vi.fn(),
    filterPendingRequest: vi.fn(),
    mergeMemberProfile: vi.fn(async () => true),
    bumpProfileVersion: vi.fn(),
    ...overrides,
  };
}

describe('approveJoinRequestImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── AC-USAGE-1 ─────────────────────────────────────────────────────────

  it('AC-USAGE-1: calls incrementInviteLinkUsage(request.nonce) when inviteByNpub resolves {ok: true}', async () => {
    const deps = makeDeps({ inviteByNpub: vi.fn(async () => ({ ok: true })) });
    const request = makeRequest({ nonce: 'the-nonce' });

    const result = await approveJoinRequestImpl(deps, request);

    expect(result).toEqual({ ok: true });
    expect(deps.incrementInviteLinkUsage).toHaveBeenCalledTimes(1);
    expect(deps.incrementInviteLinkUsage).toHaveBeenCalledWith('the-nonce');
  });

  it('AC-USAGE-1: does NOT call incrementInviteLinkUsage when inviteByNpub resolves {ok: false, error}', async () => {
    const deps = makeDeps({
      inviteByNpub: vi.fn(async () => ({ ok: false, error: 'invite_failed' })),
    });
    const request = makeRequest();

    const result = await approveJoinRequestImpl(deps, request);

    expect(result).toEqual({ ok: false, error: 'invite_failed' });
    expect(deps.incrementInviteLinkUsage).not.toHaveBeenCalled();
  });

  // ── AC-USAGE-2 ─────────────────────────────────────────────────────────
  // Approval must complete regardless of link liveness — this function
  // never reads getInviteLink/isExpired at all (source-level guarantee: the
  // deps type has no such dependency to begin with), so the only way link
  // absence/expiry can affect this function is via incrementInviteLinkUsage's
  // own no-op contract (AC-USAGE-3), never as a precondition gating approval.

  it('AC-USAGE-2: resolves {ok: true} and completes approval (delete pending request, decrement badge, prune local state) when inviteByNpub succeeds — approval has no getInviteLink/isExpired dependency to gate on', async () => {
    const deps = makeDeps();
    const request = makeRequest({ groupId: 'group-42', eventId: 'evt-42' });

    const result = await approveJoinRequestImpl(deps, request);

    expect(result).toEqual({ ok: true });
    expect(deps.deletePendingJoinRequest).toHaveBeenCalledWith('evt-42');
    expect(deps.decrementJoinRequest).toHaveBeenCalledWith('group-42');
    expect(deps.filterPendingRequest).toHaveBeenCalledWith('group-42', 'evt-42');
  });

  it('AC-USAGE-2: does NOT delete the pending request, decrement the badge, or prune state when inviteByNpub fails', async () => {
    const deps = makeDeps({ inviteByNpub: vi.fn(async () => ({ ok: false, error: 'boom' })) });
    const request = makeRequest();

    await approveJoinRequestImpl(deps, request);

    expect(deps.deletePendingJoinRequest).not.toHaveBeenCalled();
    expect(deps.decrementJoinRequest).not.toHaveBeenCalled();
    expect(deps.filterPendingRequest).not.toHaveBeenCalled();
  });

  // ── AC-USAGE-3 ─────────────────────────────────────────────────────────
  // Exercises the REAL S1 incrementInviteLinkUsage (not a mock) against a
  // nonce that resolves to nothing, per the module-ownership "do not
  // reimplement, consume the real export" scope note — proves the no-op
  // contract end-to-end rather than assuming it.

  it('AC-USAGE-3: completes without throwing when the referenced link is absent, using the REAL incrementInviteLinkUsage from inviteLinkStorage (not a mock)', async () => {
    vi.resetModules();
    vi.doMock('idb-keyval', () => ({
      createStore: vi.fn(() => 'mock-store'),
      get: vi.fn(async () => undefined), // nonce never resolves — link "deleted"
      set: vi.fn(async () => {
        throw new Error('set() must never be called for a nonce that does not resolve');
      }),
      del: vi.fn(async () => {}),
      entries: vi.fn(async () => []),
      clear: vi.fn(async () => {}),
    }));

    const { incrementInviteLinkUsage } = await import('@/src/lib/marmot/inviteLinkStorage');
    const deps = makeDeps({ incrementInviteLinkUsage });
    const request = makeRequest({ nonce: 'deleted-link-nonce' });

    await expect(approveJoinRequestImpl(deps, request)).resolves.toEqual({ ok: true });
    // The no-op is the only visible effect of the link's absence — approval
    // completion still ran normally.
    expect(deps.deletePendingJoinRequest).toHaveBeenCalledWith(request.eventId);
    expect(deps.decrementJoinRequest).toHaveBeenCalledWith(request.groupId);

    vi.doUnmock('idb-keyval');
    vi.resetModules();
  });

  // ── Ordering guarantee (VQ-S2-005) ──────────────────────────────────────

  it('calls inviteByNpub exactly once and never calls incrementInviteLinkUsage before inviteByNpub resolves', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      inviteByNpub: vi.fn(async () => {
        callOrder.push('inviteByNpub');
        return { ok: true };
      }),
      incrementInviteLinkUsage: vi.fn(async () => {
        callOrder.push('incrementInviteLinkUsage');
      }),
    });

    await approveJoinRequestImpl(deps, makeRequest());

    expect(deps.inviteByNpub).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['inviteByNpub', 'incrementInviteLinkUsage']);
  });

  // ── Gate-remediation regression (Finding 1) ─────────────────────────────
  // A best-effort incrementInviteLinkUsage failure must never block approval
  // cleanup: the requester has already been invited by inviteByNpub, so
  // leaving the pending request behind would make it re-approvable.

  it('Finding 1: still deletes the pending request, decrements the badge, prunes state, and reports success when incrementInviteLinkUsage throws after inviteByNpub succeeds', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = makeDeps({
      inviteByNpub: vi.fn(async () => ({ ok: true })),
      incrementInviteLinkUsage: vi.fn(async () => {
        throw new Error('IndexedDB write failed (quota)');
      }),
    });
    const request = makeRequest({ groupId: 'group-7', eventId: 'evt-7', nonce: 'nonce-7' });

    const result = await approveJoinRequestImpl(deps, request);

    expect(result).toEqual({ ok: true });
    expect(deps.incrementInviteLinkUsage).toHaveBeenCalledWith('nonce-7');
    expect(deps.deletePendingJoinRequest).toHaveBeenCalledWith('evt-7');
    expect(deps.decrementJoinRequest).toHaveBeenCalledWith('group-7');
    expect(deps.filterPendingRequest).toHaveBeenCalledWith('group-7', 'evt-7');
    warnSpy.mockRestore();
  });

  // ── Provisional profile seed (join-request name shown, not npub) ─────────
  // On approval the requester's self-provided name (carried in the join
  // request, shown for confirmation) is persisted so the new member row shows
  // the name immediately instead of a raw npub — the same "name first, avatar
  // later" behavior as accepting a contact card.

  it('seeds a PROVISIONAL member profile from the join-request nickname after a successful invite', async () => {
    const deps = makeDeps();
    const request = makeRequest({
      groupId: 'group-9',
      pubkeyHex: 'requester-pk-9',
      nickname: 'Invitee',
    });

    const result = await approveJoinRequestImpl(deps, request);

    expect(result).toEqual({ ok: true });
    expect(deps.mergeMemberProfile).toHaveBeenCalledTimes(1);
    expect(deps.mergeMemberProfile).toHaveBeenCalledWith('group-9', {
      pubkeyHex: 'requester-pk-9',
      nickname: 'Invitee',
      avatar: null,
      // Epoch-0 so the member's real signed profile always wins LWW and the
      // seed is always treated as stale by the profile-request sweep.
      updatedAt: new Date(0).toISOString(),
      provisional: true,
    });
    // Open group detail views must re-read member profiles to pick up the seed.
    expect(deps.bumpProfileVersion).toHaveBeenCalledTimes(1);
  });

  it('does NOT seed a member profile when inviteByNpub fails', async () => {
    const deps = makeDeps({ inviteByNpub: vi.fn(async () => ({ ok: false, error: 'boom' })) });
    const request = makeRequest({ nickname: 'Invitee' });

    await approveJoinRequestImpl(deps, request);

    expect(deps.mergeMemberProfile).not.toHaveBeenCalled();
    expect(deps.bumpProfileVersion).not.toHaveBeenCalled();
  });

  it('does NOT seed a member profile when the join request carried no nickname', async () => {
    const deps = makeDeps();
    const request = makeRequest({ nickname: undefined });

    const result = await approveJoinRequestImpl(deps, request);

    expect(result).toEqual({ ok: true });
    expect(deps.mergeMemberProfile).not.toHaveBeenCalled();
    expect(deps.bumpProfileVersion).not.toHaveBeenCalled();
  });

  it('best-effort: a mergeMemberProfile failure never fails an approval whose invite already succeeded', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = makeDeps({
      mergeMemberProfile: vi.fn(async () => {
        throw new Error('IndexedDB write failed (quota)');
      }),
    });
    const request = makeRequest({ groupId: 'group-11', eventId: 'evt-11', nickname: 'Invitee' });

    const result = await approveJoinRequestImpl(deps, request);

    expect(result).toEqual({ ok: true });
    // Cleanup still ran despite the seed failure.
    expect(deps.deletePendingJoinRequest).toHaveBeenCalledWith('evt-11');
    expect(deps.decrementJoinRequest).toHaveBeenCalledWith('group-11');
    expect(deps.filterPendingRequest).toHaveBeenCalledWith('group-11', 'evt-11');
    // bumpProfileVersion is only reached after a successful merge, so a throw skips it.
    expect(deps.bumpProfileVersion).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
