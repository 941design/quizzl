/**
 * Unread message count store — lightweight module-level store.
 *
 * Uses useSyncExternalStore for React integration without needing a Context.
 * Persists lastReadTimestamp per group in localStorage; tracks unread counts
 * in memory and syncs them on mount from IndexedDB.
 */

import { useSyncExternalStore } from 'react';
import { isPendingConfirmation, readStoredContacts } from '@/src/lib/contacts';
import { isAllowedDmSender } from '@/src/lib/walledGarden';
import type { WhitelistArgs } from '@/src/lib/walledGarden';

const STORAGE_KEY = 'lp_unreadLastRead_v1';
const DM_STORAGE_KEY = 'lp_unreadLastReadDM_v1';

type UnreadState = {
  /** Unread message count per groupId */
  counts: Record<string, number>;
  /** Pending join request count per groupId */
  joinRequests: Record<string, number>;
  /** Unread direct-message count per peer pubkey (lowercase hex) */
  directMessages: Record<string, number>;
};

let state: UnreadState = { counts: {}, joinRequests: {}, directMessages: {} };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): UnreadState {
  return state;
}

function getServerSnapshot(): UnreadState {
  return { counts: {}, joinRequests: {}, directMessages: {} };
}

// --- Init / live-increment reconciliation ---
// Each init*Counts reads IDB asynchronously, then replaces a state slice. A live
// increment (incrementUnread / incrementJoinRequest / incrementDirectMessage)
// arriving DURING that async scan must not be clobbered by the stale computed
// snapshot — the bug where a freshly-arrived message lowered the badge right
// after startup. Every increment source persists to IDB *before* calling its
// increment (chatHandler awaits appendMessage first; the join-request and DM
// paths likewise store before counting), so a key "touched" by a live increment
// during init can be authoritatively RE-READ from IDB — capturing the new
// message without double-counting the live bump.
type CountSlice = 'counts' | 'joinRequests' | 'directMessages';
const initInProgress: Record<CountSlice, boolean> = {
  counts: false,
  joinRequests: false,
  directMessages: false,
};
const initTouched: Record<CountSlice, Set<string>> = {
  counts: new Set(),
  joinRequests: new Set(),
  directMessages: new Set(),
};

function noteLiveIncrement(slice: CountSlice, key: string) {
  if (initInProgress[slice]) initTouched[slice].add(key);
}

// --- Confirm-time single-peer reconcile floor ---
// `reconcileInit`'s "authoritative IDB count supersedes both the stale next
// and the live bump" comment above is correct for slices where persistence
// keeps pace with live events — the batch/startup DM scan and the non-DM
// slices all persist BEFORE incrementing. But `incrementDirectMessage` (the
// live bell bump fired by directMessageNotifications.ts) does NOT persist
// message content — only `ContactChat` mounting does, via a historical relay
// fetch. So for `reconcileConfirmedContactDirectMessageCount`'s single-peer
// confirm-time call specifically, a DM that lands while its raw idb-keyval
// read is in flight can never be "seen" by the recompute, and the recompute
// must not be allowed to overwrite that live bump back down.
//
// Contract (corrected 2026-07-15 — the previous wording here claimed this
// "tracks the highest live count observed... while that one call is in
// flight", which does not match the code below): `reconcileFloor[key]` is
// seeded with the PRE-CALL count (`state.directMessages[key] ?? 0`) at the
// moment the reconcile starts — not with a live-observed increment — so the
// actual rule is "the reconcile never lowers a peer's count below its
// pre-call value". `noteLiveIncrementFloor` then raises that floor via
// `Math.max` for any live bump that fires while this key is tracked, so a DM
// landing mid-call is ALSO protected. Net effect: the `finally` block below
// floors the post-recompute count at whichever is higher — the value the
// peer already had when the reconcile started, or any live bump that
// happened during it. Scoped to this one key/call, never touching
// `reconcileInit` or its other callers.
const reconcileFloor: Record<string, number> = {};

function noteLiveIncrementFloor(key: string, value: number) {
  if (key in reconcileFloor) {
    reconcileFloor[key] = Math.max(reconcileFloor[key], value);
  }
}

