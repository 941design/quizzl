import { describe, it, expect, vi, beforeEach } from 'vitest';

// renameGroupImpl has zero top-level imports from marmot-ts or context — all
// dependencies are injected via the Deps interface, so no vi.mock is needed.
const { renameGroupImpl, normaliseGroupName, isValidGroupName, MAX_GROUP_NAME_LENGTH } =
  await import('@/src/lib/marmot/renameGroupImpl');

const GROUP_ID = 'g1';
const OLD_NAME = 'Old Name';
const NEW_NAME = 'Book Club';

type CommitArgs = { extraProposals: Array<{ name?: string }> };

function makeDeps(
  overrides: {
    currentName?: string;
    commitImpl?: (args: CommitArgs) => Promise<void>;
    mockCommitFn?: ReturnType<typeof vi.fn>;
    stored?: { id: string; name: string } | undefined;
  } = {},
) {
  const { currentName = OLD_NAME, commitImpl, mockCommitFn } = overrides;
  const stored =
    'stored' in overrides ? overrides.stored : { id: GROUP_ID, name: currentName };
  const commit = mockCommitFn ?? vi.fn().mockImplementation(commitImpl ?? (async () => {}));
  const group = {
    groupData: { name: currentName },
    commit,
  };
  return {
    getGroup: vi.fn().mockResolvedValue(group),
    Proposals: {
      proposeUpdateMetadata: vi.fn((opts: { name: string }) => ({ type: 'updateMetadata', ...opts })),
    },
    getStoredGroup: vi.fn().mockReturnValue(stored),
    persistGroup: vi.fn().mockResolvedValue(undefined),
    reloadGroups: vi.fn().mockResolvedValue(undefined),
    markBackupDirty: vi.fn(),
    group,
    commit,
    stored,
  };
}

describe('renameGroupImpl helpers', () => {
  it('normaliseGroupName trims whitespace', () => {
    expect(normaliseGroupName('  Book Club  ')).toBe('Book Club');
  });

  it('isValidGroupName rejects empty and over-length, accepts in-range', () => {
    expect(isValidGroupName('')).toBe(false);
    expect(isValidGroupName('x')).toBe(true);
    expect(isValidGroupName('x'.repeat(MAX_GROUP_NAME_LENGTH))).toBe(true);
    expect(isValidGroupName('x'.repeat(MAX_GROUP_NAME_LENGTH + 1))).toBe(false);
  });
});

describe('renameGroupImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: commits new name once, updates overlay, returns ok+changed', async () => {
    const deps = makeDeps({ currentName: OLD_NAME });

    const result = await renameGroupImpl(deps, GROUP_ID, NEW_NAME);

    expect(result).toEqual({ ok: true, changed: true });
    expect(deps.commit).toHaveBeenCalledTimes(1);

    const proposal = deps.Proposals.proposeUpdateMetadata.mock.calls[0][0] as { name: string };
    expect(proposal.name).toBe(NEW_NAME);

    // Overlay persisted with the new name; membership etc. preserved via spread.
    expect(deps.persistGroup).toHaveBeenCalledWith({ id: GROUP_ID, name: NEW_NAME });
    expect(deps.reloadGroups).toHaveBeenCalledTimes(1);
    expect(deps.markBackupDirty).toHaveBeenCalledWith(true);
  });

  it('trims the name before committing', async () => {
    const deps = makeDeps({ currentName: OLD_NAME });

    await renameGroupImpl(deps, GROUP_ID, `  ${NEW_NAME}  `);

    const proposal = deps.Proposals.proposeUpdateMetadata.mock.calls[0][0] as { name: string };
    expect(proposal.name).toBe(NEW_NAME);
  });

  it('no-op when the trimmed name equals the live MLS name: no commit, changed:false', async () => {
    const deps = makeDeps({ currentName: NEW_NAME });

    const result = await renameGroupImpl(deps, GROUP_ID, `  ${NEW_NAME}  `);

    expect(result).toEqual({ ok: true, changed: false });
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.persistGroup).not.toHaveBeenCalled();
    expect(deps.markBackupDirty).not.toHaveBeenCalled();
  });

  it('rejects empty / whitespace-only name with invalid_name, no commit', async () => {
    const deps = makeDeps();
    const result = await renameGroupImpl(deps, GROUP_ID, '   ');
    expect(result).toEqual({ ok: false, error: 'invalid_name' });
    expect(deps.getGroup).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('rejects over-length name with invalid_name, no commit', async () => {
    const deps = makeDeps();
    const result = await renameGroupImpl(deps, GROUP_ID, 'x'.repeat(MAX_GROUP_NAME_LENGTH + 1));
    expect(result).toEqual({ ok: false, error: 'invalid_name' });
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('group_not_found: getGroup returns null → error, no commit', async () => {
    const deps = makeDeps();
    deps.getGroup = vi.fn().mockResolvedValue(null);
    const result = await renameGroupImpl(deps, GROUP_ID, NEW_NAME);
    expect(result).toEqual({ ok: false, error: 'group_not_found' });
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('synchronous-throw retry: first commit throws, retries once, commit called twice', async () => {
    const commitMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('unapplied proposals'))
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps({ currentName: OLD_NAME, mockCommitFn: commitMock });

    const result = await renameGroupImpl(deps, GROUP_ID, NEW_NAME);

    expect(result).toEqual({ ok: true, changed: true });
    expect(commitMock).toHaveBeenCalledTimes(2);
    expect(deps.getGroup).toHaveBeenCalledTimes(2);
  });

  it('exhausted-retry: both attempts fail, returns error, commit called twice', async () => {
    const commitMock = vi.fn().mockRejectedValue(new Error('persistent-conflict'));
    const deps = makeDeps({ currentName: OLD_NAME, mockCommitFn: commitMock });

    const result = await renameGroupImpl(deps, GROUP_ID, NEW_NAME);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('persistent-conflict');
    expect(commitMock).toHaveBeenCalledTimes(2);
    expect(deps.persistGroup).not.toHaveBeenCalled();
  });

  it('commits even with no stored overlay, but skips overlay persist', async () => {
    const deps = makeDeps({ currentName: OLD_NAME, stored: undefined });

    const result = await renameGroupImpl(deps, GROUP_ID, NEW_NAME);

    expect(result).toEqual({ ok: true, changed: true });
    expect(deps.commit).toHaveBeenCalledTimes(1);
    expect(deps.persistGroup).not.toHaveBeenCalled();
    expect(deps.markBackupDirty).toHaveBeenCalledWith(true);
  });
});
