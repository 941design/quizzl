/**
 * pendingDirectInviteStorage.ts — IndexedDB-backed pending-direct-invite marker store.
 *
 * Epic: invite-rescind-and-member-removal | Story S1
 *
 * Mirrors profileRequestStorage.ts's createStore/get/set/del/entries/clear
 * pattern. Uses idb-keyval. Key format: `${groupId}:${pubkey}`.
 *
 * This module owns the marker's on-disk shape exclusively. It exposes two
 * distinct bulk-clear entrypoints — clearPendingDirectInvitesForGroup (one
 * group) and clearAllPendingDirectInvites (every group) — rather than a
 * single function overloaded on an optional/sentinel groupId argument, so
 * neither S2's clearAllGroupData (account reset) nor S3's leaveGroupImpl
 * (per-group leave fan-out) can accidentally invoke the wrong scope
 * (AC-MARKER-9).
 *
 * Per architecture.md's Boundary rules, this store is consumed only via a
 * context method (S5's MarmotContext.getPendingDirectInvites) or an
 * injected Deps function (S3's leaveGroupImpl, S4's profileHandler) —
 * never imported directly into a *Impl.ts pure-impl file.
 *
 * markPendingDirectInvite deliberately lets IDB errors (quota exceeded, IDB
 * unavailable) propagate uncaught — best-effort write semantics (log and
 * proceed on failure) are the call sites' responsibility (S7/S8's
 * AC-MARKER-2), not this store's.
 */

import { createStore, set, del, entries, clear } from 'idb-keyval';

// ---------------------------------------------------------------------------
// IDB store
// ---------------------------------------------------------------------------

const pendingInviteMarkerStore = createStore(
  'few-pending-invite-markers',
  'markers',
);

/**
 * Key-formatting helper (${groupId}:${pubkey}), mirroring profileRequestStorage.ts's
 * memoKey. Exported only so the test file can assert on key shape directly —
 * every other module must call this store's exported clear/load/mark functions,
 * never reconstruct this format independently (VQ-S1-005).
 *
 * The pubkey is normalized to canonical lowercase here so the marker key is
 * casing-invariant at the STORE level, not by write-site convention: a marker
 * written by an invite site (S7/S8) always matches the clear keyed on the
 * invitee's own `signedEvent.pubkey` (canonical lowercase hex) at profile
 * arrival (S4) and the member-list Set membership check (S9/S10). Without this,
 * an un-lowercased write site would orphan the marker (order-sensitive
 * invariant #1). groupIds are already canonical (hex/uuid), so only the pubkey
 * needs normalizing.
 */
export function markerKey(groupId: string, pubkey: string): string {
  return `${groupId}:${pubkey.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Marker CRUD
// ---------------------------------------------------------------------------

/**
 * Mark (groupId, pubkey) as having a pending direct invite. Real IDB write —
 * lets a throw (quota/transient) propagate to the caller.
 */
export async function markPendingDirectInvite(
  groupId: string,
  pubkey: string,
): Promise<void> {
  await set(markerKey(groupId, pubkey), true, pendingInviteMarkerStore);
}

/**
 * Clear the marker for (groupId, pubkey), if any. Idempotent — clearing an
 * absent or already-cleared key does not throw (VQ-S1-010). This is the
 * PendingDirectInviteClearFn seam S4's profileHandler consumes.
 */
export async function clearPendingDirectInvite(
  groupId: string,
  pubkey: string,
): Promise<void> {
  await del(markerKey(groupId, pubkey), pendingInviteMarkerStore);
}

/**
 * Load every pubkey currently marked pending for groupId as a Set<string> —
 * the exact shape the PendingDirectInviteMarkerSet seam contract requires
 * (VQ-S1-009). Performs a real entries() scan against the live store; no
 * in-memory cache shadows it, so a fresh call always reflects real IDB state
 * (AC-MARKER-10).
 */
export async function loadPendingDirectInviteMarkers(
  groupId: string,
): Promise<Set<string>> {
  const all = await entries<string, unknown>(pendingInviteMarkerStore);
  const prefix = `${groupId}:`;
  const pubkeys = all
    .filter(([key]) => key.startsWith(prefix))
    .map(([key]) => key.slice(prefix.length));
  return new Set(pubkeys);
}

// ---------------------------------------------------------------------------
// Bulk clear entrypoints (AC-MARKER-9) — two distinct exports, not one
// function overloaded on an optional/sentinel groupId argument.
// ---------------------------------------------------------------------------

/**
 * Clear every marker scoped to exactly one group, leaving markers for every
 * other group untouched. Consumed by S3's leaveGroupImpl per-group leave
 * fan-out (AC-MARKER-9's leave-fan-out half).
 */
export async function clearPendingDirectInvitesForGroup(
  groupId: string,
): Promise<void> {
  const all = await entries<string, unknown>(pendingInviteMarkerStore);
  const prefix = `${groupId}:`;
  await Promise.all(
    all
      .filter(([key]) => key.startsWith(prefix))
      .map(([key]) => del(key, pendingInviteMarkerStore)),
  );
}

/**
 * Clear every marker across every group. Consumed by S2's clearAllGroupData
 * account-reset composition root (AC-MARKER-9's account-reset half).
 */
export async function clearAllPendingDirectInvites(): Promise<void> {
  await clear(pendingInviteMarkerStore);
}
