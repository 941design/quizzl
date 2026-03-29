/**
 * IndexedDB-backed pending join request storage using idb-keyval.
 *
 * Each request is keyed by its eventId in the 'quizzl-join-requests' database.
 * Deduplication: savePendingJoinRequest is a no-op if a request with the same
 * pubkeyHex + groupId already exists.
 */

import { createStore, get, set, del, entries } from 'idb-keyval';

export interface PendingJoinRequest {
  /** Requester's pubkey (hex) */
  pubkeyHex: string;
  /** The nonce from the invite link */
  nonce: string;
  /** Group ID (resolved from nonce) */
  groupId: string;
  /** When the request was received (Unix ms) */
  receivedAt: number;
  /** Requester's nickname (if resolvable from kind 0 metadata) */
  nickname?: string;
  /** Event ID of the gift wrap (for deduplication) */
  eventId: string;
}

// ---------------------------------------------------------------------------
// IDB store
// ---------------------------------------------------------------------------

const joinRequestStore = createStore('quizzl-join-requests', 'requests');

export function createJoinRequestStore() {
  return joinRequestStore;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Save a pending join request. Deduplicates by pubkeyHex + groupId:
 * if a request with the same requester and group already exists, this is a no-op.
 */
export async function savePendingJoinRequest(request: PendingJoinRequest): Promise<void> {
  const all = await entries<string, PendingJoinRequest>(joinRequestStore);
  const duplicate = all.some(
    ([, existing]) =>
      existing.pubkeyHex === request.pubkeyHex && existing.groupId === request.groupId
  );
  if (duplicate) return;
  await set(request.eventId, request, joinRequestStore);
}

export async function loadPendingJoinRequests(groupId: string): Promise<PendingJoinRequest[]> {
  const all = await entries<string, PendingJoinRequest>(joinRequestStore);
  return all
    .map(([, req]) => req)
    .filter((req) => req.groupId === groupId);
}

export async function deletePendingJoinRequest(eventId: string): Promise<void> {
  await del(eventId, joinRequestStore);
}

export async function clearPendingJoinRequestsForGroup(groupId: string): Promise<void> {
  const all = await entries<string, PendingJoinRequest>(joinRequestStore);
  const toDelete = all.filter(([, req]) => req.groupId === groupId);
  await Promise.all(toDelete.map(([key]) => del(key, joinRequestStore)));
}
