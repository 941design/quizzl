import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: grantAdminImpl has zero top-level imports from marmot-ts or context —
// all dependencies are injected via the Deps interface. We therefore do NOT
// need a vi.mock('@internet-privacy/marmot-ts') at the top of this file.
// Proposals is passed in as part of Deps, making this test fully self-contained.

const { grantAdminImpl, isSuperset } = await import('@/src/lib/marmot/grantAdminImpl');

const TARGET = 'ccddee';
const EXISTING_ADMIN = 'aabbcc';
const OTHER_CONCURRENT = '112233';

type CommitArgs = { extraProposals: Array<{ adminPubkeys?: string[] }> };

function makeCommit(impl: (args: CommitArgs) => Promise<void> = async () => {}) {
  return vi.fn().mockImplementation(impl);
}

function makeDeps(
  overrides: {
    adminPubkeys?: string[];
    commitImpl?: (args: CommitArgs) => Promise<void>;
    mockCommitFn?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const { adminPubkeys = [EXISTING_ADMIN], commitImpl, mockCommitFn } = overrides;
  const commit = mockCommitFn ?? makeCommit(commitImpl);
  const group = {
    state: {},
    groupData: { adminPubkeys },
    commit,
  };
  return {
    getGroup: vi.fn().mockResolvedValue(group),
    Proposals: {
      proposeUpdateMetadata: vi.fn((opts: { adminPubkeys: string[] }) => ({
        type: 'updateMetadata',
        ...opts,
      })),
    },
    reloadGroups: vi.fn().mockResolvedValue(undefined),
    markBackupDirty: vi.fn(),
    group,
    commit,
  };
}

describe('grantAdminImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // VQ-S3-001 / AC-GRANT-2
  it('happy path: grants admin, commits once, returns ok:true, reloadGroups and markBackupDirty called', async () => {
    const deps = makeDeps({ adminPubkeys: [EXISTING_ADMIN] });

    const result = await grantAdminImpl(deps, 'g1', TARGET);

    expect(result).toEqual({ ok: true });
    expect(deps.commit).toHaveBeenCalledTimes(1);

    // The commit received a proposal containing the union set (AC-GRANT-2).
    const commitCall = (deps.commit as ReturnType<typeof vi.fn>).mock.calls[0][0] as CommitArgs;
    const proposal = deps.Proposals.proposeUpdateMetadata.mock.calls[0][0] as { adminPubkeys: string[] };
    expect(proposal.adminPubkeys).toContain(EXISTING_ADMIN);
    expect(proposal.adminPubkeys).toContain(TARGET);
    expect(proposal.adminPubkeys).toHaveLength(2);

    expect(deps.reloadGroups).toHaveBeenCalledTimes(1);
    expect(deps.markBackupDirty).toHaveBeenCalledWith(true);

    // Verify commitCall structure to satisfy the VQ checklist
    expect(commitCall.extraProposals).toHaveLength(1);
  });

  // VQ-S3-011 / AC-GRANT-2 (idempotent branch)
  it('already-admin: returns ok:true idempotently, no commit', async () => {
    const deps = makeDeps({ adminPubkeys: [EXISTING_ADMIN, TARGET] });

    const result = await grantAdminImpl(deps, 'g1', TARGET);

    expect(result).toEqual({ ok: true });
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.reloadGroups).not.toHaveBeenCalled();
    expect(deps.markBackupDirty).not.toHaveBeenCalled();
  });

  // VQ-S3-011: case-insensitive idempotent check
  it('already-admin (case-insensitive): returns ok:true, no commit', async () => {
    const deps = makeDeps({ adminPubkeys: [EXISTING_ADMIN, TARGET.toUpperCase()] });

    const result = await grantAdminImpl(deps, 'g1', TARGET.toLowerCase());

    expect(result).toEqual({ ok: true });
    expect(deps.commit).not.toHaveBeenCalled();
  });

  // VQ-S3-002 / AC-GRANT-5: superset guard
  // Superset guard (AC-GRANT-5): the demotion_rejected branch in grantAdminImpl is a
  // refactor safety net — on the live grant path newSet = currentAdmins ∪ {target} is
  // always a superset, so the branch is unreachable through normal flow. Rather than
  // contort a scenario to force an impossible state, we test the guard's actual logic —
  // the exported isSuperset helper — directly. This covers the predicate that the
  // production guard delegates to, so a future refactor that weakens it is caught.
  describe('isSuperset (the superset-guard predicate, AC-GRANT-5)', () => {
    it('returns true when next contains every element of live', () => {
      expect(isSuperset(['alice', 'bob'], ['alice', 'bob', 'carol'])).toBe(true);
    });

    it('returns true for an equal set (no admin dropped)', () => {
      expect(isSuperset(['alice', 'bob'], ['alice', 'bob'])).toBe(true);
    });

    it('returns FALSE when next drops an existing admin (the demotion the guard rejects)', () => {
      expect(isSuperset(['alice', 'bob'], ['alice'])).toBe(false);
    });

    it('is case-insensitive — an admin in a different case still counts as present', () => {
      expect(isSuperset(['AAbbCC'], ['aabbcc', 'ccddee'])).toBe(true);
    });

    it('returns true for an empty live set (nothing to preserve)', () => {
      expect(isSuperset([], ['alice'])).toBe(true);
    });
  });

  it('group_not_found: getGroup returns null → error, no commit', async () => {
    const depsNull = makeDeps();
    depsNull.getGroup = vi.fn().mockResolvedValue(null);
    const r = await grantAdminImpl(depsNull, 'g1', TARGET);
    expect(r).toEqual({ ok: false, error: 'group_not_found' });
    expect(depsNull.commit).not.toHaveBeenCalled();
  });

  // VQ-S3-003 / AC-GRANT-7 (amended 2026-06-11): synchronous-throw retry path.
  // This exercises the SYNCHRONOUS commit() throw case ONLY — the rare path where
  // commit() rejects at call time (e.g. local unapplied proposals). It is NOT the
  // common concurrent-grant case: marmot-ts commit() does not throw when another
  // admin commits at the same epoch (both succeed locally; the fork resolves
  // asynchronously on the receiving side — see spec ## Amendments 2026-06-11).
  // What this test pins down is the load-bearing invariant that survives the
  // amendment: on a synchronous throw, the retry re-reads the LIVE adminPubkeys
  // and merges the target into THAT fresh set rather than re-using the stale one.
  it('synchronous-throw retry: first commit throws, retry re-reads live set and merges target into it, commit called exactly twice', async () => {
    // Setup: initial live adminPubkeys = [EXISTING_ADMIN]
    // First getGroup call: state with adminPubkeys = [EXISTING_ADMIN]
    // First commit() throws synchronously; second getGroup call returns a set that
    // grew to [EXISTING_ADMIN, OTHER_CONCURRENT] (another grant landed in between).
    // Expected: second commit receives the UNION of the fresh live set and our
    // target: [EXISTING_ADMIN, OTHER_CONCURRENT, TARGET] — proving the re-read+merge,
    // not a stale-snapshot re-commit.

    const commitMock = vi.fn()
      .mockRejectedValueOnce(new Error('epoch-conflict'))
      .mockResolvedValueOnce(undefined);

    const groupFirstRead = {
      state: {},
      groupData: { adminPubkeys: [EXISTING_ADMIN] },
      commit: commitMock,
    };
    const groupSecondRead = {
      state: {},
      groupData: { adminPubkeys: [EXISTING_ADMIN, OTHER_CONCURRENT] },
      commit: commitMock,
    };

    const getGroup = vi.fn()
      .mockResolvedValueOnce(groupFirstRead)   // attempt 1
      .mockResolvedValueOnce(groupSecondRead); // attempt 2 (retry)

    const proposeUpdateMetadata = vi.fn((opts: { adminPubkeys: string[] }) => ({
      type: 'updateMetadata',
      ...opts,
    }));

    const result = await grantAdminImpl(
      {
        getGroup,
        Proposals: { proposeUpdateMetadata },
        reloadGroups: vi.fn().mockResolvedValue(undefined),
        markBackupDirty: vi.fn(),
      },
      'g1',
      TARGET,
    );

    expect(result).toEqual({ ok: true });
    expect(commitMock).toHaveBeenCalledTimes(2);

    // First attempt proposed [EXISTING_ADMIN, TARGET]
    const firstProposal = proposeUpdateMetadata.mock.calls[0][0] as { adminPubkeys: string[] };
    expect(firstProposal.adminPubkeys).toContain(EXISTING_ADMIN);
    expect(firstProposal.adminPubkeys).toContain(TARGET);

    // Second attempt (retry) proposed [EXISTING_ADMIN, OTHER_CONCURRENT, TARGET]
    // — the union of the fresh live set and our target (AC-GRANT-7).
    const secondProposal = proposeUpdateMetadata.mock.calls[1][0] as { adminPubkeys: string[] };
    expect(secondProposal.adminPubkeys).toContain(EXISTING_ADMIN);
    expect(secondProposal.adminPubkeys).toContain(OTHER_CONCURRENT);
    expect(secondProposal.adminPubkeys).toContain(TARGET);
    expect(secondProposal.adminPubkeys).toHaveLength(3);
  });

  // Additional: both attempts fail → returns error from second
  it('exhausted-retry: both attempts fail, returns error, commit called exactly twice', async () => {
    const commitMock = vi.fn()
      .mockRejectedValue(new Error('persistent-conflict'));

    const group = {
      state: {},
      groupData: { adminPubkeys: [EXISTING_ADMIN] },
      commit: commitMock,
    };

    const result = await grantAdminImpl(
      {
        getGroup: vi.fn().mockResolvedValue(group),
        Proposals: {
          proposeUpdateMetadata: vi.fn((opts: { adminPubkeys: string[] }) => opts),
        },
        reloadGroups: vi.fn().mockResolvedValue(undefined),
        markBackupDirty: vi.fn(),
      },
      'g1',
      TARGET,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('persistent-conflict');
    expect(commitMock).toHaveBeenCalledTimes(2);
  });

  // VQ-S3-001: group_not_found
  it('group_not_found: getGroup returns null → error without commit', async () => {
    const deps = makeDeps();
    deps.getGroup = vi.fn().mockResolvedValue(null);

    const result = await grantAdminImpl(deps, 'g1', TARGET);

    expect(result).toEqual({ ok: false, error: 'group_not_found' });
    expect(deps.commit).not.toHaveBeenCalled();
  });

  // VQ-S3-007: live re-read — verify getGroup is called on each attempt, not cached
  it('re-reads live adminPubkeys on retry (AC-GRANT-7 structural)', async () => {
    const commitMock = vi.fn()
      .mockRejectedValueOnce(new Error('epoch-conflict'))
      .mockResolvedValueOnce(undefined);

    const group = { state: {}, groupData: { adminPubkeys: [EXISTING_ADMIN] }, commit: commitMock };
    const getGroup = vi.fn().mockResolvedValue(group);

    await grantAdminImpl(
      {
        getGroup,
        Proposals: { proposeUpdateMetadata: vi.fn((opts) => opts) },
        reloadGroups: vi.fn().mockResolvedValue(undefined),
        markBackupDirty: vi.fn(),
      },
      'g1',
      TARGET,
    );

    // getGroup is called once per attempt (2 attempts = 2 calls)
    expect(getGroup).toHaveBeenCalledTimes(2);
  });
});