// --- Serialize concurrent reconciles for the same slice ---
// `reconcileInit` mutates the per-slice `initInProgress`/`initTouched` state
// declared above, which was only ever safe with ONE call in flight per slice
// at a time. The `directMessages` slice gained a SECOND caller in the
// pending-contact-confirmation epic — `reconcileConfirmedContactDirectMessageCount`,
// fired on every pending-contact confirm — alongside the pre-existing
// startup batch scan (`initDirectMessageCounts`, invoked once by
// `DirectMessageNotificationsWatcher` at load). If a confirm overlaps the
// startup scan (a real window: the scan `await`s one idb `get()` per known
// peer), the confirm's `reconcileInit` call would clear
// `initTouched['directMessages']` mid-scan — discarding the batch scan's
// accumulated live-increment keys — and then set
// `initInProgress['directMessages'] = false` while the batch scan is still
// awaiting its own reads, so a later live bump the batch scan should have
// re-read goes unnoted. That reintroduces exactly the startup-clobber bug
// this module's very first comment block (above `initInProgress`/
// `initTouched`) exists to prevent. Fixed by serializing same-slice calls
// behind a promise chain: a second call for a slice already in flight simply
// awaits the first call's completion before it starts its own
// `initInProgress`/`initTouched` bookkeeping. This keeps the existing
// single-call invariants intact rather than reworking them into per-call
// state (this module never needs more than one reconcile per slice actually
// RUNNING at a time — queuing is sufficient and much smaller a change).
const reconcileChain: Record<CountSlice, Promise<void>> = {
  counts: Promise.resolve(),
  joinRequests: Promise.resolve(),
  directMessages: Promise.resolve(),
};

async function reconcileInit(
  slice: CountSlice,
  keys: string[],
  computeForKey: (key: string) => Promise<number>,
): Promise<void> {
  const run = reconcileChain[slice].then(() => reconcileInitExclusive(slice, keys, computeForKey));
  // Keep the queue alive even if this call rejects — one caller's failure
  // must not wedge every later same-slice reconcile behind a rejected
  // promise forever. The caller of `reconcileInit` still observes the real
  // rejection via `run`, returned below.
  reconcileChain[slice] = run.catch(() => undefined);
  return run;
}

async function reconcileInitExclusive(
  slice: CountSlice,
  keys: string[],
  computeForKey: (key: string) => Promise<number>,
): Promise<void> {
  initInProgress[slice] = true;
  initTouched[slice].clear();

  try {
    const next: Record<string, number> = {};
    for (const key of keys) {
      const n = await computeForKey(key);
      if (n > 0) next[key] = n;
    }

    // Re-read keys a live increment touched during the scan; the authoritative IDB
    // count supersedes both the stale `next` and the live bump. Bounded so a
    // steady message stream cannot loop forever (residual staleness ≤ a handful of
    // messages arriving in the final window — vs. the old bug losing them all).
    let passes = 0;
    while (initTouched[slice].size > 0 && passes < 3) {
      passes++;
      const toReread = Array.from(initTouched[slice]);
      initTouched[slice].clear();
      for (const key of toReread) {
        const n = await computeForKey(key);
        if (n > 0) next[key] = n;
        else delete next[key];
      }
    }

    // `next` (authoritative) wins for every recomputed key; any live-only key not
    // in `keys` is preserved. No await between the last compute and the write, so
    // no increment can interleave and be lost.
    state = { ...state, [slice]: { ...state[slice], ...next } };
    emit();
  } finally {
    // Reset even if computeForKey rejects. Counts stay correct either way — the
    // flag's only reader is noteLiveIncrement, and every scan clears initTouched
    // at entry — so a stranded `true` leaks memory (live increments keep
    // inserting into a set nothing drains) rather than corrupting a badge.
    initInProgress[slice] = false;
  }
}

// --- Persistence helpers ---

function loadLastReadTimestamps(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLastReadTimestamps(timestamps: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timestamps));
  } catch {
    // Non-fatal
  }
}

