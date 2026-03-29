/**
 * Unread message count store — lightweight module-level store.
 *
 * Uses useSyncExternalStore for React integration without needing a Context.
 * Persists lastReadTimestamp per group in localStorage; tracks unread counts
 * in memory and syncs them on mount from IndexedDB.
 */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'lp_unreadLastRead_v1';

type UnreadState = {
  /** Unread message count per groupId */
  counts: Record<string, number>;
  /** Pending join request count per groupId */
  joinRequests: Record<string, number>;
};

let state: UnreadState = { counts: {}, joinRequests: {} };
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
  return { counts: {}, joinRequests: {} };
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

/** Remove join request tracking for a group (called on group leave). */
export function clearJoinRequestGroup(groupId: string) {
  if (state.joinRequests[groupId]) {
    const next = { ...state.joinRequests };
    delete next[groupId];
    state = { ...state, joinRequests: next };
    emit();
  }
}

// --- Test bridge ---
// Expose store functions on window so e2e tests can inject unread state.
if (typeof window !== 'undefined') {
  (window as any).__quizzlUnread = {
    incrementUnread, markAsRead, clearUnreadGroup,
    incrementJoinRequest, markJoinRequestsRead, clearJoinRequestGroup,
  };
}

// --- React hook ---

/** Returns the current unread state (counts per group + total). */
export function useUnreadCounts() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const totalUnread =
    Object.values(snapshot.counts).reduce((sum, n) => sum + n, 0) +
    Object.values(snapshot.joinRequests).reduce((sum, n) => sum + n, 0);

  return {
    counts: snapshot.counts,
    joinRequests: snapshot.joinRequests,
    totalUnread,
  };
}
