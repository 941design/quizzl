/**
 * Pure implementation of the leaveGroup operation.
 * Extracted from MarmotContext to enable unit testing without rendering React.
 *
 * Mirrors grantAdminImpl.ts: uses the Deps-injection pattern; has zero
 * imports from app/src/context/ (AC-BOUND-1); never imports marmot-ts directly
 * (getGroupMembers is injected via Deps from the MarmotContext boundary).
 *
 * sendRumorSafe and buildRumor are module-private functions in MarmotContext
 * (not marmot-ts exports), so — per the same zero-context-imports boundary —
 * they arrive here as Deps fields rather than being exported and imported back.
 */

import { isLastMember } from '@/src/lib/marmot/leaveEligibility';
import { LEAVE_INTENT_KIND, serialiseLeaveIntent } from '@/src/lib/marmot/leaveSync';

// Use `any` (not `unknown`) for marmot-ts opaque types so the impl can accept
// strongly-typed callables from the boundary without contravariance fights.
// The decoupling intent is preserved: the impl never reaches into these shapes.
type MarmotGroupLike = {
  state: any;
  sendApplicationRumor: (rumor: any) => Promise<unknown>;
};

type Deps = {
  getGroup: (groupId: string) => Promise<MarmotGroupLike | null>;
  getGroupMembers: (state: any) => string[];
  sendRumorSafe: (group: MarmotGroupLike, rumor: any) => Promise<void>;
  buildRumor: (kind: number, content: string, pubkey: string, tags?: string[][]) => any;
  removeGroupFromStorage: (groupId: string) => Promise<void>;
  clearMemberProfiles: (groupId: string) => Promise<void>;
  clearMessages: (groupId: string) => Promise<void>;
  clearPollData: (groupId: string) => Promise<void>;
  clearGroupMedia: (groupId: string) => Promise<void>;
  clearProfileRequestMemos: (groupId: string) => Promise<void>;
  clearUnreadGroup: (groupId: string) => void;
  clearPendingJoinRequestsForGroup: (groupId: string) => Promise<void>;
  clearInviteLinksForGroup: (groupId: string) => Promise<void>;
  reloadGroups: () => Promise<void>;
  markBackupDirty: (dirty: boolean) => void;
};

/**
 * Leave the group identified by `groupId`, on behalf of `selfPubkeyHex`.
 *
 * Contracts:
 *  - Send-skip (AC-SEND-1/2): re-derives last-member from the LIVE MLS state it
 *    fetches itself (getGroupMembers(mlsGroup.state), never a caller-passed
 *    value — AC-STRUCT-3). When the caller is the group's last member, neither
 *    the kind-13 leave-intent nor the kind-9 announcement is sent. Otherwise
 *    both fire, unchanged from prior behavior.
 *  - Fail-closed in the OPPOSITE direction from the eligibility/modal decision:
 *    when mlsGroup can't be read, members is undefined, isLastMember is false,
 *    and the send branch is taken (send-anyway) — a redundant send into an
 *    already-empty group is the safe failure mode here, whereas silently
 *    skipping a real departure is not.
 *  - Purge hygiene (AC-PURGE-1/2): the two-clear leak fix
 *    (clearPendingJoinRequestsForGroup, clearInviteLinksForGroup) runs
 *    unconditionally, after the send block, on BOTH the abandon and the
 *    normal-leave path.
 *  - Never throws to the caller: a failed kind-13 send is caught and logged;
 *    the purge always proceeds. Returns `true` unconditionally, matching the
 *    pre-extraction signature.
 *  - Zero imports from app/src/context/ (AC-BOUND-1).
 */
export async function leaveGroupImpl(
  deps: Deps,
  groupId: string,
  selfPubkeyHex: string,
): Promise<boolean> {
  const mlsGroup = await deps.getGroup(groupId);

  // AC-STRUCT-3: members is derived from a fresh read of live MLS state made
  // within this call — never a value threaded through from a caller's earlier
  // (e.g. modal-open) read.
  let members: string[] | undefined;
  try {
    members = mlsGroup ? deps.getGroupMembers(mlsGroup.state) : undefined;
  } catch {
    // Fail-closed (DD-7): a corrupt/unreadable member read defaults lastMember
    // to false ⇒ send anyway (harmless into an empty group) AND the purge still
    // runs. Mirrors getLiveMemberPubkeys's guard on the modal path (DD-6).
    members = undefined;
  }
  const lastMember = isLastMember(members, selfPubkeyHex);

  if (mlsGroup && selfPubkeyHex && !lastMember) {
    // AC-SEND-2: kind-13 leave-intent via sendRumorSafe (handles unapplied-
    // proposals retry loop internally). If it still throws, log and continue —
    // the purge must not be blocked.
    const kind13Rumor = deps.buildRumor(
      LEAVE_INTENT_KIND,
      serialiseLeaveIntent({ pubkey: selfPubkeyHex }),
      selfPubkeyHex,
    );
    try {
      await deps.sendRumorSafe(mlsGroup, kind13Rumor);
    } catch (err) {
      console.warn('[Marmot] leaveGroup: kind-13 send failed, proceeding with purge:', err);
    }

    // AC-SEND-2: kind-9 chat announcement — fire-and-forget. Failure must not
    // block the purge or navigation.
    const kind9Rumor = deps.buildRumor(
      9,
      JSON.stringify({ type: 'leave_intent', pubkey: selfPubkeyHex }),
      selfPubkeyHex,
    );
    mlsGroup.sendApplicationRumor(kind9Rumor).catch(() => {});
  }
  // AC-SEND-1: solo group — lastMember is true, neither send fires.

  // AC-PURGE-1: purge sequence — runs unconditionally on both paths.
  await deps.removeGroupFromStorage(groupId);
  await deps.clearMemberProfiles(groupId);
  await deps.clearMessages(groupId);
  await deps.clearPollData(groupId);
  await deps.clearGroupMedia(groupId);
  await deps.clearProfileRequestMemos(groupId);
  deps.clearUnreadGroup(groupId);
  // AC-PURGE-1/2: leak-fixing clears, unconditional on both paths.
  await deps.clearPendingJoinRequestsForGroup(groupId);
  await deps.clearInviteLinksForGroup(groupId);
  await deps.reloadGroups();
  deps.markBackupDirty(true);
  return true;
}
