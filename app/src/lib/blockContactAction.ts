/**
 * blockContactAction.ts — pure(-ish), dependency-injected orchestration of the
 * block/unblock action's CRITICAL ORDERING.
 *
 * Epic: block-contact, story S4 ("blocked view, send-path gating, confirm
 * dialog, block action"). This module owns none of the actual side effects
 * (archiveContact/unarchiveContact live in contacts.ts, notifyBlockedPeersChanged
 * lives on MarmotContext, wipeSinglePeerHistory lives in chatPersistence.ts) —
 * every side effect is an injected dependency, consumed only through its
 * already-exported seam signature. This keeps the ORDER OF OPERATIONS
 * independently unit-testable (via spy deps asserting call sequence) without
 * mounting React or touching real storage/IDB, per this repo's
 * hooks-via-pure-function-extraction convention (no jsdom/@testing-library).
 *
 * AC-VIEW-14 (post-block wipe race; Opus sev-4 finding on S3's review): a DM
 * from the just-blocked peer arriving immediately AFTER the block action's
 * history wipe must not resurrect the wiped thread. The fix is ORDERING: the
 * composite gate must be live — archivedAt set AND the block revision bumped
 * (so every consumer's blockedPeers ref refreshes on next render/effect) —
 * BEFORE or atomically with the wipe, so a post-wipe inbound append can never
 * be enqueued by anything that still thinks the peer is unblocked.
 * `performBlockContact` encodes that order as its literal statement order:
 *
 * Ordering alone leaves one narrow, scheduling-dependent window: a consumer's
 * `blockedPeersRef` (e.g. `ContactChat.tsx`) refreshes in a passive
 * `useEffect` that runs AFTER this function's `notifyBlockedPeersChanged`
 * setState flushes, not synchronously with step 1 below. Gate-remediation
 * finding 5 hardens this deterministically at the consumer:
 * `ContactChat.tsx#shouldIngestDmFromSender` also consults
 * `loadBlockedPeers()` directly (a synchronous read) as an authoritative
 * backstop on every DM-ingest call, which is always current the instant step
 * 1 below writes `archivedAt` — independent of when any particular ref
 * happens to refresh. The ref-cached `blockedPeers` set remains the
 * fast-path/common-case gate; the direct read only matters in that narrow
 * window.
 *
 *   1. deps.archiveContact(peerPubkeyHex)        — sets archivedAt (S1)
 *   2. deps.notifyBlockedPeersChanged()          — bumps the block revision (S1)
 *   3. await deps.wipeSinglePeerHistory(peerPubkeyHex) — drains + deletes (S3)
 *
 * never the reverse, and never wipe-then-archive.
 */

import type { HistoryWipeResult } from '@/src/lib/marmot/chatPersistence';

/**
 * Injected dependencies for {@link performBlockContact}. Each field's type
 * matches the real exported function's signature exactly so a caller can pass
 * the real `archiveContact`/`notifyBlockedPeersChanged`/`wipeSinglePeerHistory`
 * directly, or a `vi.fn()` spy in tests.
 */
export type BlockContactDeps = {
  /** S1's `contacts.ts#archiveContact`. Sets `archivedAt` on the stored contact. */
  archiveContact: (peerPubkeyHex: string) => void;
  /** S1's `MarmotContext#notifyBlockedPeersChanged`. Bumps the block revision. */
  notifyBlockedPeersChanged: () => void;
  /** S3's `chatPersistence.ts#wipeSinglePeerHistory`. Never throws (AC-WIPE-5). */
  wipeSinglePeerHistory: (peerPubkeyHex: string) => Promise<HistoryWipeResult>;
};

/**
 * Injected dependencies for {@link performUnblockContact}.
 */
export type UnblockContactDeps = {
  /** S1's `contacts.ts#unarchiveContact`. Clears `archivedAt`. */
  unarchiveContact: (peerPubkeyHex: string) => void;
  /** S1's `MarmotContext#notifyBlockedPeersChanged`. Bumps the block revision. */
  notifyBlockedPeersChanged: () => void;
};

/**
 * Executes the block action's post-confirmation sequence (AC-CONFIRM-2,
 * AC-VIEW-14). Call only after the user has explicitly confirmed the
 * destructive action (the confirm modal itself is `BlockContactButton`'s
 * concern, not this module's) — cancelling/dismissing the modal MUST NOT call
 * this function at all (AC-CONFIRM-2's cancel path: `archivedAt` unchanged,
 * `clearMessages`/`clearDirectMessageContact` never invoked).
 *
 * Order is load-bearing (AC-VIEW-14): `archiveContact` and
 * `notifyBlockedPeersChanged` both run — synchronously, in that order —
 * BEFORE `wipeSinglePeerHistory` is even called, so every DM enforcement
 * site's composite gate already denies this peer by the time the wipe begins
 * draining in-flight writes. `wipeSinglePeerHistory` itself never throws
 * (AC-WIPE-5) — a storage-quota failure inside it surfaces only as
 * `{ threadCleared: false, ... }` / `{ ..., countersCleared: false }`, never
 * as a rejected promise — so this function has no catch of its own to add.
 *
 * @returns The `HistoryWipeResult` from `wipeSinglePeerHistory`, so a caller
 *   that wants to surface partial-wipe telemetry can (this story does not
 *   currently need to — the block still takes filtering effect regardless).
 */
export async function performBlockContact(
  peerPubkeyHex: string,
  deps: BlockContactDeps,
): Promise<HistoryWipeResult> {
  deps.archiveContact(peerPubkeyHex);
  deps.notifyBlockedPeersChanged();
  return deps.wipeSinglePeerHistory(peerPubkeyHex);
}

/**
 * Executes the unblock action (AC-UNBLOCK-2, AC-UNBLOCK-4). Synchronous, no
 * confirmation step precedes this call (DD-6) — `BlockContactButton` wires
 * this directly to the Unblock trigger's `onClick`, with no modal in between.
 *
 * MUST NOT re-fetch, restore, or resurrect any message deleted at block time
 * (AC-UNBLOCK-2) — this function's body deliberately touches only
 * `unarchiveContact` + `notifyBlockedPeersChanged`, never `loadMessages`,
 * `appendMessage`, or any chatPersistence read/write. The next inbound DM
 * from this peer is what repopulates the thread (AC-UNBLOCK-3, S2's concern),
 * not this action.
 *
 * MUST also bump the block revision (`notifyBlockedPeersChanged`) — omitting
 * this call is exactly the silent AC-UNBLOCK-3 failure mode a prior examiner
 * pass (VQ-S1-024) flagged: without it, the notification watcher's and
 * ContactChat's cached blockedPeers refs keep rejecting this peer's messages
 * after unblock until an unrelated revision bump happens to occur.
 */
export function performUnblockContact(
  peerPubkeyHex: string,
  deps: UnblockContactDeps,
): void {
  deps.unarchiveContact(peerPubkeyHex);
  deps.notifyBlockedPeersChanged();
}
