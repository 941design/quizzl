/**
 * Unit tests for the S9 (epic: invite-rescind-and-member-removal) post-removal
 * purge/clear gate and Remove-Member wiring's PURE, dependency-injectable
 * helpers exported from `app/pages/groups.tsx`:
 *
 *   - computeStillMember      — fresh, case-insensitive tree-membership check
 *   - runPostRemovalCleanup   — the purge/marker-clear gate (AC-MARKER-7/8, AC-PURGE-2/3/4)
 *   - performGroupMemberRemoval — the AC-REMOVE-1 shared removal helper
 *   - classifyRemovalResult   — the shared toast-routing decision
 *
 * `groups.tsx` is a page component (Chakra/Next imports) with no
 * jsdom/@testing-library/renderHook precedent in this repo (see
 * `groupsManageLinksDeepLink.test.ts`'s header comment) — so the
 * order-sensitive gate logic worth testing directly is extracted into
 * exported, dependency-injectable pure/async functions. Neither React nor
 * the groups page is mounted here.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  computeStillMember,
  runPostRemovalCleanup,
  performGroupMemberRemoval,
  classifyRemovalResult,
  type CancelPendingInvitationResult,
} from '@/pages/groups';

const GROUP_ID = 'g1';
const PUBKEY = 'aabbccddee';

describe('computeStillMember', () => {
  it('returns true (present) when the live member list contains the pubkey', () => {
    expect(computeStillMember(['aabbccddee', 'ff0011'], PUBKEY)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(computeStillMember(['AABBCCDDEE'], PUBKEY)).toBe(true);
    expect(computeStillMember(['aabbccddee'], 'AABBCCDDEE')).toBe(true);
  });

  it('returns false when the pubkey is absent from the live member list', () => {
    expect(computeStillMember(['ff0011'], PUBKEY)).toBe(false);
    expect(computeStillMember([], PUBKEY)).toBe(false);
  });

  it('fails CLOSED (returns true / "still a member") when live membership is unreadable (undefined)', () => {
    // An ambiguous read must never trigger a purge/marker-clear that could
    // destroy real data — the opposite polarity from LeaveGroupButton's
    // fail-closed direction, which blocks its own "abandon" branch on the
    // same undefined signal.
    expect(computeStillMember(undefined, PUBKEY)).toBe(true);
  });
});

describe('runPostRemovalCleanup — AC-MARKER-7/8, AC-PURGE-2/3/4', () => {
  it('does NOT call deleteMemberProfile or clearPendingDirectInvite when stillMember is true (AC-PURGE-4)', async () => {
    const deleteMemberProfile = vi.fn().mockResolvedValue(undefined);
    const clearPendingDirectInvite = vi.fn().mockResolvedValue(undefined);

    await runPostRemovalCleanup({
      groupId: GROUP_ID,
      pubkey: PUBKEY,
      stillMember: true,
      deleteMemberProfile,
      clearPendingDirectInvite,
    });

    expect(deleteMemberProfile).not.toHaveBeenCalled();
    expect(clearPendingDirectInvite).not.toHaveBeenCalled();
  });

  it('calls BOTH deleteMemberProfile and clearPendingDirectInvite with (groupId, pubkey) when stillMember is false', async () => {
    const deleteMemberProfile = vi.fn().mockResolvedValue(undefined);
    const clearPendingDirectInvite = vi.fn().mockResolvedValue(undefined);

    await runPostRemovalCleanup({
      groupId: GROUP_ID,
      pubkey: PUBKEY,
      stillMember: false,
      deleteMemberProfile,
      clearPendingDirectInvite,
    });

    expect(deleteMemberProfile).toHaveBeenCalledWith(GROUP_ID, PUBKEY);
    expect(clearPendingDirectInvite).toHaveBeenCalledWith(GROUP_ID, PUBKEY);
  });

  it('swallows (logs) a purge/clear failure instead of throwing — best-effort cleanup', async () => {
    const deleteMemberProfile = vi.fn().mockRejectedValue(new Error('idb error'));
    const clearPendingDirectInvite = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      runPostRemovalCleanup({
        groupId: GROUP_ID,
        pubkey: PUBKEY,
        stillMember: false,
        deleteMemberProfile,
        clearPendingDirectInvite,
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

function makeRemovalDeps(overrides: {
  result?: CancelPendingInvitationResult;
  liveMembers?: string[] | undefined;
} = {}) {
  const result: CancelPendingInvitationResult = overrides.result ?? { ok: true };
  const cancelPendingInvitation = vi.fn().mockResolvedValue(result);
  const getLiveMemberPubkeys = vi.fn().mockResolvedValue(overrides.liveMembers);
  const deleteMemberProfile = vi.fn().mockResolvedValue(undefined);
  const clearPendingDirectInvite = vi.fn().mockResolvedValue(undefined);
  return { cancelPendingInvitation, getLiveMemberPubkeys, deleteMemberProfile, clearPendingDirectInvite };
}

describe('performGroupMemberRemoval — AC-REMOVE-1 shared removal helper', () => {
  it('(a) ordinary committing removal, pubkey confirmed gone → purge+clear called', async () => {
    const deps = makeRemovalDeps({ result: { ok: true }, liveMembers: ['someone-else'] });

    const result = await performGroupMemberRemoval({
      groupId: GROUP_ID,
      pubkey: PUBKEY,
      ...deps,
    });

    expect(result).toEqual({ ok: true });
    expect(deps.cancelPendingInvitation).toHaveBeenCalledWith(GROUP_ID, PUBKEY, undefined);
    expect(deps.getLiveMemberPubkeys).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.deleteMemberProfile).toHaveBeenCalledWith(GROUP_ID, PUBKEY);
    expect(deps.clearPendingDirectInvite).toHaveBeenCalledWith(GROUP_ID, PUBKEY);
  });

  it('(b) raceDetected short-circuit ("already not pending" shape), pubkey confirmed gone → purge+clear STILL called', async () => {
    const deps = makeRemovalDeps({
      result: { ok: true, raceDetected: true },
      liveMembers: ['someone-else'],
    });

    await performGroupMemberRemoval({ groupId: GROUP_ID, pubkey: PUBKEY, ...deps });

    // The AC-MARKER-8/PURGE-3 crux: gated on tree-membership, NOT on "this
    // client performed the commit" — raceDetected:true must not skip cleanup.
    expect(deps.deleteMemberProfile).toHaveBeenCalledWith(GROUP_ID, PUBKEY);
    expect(deps.clearPendingDirectInvite).toHaveBeenCalledWith(GROUP_ID, PUBKEY);
  });

  it('(b) raceDetected short-circuit (empty-leaf-indexes shape — identical result contract), pubkey confirmed gone → purge+clear STILL called', async () => {
    // cancelInvitationImpl.ts has two distinct internal raceDetected code
    // paths (already-not-pending at :56-63, empty leafIndexes at :80-83),
    // but both resolve the IDENTICAL { ok: true, raceDetected: true } shape
    // through the CancelPendingInvitationResult seam — this layer cannot
    // (and per the seam contract, must not need to) distinguish them.
    const deps = makeRemovalDeps({
      result: { ok: true, raceDetected: true },
      liveMembers: [],
    });

    await performGroupMemberRemoval({ groupId: GROUP_ID, pubkey: PUBKEY, ...deps });

    expect(deps.deleteMemberProfile).toHaveBeenCalledWith(GROUP_ID, PUBKEY);
    expect(deps.clearPendingDirectInvite).toHaveBeenCalledWith(GROUP_ID, PUBKEY);
  });

  it('(c) removal attempt FAILS and pubkey remains a member → purge+clear NOT called (AC-PURGE-4)', async () => {
    const deps = makeRemovalDeps({
      result: { ok: false, error: 'commit_failed' },
      liveMembers: [PUBKEY, 'someone-else'],
    });

    const result = await performGroupMemberRemoval({ groupId: GROUP_ID, pubkey: PUBKEY, ...deps });

    expect(result).toEqual({ ok: false, error: 'commit_failed' });
    expect(deps.deleteMemberProfile).not.toHaveBeenCalled();
    expect(deps.clearPendingDirectInvite).not.toHaveBeenCalled();
  });

  it('re-reads LIVE membership via getLiveMemberPubkeys, never a stale pre-removal snapshot', async () => {
    // Regression guard for VQ-S9-001: the gate must not be checkable against
    // a closure captured BEFORE the removal ran. getLiveMemberPubkeys is
    // called only AFTER cancelPendingInvitation resolves.
    const callOrder: string[] = [];
    const cancelPendingInvitation = vi.fn().mockImplementation(async () => {
      callOrder.push('cancelPendingInvitation');
      return { ok: true };
    });
    const getLiveMemberPubkeys = vi.fn().mockImplementation(async () => {
      callOrder.push('getLiveMemberPubkeys');
      return [];
    });
    const deleteMemberProfile = vi.fn().mockResolvedValue(undefined);
    const clearPendingDirectInvite = vi.fn().mockResolvedValue(undefined);

    await performGroupMemberRemoval({
      groupId: GROUP_ID,
      pubkey: PUBKEY,
      cancelPendingInvitation,
      getLiveMemberPubkeys,
      deleteMemberProfile,
      clearPendingDirectInvite,
    });

    expect(callOrder).toEqual(['cancelPendingInvitation', 'getLiveMemberPubkeys']);
  });

  it('passes sendAnnouncement through to cancelPendingInvitation unchanged', async () => {
    const sendAnnouncement = vi.fn().mockResolvedValue(undefined);
    const deps = makeRemovalDeps({ result: { ok: true }, liveMembers: [] });

    await performGroupMemberRemoval({
      groupId: GROUP_ID,
      pubkey: PUBKEY,
      sendAnnouncement,
      ...deps,
    });

    expect(deps.cancelPendingInvitation).toHaveBeenCalledWith(GROUP_ID, PUBKEY, sendAnnouncement);
  });
});

describe('classifyRemovalResult — shared toast-routing (onCancelInvite AND onRemoveMember)', () => {
  it('classifies ok + raceDetected as raceNotice', () => {
    expect(classifyRemovalResult({ ok: true, raceDetected: true })).toBe('raceNotice');
  });

  it('classifies ok + announcementError (no raceDetected) as announcementWarning', () => {
    expect(classifyRemovalResult({ ok: true, announcementError: 'boom' })).toBe('announcementWarning');
  });

  it('classifies bare ok:true as success', () => {
    expect(classifyRemovalResult({ ok: true })).toBe('success');
  });

  it('classifies ok:false as error', () => {
    expect(classifyRemovalResult({ ok: false, error: 'commit_failed' })).toBe('error');
  });

  it('raceDetected takes priority over announcementError when (hypothetically) both are set', () => {
    expect(classifyRemovalResult({ ok: true, raceDetected: true, announcementError: 'x' })).toBe('raceNotice');
  });
});

describe('AC-REMOVE-1: onCancelInvite and onRemoveMember route through ONE shared helper', () => {
  it('performGroupMemberRemoval is the single exported removal entrypoint both handlers call — verified by construction: exactly one call to cancelPendingInvitation per invocation, never a second/parallel MLS-remove path', async () => {
    const deps = makeRemovalDeps({ result: { ok: true }, liveMembers: [] });

    await performGroupMemberRemoval({ groupId: GROUP_ID, pubkey: PUBKEY, ...deps });

    expect(deps.cancelPendingInvitation).toHaveBeenCalledTimes(1);
  });
});
