/**
 * Unread message count store — lightweight module-level store.
 *
 * Uses useSyncExternalStore for React integration without needing a Context.
 * Persists lastReadTimestamp per group in localStorage; tracks unread counts
 * in memory and syncs them on mount from IndexedDB.
 */

import { useSyncExternalStore } from 'react';
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

  const next: Record<string, number> = {};

  for (const groupId of groupIds) {
    const lastRead = timestamps[groupId] ?? 0;
    const key = `quizzl:messages:${groupId}`;
    try {
      const messages: Array<{ createdAt: number; senderPubkey: string }> | undefined = await get(key);
      if (messages && messages.length > 0) {
        const unread = messages.filter(
          (m) => m.createdAt > lastRead && m.senderPubkey !== ownPubkey,
        ).length;
        if (unread > 0) next[groupId] = unread;
      }
    } catch {
      // Non-fatal — group messages may not exist yet
    }
  }

  state = { ...state, counts: next };
  emit();
}

/**
 * Initialise join request counts from persisted pending requests in IDB.
 * Called once after MarmotContext loads groups.
 */
export async function initJoinRequestCounts(groupIds: string[]) {
  const { entries } = await import('idb-keyval');
  const { createJoinRequestStore } = await import('@/src/lib/marmot/joinRequestStorage');
  const store = createJoinRequestStore();

  try {
    const all = await entries<string, { groupId: string }>(store);
    const next: Record<string, number> = {};
    for (const [, req] of all) {
      if (groupIds.includes(req.groupId)) {
        next[req.groupId] = (next[req.groupId] ?? 0) + 1;
      }
    }
    state = { ...state, joinRequests: next };
    emit();
  } catch {
    // Non-fatal — join request store may not exist yet
  }
}

// --- Join request counter API ---

/** Increment join request counter for a group. */
export function incrementJoinRequest(groupId: string) {
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
  const next = { ...state.directMessages };
  next[key] = (next[key] ?? 0) + 1;
  state = { ...state, directMessages: next };
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
 * Reads `quizzl:messages:dm:<peer>` keys (the same store ContactChat uses).
 */
export async function initDirectMessageCounts(peerPubkeysHex: string[], ownPubkeyHex: string) {
  const own = ownPubkeyHex.toLowerCase();
  const timestamps = loadDirectMessageLastRead();
  const { get } = await import('idb-keyval');

  const computed: Record<string, number> = {};

  for (const peer of peerPubkeysHex) {
    const key = dmKey(peer);
    const lastRead = timestamps[key] ?? 0;
    const storageKey = `quizzl:messages:dm:${key}`;
    try {
      const messages: Array<{ createdAt: number; senderPubkey: string }> | undefined = await get(storageKey);
      if (messages && messages.length > 0) {
        const unread = messages.filter(
          (m) => m.createdAt > lastRead && m.senderPubkey.toLowerCase() !== own,
        ).length;
        if (unread > 0) computed[key] = unread;
      }
    } catch {
      // Non-fatal — DM thread may not exist yet
    }
  }

  // Merge: preserve any live increments that arrived while we were reading
  // IDB. `computed` wins for peers we re-evaluated from persistence.
  state = { ...state, directMessages: { ...state.directMessages, ...computed } };
  emit();
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
  (window as any).__nostlingUnread = {
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
  (window as any).__nostlingPublishDm = async (peerPubkeyHex: string, content: string): Promise<void> => {
    try {
      const identityRaw = localStorage.getItem('lp_nostrIdentity_v1');
      if (!identityRaw) throw new Error('No identity in localStorage');
      const identity = JSON.parse(identityRaw) as { privateKeyHex: string };
      const { connectNdk } = await import('@/src/lib/ndkClient');
      const { publishDirectMessage } = await import('@/src/lib/directMessages');
      const ndk = await connectNdk(identity.privateKeyHex);
      await publishDirectMessage({ ndk, privateKeyHex: identity.privateKeyHex, peerPubkeyHex, content });
    } catch (err) {
      console.error('[__nostlingPublishDm] failed:', err);
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
