import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemberProfile } from '@/src/types';

vi.mock('@internet-privacy/marmot-ts', () => ({
  getGroupMembers: vi.fn(() => ['aabbcc', 'ddeeff']),
  getPubkeyLeafNodeIndexes: vi.fn(() => [0]),
  Proposals: {
    proposeUpdateMetadata: vi.fn((opts: object) => ({ type: 'updateMetadata', ...opts })),
  },
}));

const { isPendingMemberImpl, cancelPendingInvitationImpl } = await import(
  '@/src/lib/marmot/cancelInvitationImpl'
);

const INVITEE = 'aabbcc';
const SELF = 'ddeeff';

function makeProfile(pubkeyHex: string): MemberProfile {
  return { pubkeyHex, groupId: 'g1', nickname: 'Test', updatedAt: 0 };
}

function makeDeps(overrides: Partial<Parameters<typeof cancelPendingInvitationImpl>[0]> = {}) {
  const mockCommit = vi.fn().mockResolvedValue(undefined);
  const mockState = {};
  const mockGroup = {
    state: mockState,
    groupData: { adminPubkeys: [INVITEE, SELF] },
    commit: mockCommit,
  };
  return {
    getGroup: vi.fn().mockResolvedValue(mockGroup),
    loadMemberProfiles: vi.fn().mockResolvedValue([]),
    getGroupMembers: vi.fn().mockReturnValue([INVITEE, SELF]),
    getPubkeyLeafNodeIndexes: vi.fn().mockReturnValue([0]),
    Proposals: {
      proposeUpdateMetadata: vi.fn((opts: object) => ({ type: 'meta', ...opts })),
    },
    persistGroup: vi.fn().mockResolvedValue(undefined),
    getStoredGroup: vi.fn().mockReturnValue({ id: 'g1', name: 'G', createdAt: 0, relays: [], memberPubkeys: [INVITEE, SELF] }),
    reloadGroups: vi.fn().mockResolvedValue(undefined),
    markBackupDirty: vi.fn(),
    selfPubkeyHex: SELF,
    mockCommit,
    ...overrides,
  };
}

describe('isPendingMemberImpl', () => {
  it('returns true when member exists in MLS but has no profile entry', async () => {
    const deps = makeDeps();
    deps.getGroupMembers.mockReturnValue([INVITEE]);
    deps.loadMemberProfiles.mockResolvedValue([]);
    const result = await isPendingMemberImpl(deps, 'g1', INVITEE);
    expect(result).toBe(true);
  });

  it('returns false when member has a profile entry', async () => {
    const deps = makeDeps();
    deps.getGroupMembers.mockReturnValue([INVITEE]);
    deps.loadMemberProfiles.mockResolvedValue([makeProfile(INVITEE)]);
    const result = await isPendingMemberImpl(deps, 'g1', INVITEE);
    expect(result).toBe(false);
  });

  it('returns false when pubkey is not in MLS member list', async () => {
    const deps = makeDeps();
    deps.getGroupMembers.mockReturnValue([SELF]);
    deps.loadMemberProfiles.mockResolvedValue([]);
    const result = await isPendingMemberImpl(deps, 'g1', INVITEE);
    expect(result).toBe(false);
  });

  it('returns false when getGroup returns null', async () => {
    const deps = makeDeps();
    deps.getGroup.mockResolvedValue(null);
    const result = await isPendingMemberImpl(deps, 'g1', INVITEE);
    expect(result).toBe(false);
  });
});

describe('cancelPendingInvitationImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: commit called once with Remove proposals, markBackupDirty and reloadGroups called, announcement sent', async () => {
    const deps = makeDeps();
    deps.getGroupMembers.mockReturnValue([INVITEE, SELF]);
    deps.loadMemberProfiles.mockResolvedValue([]);
    deps.getPubkeyLeafNodeIndexes.mockReturnValue([0]);

    const sendAnnouncement = vi.fn().mockResolvedValue(undefined);
    const result = await cancelPendingInvitationImpl(deps, 'g1', INVITEE, sendAnnouncement);

    expect(result).toEqual({ ok: true });
    expect(deps.mockCommit).toHaveBeenCalledTimes(1);
    // Verify Remove proposal is in extraProposals
    const commitCall = deps.mockCommit.mock.calls[0][0];
    expect(commitCall.extraProposals.some((p: any) => p.proposalType === 3 && p.remove?.removed === 0)).toBe(true);
    expect(deps.markBackupDirty).toHaveBeenCalledWith(true);
    expect(deps.reloadGroups).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendAnnouncement).toHaveBeenCalledTimes(1);
    const announcementArg = JSON.parse(sendAnnouncement.mock.calls[0][0]);
    expect(announcementArg).toEqual({ type: 'invite_cancelled', pubkey: INVITEE, by: SELF });
  });

  it('commit-throws path: returns { ok: false }, sendAnnouncement not called', async () => {
    const deps = makeDeps();
    deps.getGroupMembers.mockReturnValue([INVITEE, SELF]);
    deps.loadMemberProfiles.mockResolvedValue([]);
    deps.getPubkeyLeafNodeIndexes.mockReturnValue([0]);
    deps.mockCommit.mockRejectedValue(new Error('commit failed'));

    const sendAnnouncement = vi.fn().mockResolvedValue(undefined);
    const result = await cancelPendingInvitationImpl(deps, 'g1', INVITEE, sendAnnouncement);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('commit failed');
    await new Promise((r) => setTimeout(r, 0));
    expect(sendAnnouncement).not.toHaveBeenCalled();
  });

  it('already-not-a-member path: returns { ok: true, raceDetected: true }, commit not called', async () => {
    const deps = makeDeps();
    // Member NOT in MLS list → isPendingMember returns false
    deps.getGroupMembers.mockReturnValue([SELF]);
    deps.loadMemberProfiles.mockResolvedValue([]);

    const result = await cancelPendingInvitationImpl(deps, 'g1', INVITEE);

    expect(result).toEqual({ ok: true, raceDetected: true });
    expect(deps.mockCommit).not.toHaveBeenCalled();
  });

  it('race-guard path: member has profile (just came online) → raceDetected, no commit', async () => {
    const deps = makeDeps();
    deps.getGroupMembers.mockReturnValue([INVITEE, SELF]);
    deps.loadMemberProfiles.mockResolvedValue([makeProfile(INVITEE)]);

    const result = await cancelPendingInvitationImpl(deps, 'g1', INVITEE);

    expect(result).toEqual({ ok: true, raceDetected: true });
    expect(deps.mockCommit).not.toHaveBeenCalled();
  });

  it('leaf-not-found path: getPubkeyLeafNodeIndexes returns [] → raceDetected, no commit', async () => {
    const deps = makeDeps();
    deps.getGroupMembers.mockReturnValue([INVITEE, SELF]);
    deps.loadMemberProfiles.mockResolvedValue([]);
    deps.getPubkeyLeafNodeIndexes.mockReturnValue([]);

    const result = await cancelPendingInvitationImpl(deps, 'g1', INVITEE);

    expect(result).toEqual({ ok: true, raceDetected: true });
    expect(deps.mockCommit).not.toHaveBeenCalled();
  });
});