function loadDirectMessageLastRead(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DM_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDirectMessageLastRead(timestamps: Record<string, number>) {
  try {
    localStorage.setItem(DM_STORAGE_KEY, JSON.stringify(timestamps));
  } catch {
    // Non-fatal
  }
}

function dmKey(peerPubkeyHex: string): string {
  return peerPubkeyHex.toLowerCase();
}

// --- Public API ---

/** Increment unread count for a group (called when a chat message arrives). */
export function incrementUnread(groupId: string) {
  noteLiveIncrement('counts', groupId);
  const next = { ...state.counts };
  next[groupId] = (next[groupId] ?? 0) + 1;
  state = { ...state, counts: next };
  emit();
}

/** Mark a group as read — resets its unread count and persists the timestamp. */
export function markAsRead(groupId: string) {
  const timestamps = loadLastReadTimestamps();
  timestamps[groupId] = Date.now();
  saveLastReadTimestamps(timestamps);

  if (state.counts[groupId]) {
    const next = { ...state.counts };
    delete next[groupId];
    state = { ...state, counts: next };
    emit();
  }
}

/** Remove tracking for a group (called on group leave). */
export function clearUnreadGroup(groupId: string) {
  const timestamps = loadLastReadTimestamps();
  delete timestamps[groupId];
  saveLastReadTimestamps(timestamps);

  if (state.counts[groupId]) {
    const next = { ...state.counts };
    delete next[groupId];
    state = { ...state, counts: next };
    emit();
  }
}

/**
 * Initialise unread counts from persisted messages.
 * Called once after MarmotContext loads groups.
 */
export async function initUnreadCounts(groupIds: string[], ownPubkey: string) {
  const timestamps = loadLastReadTimestamps();
  const { get } = await import('idb-keyval');
  await reconcileInit('counts', groupIds, async (groupId) => {
    const lastRead = timestamps[groupId] ?? 0;
    try {
      const messages: Array<{ createdAt: number; senderPubkey: string }> | undefined = await get(
        `few:messages:${groupId}`,
      );
      if (messages && messages.length > 0) {
        return messages.filter((m) => m.createdAt > lastRead && m.senderPubkey !== ownPubkey).length;
      }
    } catch {
      // Non-fatal — group messages may not exist yet
    }
    return 0;
  });
}

/**
 * Initialise join request counts from persisted pending requests in IDB.
 * Called once after MarmotContext loads groups.
 */
export async function initJoinRequestCounts(groupIds: string[]) {
  const { entries } = await import('idb-keyval');
  const { createJoinRequestStore } = await import('@/src/lib/marmot/joinRequestStorage');
  const store = createJoinRequestStore();
  await reconcileInit('joinRequests', groupIds, async (groupId) => {
    try {
      const all = await entries<string, { groupId: string }>(store);
      return all.filter(([, req]) => req.groupId === groupId).length;
    } catch {
      // Non-fatal — join request store may not exist yet
      return 0;
    }
  });
}

// --- Join request counter API ---

/** Increment join request counter for a group. */
export function incrementJoinRequest(groupId: string) {
  noteLiveIncrement('joinRequests', groupId);
  const next = { ...state.joinRequests };
  next[groupId] = (next[groupId] ?? 0) + 1;
  state = { ...state, joinRequests: next };
  emit();
}

/** Reset join request counter for a group to 0. */
export function markJoinRequestsRead(groupId: string) {
  if (state.joinRequests[groupId]) {
    const next = { ...state.joinRequests };
    delete next[groupId];
    state = { ...state, joinRequests: next };
    emit();
  }
}

/** Decrement join request counter for a group by 1. */
export function decrementJoinRequest(groupId: string) {
  const current = state.joinRequests[groupId] ?? 0;
  if (current <= 1) {
    // Drop to zero — remove the entry entirely
    if (state.joinRequests[groupId]) {
      const next = { ...state.joinRequests };
      delete next[groupId];
      state = { ...state, joinRequests: next };
      emit();
    }
  } else {
    const next = { ...state.joinRequests, [groupId]: current - 1 };
    state = { ...state, joinRequests: next };
    emit();
  }
}

/** Remove join request tracking for a group (called on group leave). */
export function clearJoinRequestGroup(groupId: string) {
  if (state.joinRequests[groupId]) {
    const next = { ...state.joinRequests };
    delete next[groupId];
    state = { ...state, joinRequests: next };
    emit();
  }
}

// --- Direct message counter API ---

/** Increment unread direct-message count for a peer (called when a DM arrives). */
export function incrementDirectMessage(peerPubkeyHex: string) {
  const key = dmKey(peerPubkeyHex);
  noteLiveIncrement('directMessages', key);
  const next = { ...state.directMessages };
  next[key] = (next[key] ?? 0) + 1;
  state = { ...state, directMessages: next };
  noteLiveIncrementFloor(key, next[key]);
  emit();
}

/** Mark a peer's DM thread as read — resets count and persists the timestamp. */
export function markDirectMessagesRead(peerPubkeyHex: string) {
  const key = dmKey(peerPubkeyHex);
  const timestamps = loadDirectMessageLastRead();
  timestamps[key] = Date.now();
  saveDirectMessageLastRead(timestamps);

  if (state.directMessages[key]) {
    const next = { ...state.directMessages };
    delete next[key];
    state = { ...state, directMessages: next };
    emit();
  }
}

/** Last-read timestamp (ms) for a peer's DM thread; 0 if never opened. */
export function getDirectMessageLastReadAt(peerPubkeyHex: string): number {
  const timestamps = loadDirectMessageLastRead();
  return timestamps[dmKey(peerPubkeyHex)] ?? 0;
}

/** Remove DM tracking for a peer (called on contact removal). */
export function clearDirectMessageContact(peerPubkeyHex: string) {
  const key = dmKey(peerPubkeyHex);
  const timestamps = loadDirectMessageLastRead();
  delete timestamps[key];
  saveDirectMessageLastRead(timestamps);

  if (state.directMessages[key]) {
    const next = { ...state.directMessages };
    delete next[key];
    state = { ...state, directMessages: next };
    emit();
  }
}

/**
 * Initialise direct-message unread counts from persisted DM threads.
 * Reads `few:messages:dm:<peer>` keys (the same store ContactChat uses).
 *
 * This is the BATCH/STARTUP path — called by `DirectMessageNotificationsWatcher`
 * for every known peer on app load. It deliberately reads the raw idb-keyval
 * entry directly rather than going through `chatPersistence.ts#loadMessages`:
 * `loadMessages` runs a DM-thread self-heal pass on first access (rewrites
 * malformed rows, returns non-canonical-id rows as `refetchIds` for the
 * caller to enqueue a relay repair-refetch) and marks the thread healed as a
 * side effect. Marking a thread healed here — before the user has ever
 * opened it and before anyone consumes the `refetchIds` this function
 * discards — would silently rob `ContactChat`'s own `loadMessages` call of
 * the self-heal/refetch signal when the user finally does open that thread,
 * since `loadMessages` short-circuits to an empty `refetchIds` for
 * already-healed threads. That was a real regression: reviewed and reverted
 * (epic: pending-contact-confirmation, S2 gate-remediation) after a canonical-
 * read-path change briefly routed this batch scan through `loadMessages`.
 *
 * The confirm-action bell reconciliation for a single peer
 * (`reconcileConfirmedContactDirectMessageCount`) uses this exact same raw
 * read pattern, for the identical reason: no caller whose job is only to
 * *count* held messages may be the one to trigger or consume
 * `loadMessages`' one-time-per-thread self-heal side effect. There is no
 * "safe" case for a reconciliation-only caller to route through
 * `loadMessages` — that was tried once for this function (see the revert
 * noted above) and once more for `reconcileConfirmedContactDirectMessageCount`
 * (see that function's doc comment) before both converged on the raw read.
 */
export async function initDirectMessageCounts(peerPubkeysHex: string[], ownPubkeyHex: string) {
  const own = ownPubkeyHex.toLowerCase();
  const timestamps = loadDirectMessageLastRead();
  const { get } = await import('idb-keyval');
  // Key the slice by dmKey (lowercased peer) — matches incrementDirectMessage and
  // state.directMessages. reconcileInit re-reads any peer touched by a live DM
  // during the scan, so a stale computed value can no longer overwrite a newer
  // live count (the bug this finding flagged at the merge site).
  // A pending contact's bell stays dark until the user confirms them, so this
  // recompute drops them here — at the entrypoint that owns the slice — rather
  // than trusting each caller to pre-filter. The live-increment path gates the
  // same way (directMessageNotifications.ts); this is the batch-scan half of
  // that pair, and it is the reason a leaked contact card cannot light the bell
  // before its pairing has been confirmed. See spec AC-OBS-1 / Design Decision 9.
  const storedList = Object.values(readStoredContacts());
  const keys = peerPubkeysHex.map(dmKey).filter((key) => !isPendingConfirmation(key, storedList));
  await reconcileInit('directMessages', keys, async (key) => {
    const lastRead = timestamps[key] ?? 0;
    try {
      const messages: Array<{ createdAt: number; senderPubkey: string }> | undefined = await get(
        `few:messages:dm:${key}`,
      );
      if (messages && messages.length > 0) {
        return messages.filter((m) => m.createdAt > lastRead && m.senderPubkey.toLowerCase() !== own).length;
      }
    } catch {
      // Non-fatal — DM thread may not exist yet
    }
    return 0;
  });
}

/**
 * Reconciles a single peer's direct-message unread count via a raw,
 * side-effect-free `idb-keyval` read — the SAME pattern `initDirectMessageCounts`
 * uses, not `chatPersistence.ts#loadMessages`.
 *
 * Used ONLY by the pending-confirmation confirm action (`contacts.tsx` /
 * `PendingConfirmationPrompt.tsx#confirmPendingContact`) to reconcile the
 * bell for messages held while the contact was pending (AC-OBS-2).
 *
 * Gate-remediation (2026-07-15, second round): this function was originally
 * routed through `chatPersistence.ts#loadMessages` on the theory that doing
 * so was safe here because the user is "about to view this thread anyway."
 * That reasoning was wrong. `loadMessages` runs a DM-thread self-heal pass
 * exactly ONCE per thread per session — the first call for a given thread
 * marks it "healed" and returns real `refetchIds` for malformed/non-canonical
 * rows; every later call to that same thread short-circuits to `refetchIds:
 * []`. This function is called on EVERY confirm, including the still-live
 * detail-view confirm path (`PendingConfirmationPrompt.tsx`), so it can
 * easily be the FIRST caller to touch `loadMessages` for that thread —
 * permanently consuming the one-time repair opportunity before
 * `ContactChat`'s own later `loadMessages` call (the one that actually acts
 * on `refetchIds` to trigger a relay repair-refetch) ever gets a chance to
 * see them. This function discards `refetchIds` entirely, so that
 * consumption was pure loss: a genuine repair opportunity silently and
 * permanently dropped for a reconciliation-only read. Switching to the raw
 * idb-keyval read below removes the self-heal side effect from this call
 * site altogether — mirrors `initDirectMessageCounts`'s own identical fix
 * earlier in this same remediation session (see that function's doc comment
 * above), and for the identical reason: a reconciliation-only caller must
 * never be the first to trigger a one-time repair signal it cannot consume.
 *
 * AC-OBS-2 was amended 2026-07-15 (spec.md `## Amendments`): for a contact
 * whose conversation was never opened while pending, this read finds
 * nothing persisted yet (message content is only written once `ContactChat`
 * has mounted at least once) and resolves to 0 — a no-op in that common
 * case. The bell still ends up correct because AC-OBS-1 guarantees it was
 * never incorrectly bumped for those messages in the first place; the real
 * catch-up happens the next time the user opens the conversation, when
 * `ContactChat` loads the now-fetchable history and marks it read via its
 * own `markDirectMessagesRead` mount effect (not via this function).
 *
 * Gate-remediation (Codex P2, 2026-07-15, first round): `reconcileInit`'s
 * shared re-read loop assumes an authoritative recompute always supersedes a
 * live bump — true when persistence keeps pace with live events (the
 * batch/startup scan and the non-DM slices), false here, since
 * `incrementDirectMessage` never persists content. If the just-confirmed
 * peer's next DM lands while the raw read below is in flight, the live bell
 * bump fires but the recompute (reading only already-persisted history)
 * can't see it — so this floors the final count at the highest live value
 * observed during the call, ensuring that live bump is never silently
 * dropped. See `reconcileFloor`'s comment near `noteLiveIncrement` for why
 * this is scoped to this one key/call rather than changed in the shared
 * helper.
 */
export async function reconcileConfirmedContactDirectMessageCount(
  peerPubkeyHex: string,
  ownPubkeyHex: string,
): Promise<void> {
  const own = ownPubkeyHex.toLowerCase();
  const timestamps = loadDirectMessageLastRead();
  const { get } = await import('idb-keyval');
  const key = dmKey(peerPubkeyHex);

  reconcileFloor[key] = state.directMessages[key] ?? 0;
  try {
    await reconcileInit('directMessages', [key], async (k) => {
      const lastRead = timestamps[k] ?? 0;
      try {
        const messages: Array<{ createdAt: number; senderPubkey: string }> | undefined = await get(
          `few:messages:dm:${k}`,
        );
        if (messages && messages.length > 0) {
          return messages.filter((m) => m.createdAt > lastRead && m.senderPubkey.toLowerCase() !== own).length;
        }
      } catch {
        // Non-fatal — DM thread may not exist yet
      }
      return 0;
    });
  } finally {
    const floor = reconcileFloor[key];
    delete reconcileFloor[key];
    if (floor > (state.directMessages[key] ?? 0)) {
      const next = { ...state.directMessages, [key]: floor };
      state = { ...state, directMessages: next };
      emit();
    }
  }
}

/**
 * Purges unread-counter entries for stranger peers (AC-PURGE-4).
 *
 * Checks both the in-memory `state.directMessages` map and the persisted
 * `lp_unreadLastReadDM_v1` localStorage store.  For every peer that fails
 * the whitelist check, `clearDirectMessageContact` is called, which removes
 * both the in-memory count and the persisted timestamp.
 *
 * After the sweep, `getDirectMessageLastReadAt(strangerHex)` returns 0 (the
 * module's unset sentinel).
 */
export function purgeStrangerDmCounters(
  getWhitelist: () => WhitelistArgs,
): void {
  const { groups, knownPeers, ownPubkeyHex } = getWhitelist();

  // Collect all peers tracked anywhere: in-memory counts + persisted timestamps.
  const peers = new Set<string>();
  for (const peer of Object.keys(state.directMessages)) {
    peers.add(peer);
  }
  const persisted = loadDirectMessageLastRead();
  for (const peer of Object.keys(persisted)) {
    peers.add(peer);
  }

  for (const peer of peers) {
    if (!isAllowedDmSender(peer, groups, knownPeers, ownPubkeyHex)) {
      clearDirectMessageContact(peer);
    }
  }
}

// --- Test bridge ---
// Expose store functions on window so e2e tests can inject unread state.
if (typeof window !== 'undefined') {
  (window as any).__fewUnread = {
    incrementUnread, markAsRead, clearUnreadGroup,
    incrementJoinRequest, markJoinRequestsRead, decrementJoinRequest, clearJoinRequestGroup,
    incrementDirectMessage, markDirectMessagesRead, clearDirectMessageContact,
  };
}

// --- DM publish test bridge (dev only) ---
// Exposes publishDirectMessage via the page's own identity so e2e tests can
// send DMs without dynamic-importing webpack-aliased modules from page.evaluate.
// The bridge reads the private key from localStorage at call time.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as any).__fewPublishDm = async (peerPubkeyHex: string, content: string): Promise<void> => {
    try {
      const identityRaw = localStorage.getItem('lp_nostrIdentity_v1');
      if (!identityRaw) throw new Error('No identity in localStorage');
      const identity = JSON.parse(identityRaw) as { privateKeyHex: string };
      const { connectNdk } = await import('@/src/lib/ndkClient');
      const { publishDirectMessage } = await import('@/src/lib/directMessages');
      const ndk = await connectNdk(identity.privateKeyHex);
      await publishDirectMessage({ ndk, privateKeyHex: identity.privateKeyHex, peerPubkeyHex, content });
    } catch (err) {
      console.error('[__fewPublishDm] failed:', err);
      throw err;
    }
  };
}

// --- React hook ---

/** Returns the current unread state (counts per group + total). */
export function useUnreadCounts() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const totalUnread =
    Object.values(snapshot.counts).reduce((sum, n) => sum + n, 0) +
    Object.values(snapshot.joinRequests).reduce((sum, n) => sum + n, 0) +
    Object.values(snapshot.directMessages).reduce((sum, n) => sum + n, 0);

  return {
    counts: snapshot.counts,
    joinRequests: snapshot.joinRequests,
    directMessages: snapshot.directMessages,
    totalUnread,
  };
}
