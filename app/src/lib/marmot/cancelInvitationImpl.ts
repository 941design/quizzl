/**
 * Pure implementation of the cancelPendingInvitation + isPendingMember logic.
 * Extracted from MarmotContext to enable unit testing without rendering React.
 */

import type { MemberProfile } from '@/src/types';

// Use `any` (not `unknown`) for marmot-ts opaque types so the impl can accept
// strongly-typed callables from the boundary without contravariance fights.
// The decoupling intent is preserved: the impl never reaches into these shapes.
type MarmotGroupLike = {
  state: any;
  groupData?: { adminPubkeys?: string[] } | null;
  commit: (opts: { extraProposals: any[] }) => Promise<unknown>;
};

type Deps = {
  getGroup: (groupId: string) => Promise<MarmotGroupLike | null>;
  loadMemberProfiles: (groupId: string) => Promise<MemberProfile[]>;
  getGroupMembers: (state: any) => string[];
  /** Returns leaf node indexes for the given pubkey in the current ratchet tree. */
  getPubkeyLeafNodeIndexes: (state: any, pubkey: string) => number[];
  Proposals: {
    proposeUpdateMetadata: (opts: { adminPubkeys: string[] }) => unknown;
  };
  persistGroup: (group: any) => Promise<void>;
  getStoredGroup: (groupId: string) => { id: string; memberPubkeys: string[]; name: string; createdAt: number; relays: string[] } | undefined;
  reloadGroups: () => Promise<void>;
  markBackupDirty: (dirty: boolean) => void;
  selfPubkeyHex: string;
};

// ts-mls proposalType constant for Remove (RFC 9420 §12.1.3)
const PROPOSAL_TYPE_REMOVE = 3;

export async function isPendingMemberImpl(
  deps: Pick<Deps, 'getGroup' | 'loadMemberProfiles' | 'getGroupMembers'>,
  groupId: string,
  pubkey: string,
): Promise<boolean> {
  const mlsGroup = await deps.getGroup(groupId);
  if (!mlsGroup) return false;
  const members = deps.getGroupMembers(mlsGroup.state);
  const isMember = members.some((pk) => pk.toLowerCase() === pubkey.toLowerCase());
  if (!isMember) return false;
  const profiles = await deps.loadMemberProfiles(groupId);
  return !profiles.some((p) => p.pubkeyHex.toLowerCase() === pubkey.toLowerCase());
}

export async function cancelPendingInvitationImpl(
  deps: Deps,
  groupId: string,
  pubkey: string,
  sendAnnouncement?: (content: string) => Promise<void>,
): Promise<{ ok: boolean; error?: string; raceDetected?: boolean }> {
  const stillPending = await isPendingMemberImpl(
    { getGroup: deps.getGroup, loadMemberProfiles: deps.loadMemberProfiles, getGroupMembers: deps.getGroupMembers },
    groupId,
    pubkey,
  );
  if (!stillPending) {
    return { ok: true, raceDetected: true };
  }

  const mlsGroup = await deps.getGroup(groupId);
  if (!mlsGroup) return { ok: false, error: 'group_not_found' };

  const currentAdmins = mlsGroup.groupData?.adminPubkeys ?? [];
  const filteredAdmins = currentAdmins.filter(
    (pk) => pk.toLowerCase() !== pubkey.toLowerCase(),
  );

  // Resolve the leaf indexes before calling commit so we can build plain
  // Proposal objects directly. proposeRemoveUser() returns a ProposalAction
  // (async factory), and marmot-ts commit() pushes its resolved array value
  // as a single extraProposals element — ts-mls createCommit then receives
  // an array-as-proposal and silently drops it. Building Remove proposals
  // inline as plain objects sidesteps that nesting issue entirely.
  const leafIndexes = deps.getPubkeyLeafNodeIndexes(mlsGroup.state, pubkey);
  if (leafIndexes.length === 0) {
    // Pubkey is no longer in the ratchet tree — already removed concurrently.
    return { ok: true, raceDetected: true };
  }

  try {
    const removeProposals = leafIndexes.map((leafIndex) => ({
      proposalType: PROPOSAL_TYPE_REMOVE,
      remove: { removed: leafIndex },
    }));
    await mlsGroup.commit({
      extraProposals: [
        ...removeProposals,
        deps.Proposals.proposeUpdateMetadata({ adminPubkeys: filteredAdmins }),
      ],
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'commit_failed' };
  }

  // Re-fetch the group after commit to read the authoritative post-commit state.
  const freshGroup = await deps.getGroup(groupId);
  const storedGroup = deps.getStoredGroup(groupId);
  if (storedGroup && freshGroup) {
    const updated = {
      ...storedGroup,
      memberPubkeys: deps.getGroupMembers(freshGroup.state),
    };
    await deps.persistGroup(updated);
    await deps.reloadGroups();
  }
  deps.markBackupDirty(true);

  if (sendAnnouncement) {
    const content = JSON.stringify({ type: 'invite_cancelled', pubkey, by: deps.selfPubkeyHex });
    sendAnnouncement(content).catch((err: unknown) => {
      console.warn('[Marmot] cancelPendingInvitation announcement failed:', err);
    });
  }

  return { ok: true };
}
