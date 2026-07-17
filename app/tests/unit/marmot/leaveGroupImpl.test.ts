import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: leaveGroupImpl has zero top-level imports from marmot-ts or context —
// getGroup/getGroupMembers/sendRumorSafe/buildRumor are all injected via the
// Deps interface. We therefore do NOT need a vi.mock('@internet-privacy/marmot-ts')
// at the top of this file, mirroring grantAdminImpl.test.ts.

const { leaveGroupImpl } = await import('@/src/lib/marmot/leaveGroupImpl');

const SELF = 'alice';
const OTHER = 'bob';
const GROUP_ID = 'group-1';

function makeMlsGroup(overrides: { sendApplicationRumor?: ReturnType<typeof vi.fn> } = {}) {
  return {
    state: { opaque: 'live-mls-state' },
    sendApplicationRumor: overrides.sendApplicationRumor ?? vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(
  overrides: {
    mlsGroup?: ReturnType<typeof makeMlsGroup> | null;
    members?: string[];
    sendRumorSafeImpl?: (...args: unknown[]) => Promise<void>;
  } = {},
) {
  const mlsGroup = overrides.mlsGroup === undefined ? makeMlsGroup() : overrides.mlsGroup;
  const members = overrides.members ?? [SELF];

  const sendRumorSafe = vi.fn(overrides.sendRumorSafeImpl ?? (async () => {}));
  const buildRumor = vi.fn((kind: number, content: string, pubkey: string, tags: string[][] = []) => ({
    id: 'stub-id',
    kind,
    content,
    pubkey,
    tags,
  }));

  return {
    getGroup: vi.fn().mockResolvedValue(mlsGroup),
    getGroupMembers: vi.fn().mockReturnValue(members),
    sendRumorSafe,
    buildRumor,
    removeGroupFromStorage: vi.fn().mockResolvedValue(undefined),
    clearMemberProfiles: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn().mockResolvedValue(undefined),
    clearPollData: vi.fn().mockResolvedValue(undefined),
    clearGroupMedia: vi.fn().mockResolvedValue(undefined),
    clearProfileRequestMemos: vi.fn().mockResolvedValue(undefined),
    clearUnreadGroup: vi.fn(),
    clearPendingJoinRequestsForGroup: vi.fn().mockResolvedValue(undefined),
    clearInviteLinksForGroup: vi.fn().mockResolvedValue(undefined),
    reloadGroups: vi.fn().mockResolvedValue(undefined),
    markBackupDirty: vi.fn(),
    // Exposed for assertions against the mock passed to getGroup.
    mlsGroup,
  };
}

describe('leaveGroupImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-SEND-1: solo group — neither the kind-13 nor the kind-9 send fires.
  it('AC-SEND-1: solo group (last member) — neither kind-13 nor kind-9 is sent', async () => {
    const deps = makeDeps({ members: [SELF] });

    const result = await leaveGroupImpl(deps, GROUP_ID, SELF);

    expect(result).toBe(true);
    expect(deps.sendRumorSafe).not.toHaveBeenCalled();
    expect(deps.mlsGroup!.sendApplicationRumor).not.toHaveBeenCalled();
  });

  // AC-SEND-2: multi-member group — both sends still fire, unchanged. A
  // genuinely distinct fixture from AC-SEND-1's (different members array),
  // so the send-skip and send-proceed branches are independently exercised.
  it('AC-SEND-2: two-member group — both kind-13 and kind-9 are sent exactly once', async () => {
    const deps = makeDeps({ members: [SELF, OTHER] });

    const result = await leaveGroupImpl(deps, GROUP_ID, SELF);

    expect(result).toBe(true);
    expect(deps.sendRumorSafe).toHaveBeenCalledTimes(1);
    expect(deps.mlsGroup!.sendApplicationRumor).toHaveBeenCalledTimes(1);

    // kind-13 leave-intent rumor
    const [, kind13Rumor] = deps.sendRumorSafe.mock.calls[0];
    expect(kind13Rumor.kind).toBe(13);

    // kind-9 announcement rumor
    const kind9Rumor = (deps.mlsGroup!.sendApplicationRumor as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(kind9Rumor.kind).toBe(9);
  });

  // AC-PURGE-1: both new leak-fixing clears fire on the abandon (solo) path.
  it('AC-PURGE-1: solo/abandon path clears pending join requests and invite links', async () => {
    const deps = makeDeps({ members: [SELF] });

    await leaveGroupImpl(deps, GROUP_ID, SELF);

    expect(deps.clearPendingJoinRequestsForGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearInviteLinksForGroup).toHaveBeenCalledWith(GROUP_ID);
  });

  // AC-PURGE-1: both new leak-fixing clears fire on the normal (multi-member) path too —
  // neither purge call is conditioned on which send branch was taken.
  it('AC-PURGE-1: multi-member/normal path clears pending join requests and invite links', async () => {
    const deps = makeDeps({ members: [SELF, OTHER] });

    await leaveGroupImpl(deps, GROUP_ID, SELF);

    expect(deps.clearPendingJoinRequestsForGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearInviteLinksForGroup).toHaveBeenCalledWith(GROUP_ID);
  });

  // AC-PURGE-1: the full pre-existing purge sequence still runs unconditionally.
  it('AC-PURGE-1: runs the full purge sequence including reloadGroups then markBackupDirty', async () => {
    const deps = makeDeps({ members: [SELF] });

    await leaveGroupImpl(deps, GROUP_ID, SELF);

    expect(deps.removeGroupFromStorage).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearMemberProfiles).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearMessages).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearPollData).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearGroupMedia).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearProfileRequestMemos).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearUnreadGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.reloadGroups).toHaveBeenCalledTimes(1);
    expect(deps.markBackupDirty).toHaveBeenCalledWith(true);

    // reloadGroups before markBackupDirty, per the grantAdmin/renameGroup convention.
    const reloadOrder = deps.reloadGroups.mock.invocationCallOrder[0];
    const markDirtyOrder = deps.markBackupDirty.mock.invocationCallOrder[0];
    expect(reloadOrder).toBeLessThan(markDirtyOrder);
  });

  // AC-STRUCT-3: last-member determination reads live state fetched WITHIN
  // this call (getGroupMembers(mlsGroup.state)) — never a caller-passed value.
  // leaveGroupImpl's signature takes no memberPubkeys/isLastMember parameter,
  // so the only way to prove this is to assert getGroupMembers was invoked
  // with the exact state object belonging to the mlsGroup this call fetched.
  it('AC-STRUCT-3: derives membership from a fresh getGroupMembers(mlsGroup.state) read', async () => {
    const deps = makeDeps({ members: [SELF] });

    await leaveGroupImpl(deps, GROUP_ID, SELF);

    expect(deps.getGroupMembers).toHaveBeenCalledTimes(1);
    expect(deps.getGroupMembers).toHaveBeenCalledWith(deps.mlsGroup!.state);
  });

  // R2 (fail-closed, opposite direction from the modal decision): when the
  // group can't be read at all, there is nothing to send with — no sends are
  // attempted (send is physically impossible without an mlsGroup reference)
  // — but the purge still proceeds unconditionally.
  it('no mlsGroup: getGroup resolves null — no sends attempted, purge still runs', async () => {
    const deps = makeDeps({ mlsGroup: null });

    const result = await leaveGroupImpl(deps, GROUP_ID, SELF);

    expect(result).toBe(true);
    expect(deps.getGroupMembers).not.toHaveBeenCalled();
    expect(deps.sendRumorSafe).not.toHaveBeenCalled();
    expect(deps.removeGroupFromStorage).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearPendingJoinRequestsForGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearInviteLinksForGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.reloadGroups).toHaveBeenCalledTimes(1);
  });

  // A failed kind-13 send must not block the purge — caught and logged.
  it('kind-13 send failure is caught: purge still completes, function still returns true', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = makeDeps({
      members: [SELF, OTHER],
      sendRumorSafeImpl: async () => {
        throw new Error('unapplied proposals');
      },
    });

    const result = await leaveGroupImpl(deps, GROUP_ID, SELF);

    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    expect(deps.removeGroupFromStorage).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.reloadGroups).toHaveBeenCalledTimes(1);
    expect(deps.markBackupDirty).toHaveBeenCalledWith(true);

    warnSpy.mockRestore();
  });

  // The kind-9 send is fire-and-forget: a rejection must not surface as an
  // unhandled rejection or block the purge.
  it('kind-9 send failure does not block the purge', async () => {
    const deps = makeDeps({
      members: [SELF, OTHER],
      mlsGroup: makeMlsGroup({ sendApplicationRumor: vi.fn().mockRejectedValue(new Error('network')) }),
    });

    const result = await leaveGroupImpl(deps, GROUP_ID, SELF);

    expect(result).toBe(true);
    expect(deps.removeGroupFromStorage).toHaveBeenCalledWith(GROUP_ID);
  });

  // S3/F1 gate fix: getGroupMembers reads live MLS ratchet state synchronously
  // and can throw on corrupt/unparseable state. That must not abort the purge —
  // the same fail-closed contract as an unreadable mlsGroup (R2 above): members
  // becomes undefined, isLastMember is false, send-anyway is attempted, and the
  // purge — including the two leak-fixing clears — still runs unconditionally.
  it('corrupt MLS state: getGroupMembers throws — purge still completes, function still returns true', async () => {
    const deps = makeDeps({ members: [SELF, OTHER] });
    deps.getGroupMembers.mockImplementation(() => {
      throw new Error('corrupt state');
    });

    const result = await leaveGroupImpl(deps, GROUP_ID, SELF);

    expect(result).toBe(true);
    expect(deps.removeGroupFromStorage).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearPendingJoinRequestsForGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.clearInviteLinksForGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(deps.reloadGroups).toHaveBeenCalledTimes(1);
  });
});
