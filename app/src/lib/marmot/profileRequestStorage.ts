/**
 * profileRequestStorage.ts — IndexedDB-backed profile-request memo store.
 *
 * Epic: member-profile-discovery-and-relay-on-behalf | Story 02
 *
 * Uses idb-keyval. Key format: `${groupId}:${targetPubkey}`.
 */

import { createStore, get, set, del, entries, clear } from 'idb-keyval';
import type { ProfileRequestMemo } from '@/src/lib/marmot/profileRequestSync';
import { REQUEST_DEDUPE_MS } from '@/src/lib/marmot/profileRequestSync';

// ---------------------------------------------------------------------------
// IDB store
// ---------------------------------------------------------------------------

const profileRequestMemoStore = createStore(
  'quizzl-profile-request-memos',
  'memos',
);

function memoKey(groupId: string, targetPubkey: string): string {
  return `${groupId}:${targetPubkey}`;
}

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

/** Load a memo for (groupId, targetPubkey), or null if absent. */
export async function loadProfileRequestMemo(
  groupId: string,
  targetPubkey: string,
): Promise<ProfileRequestMemo | null> {
  return (await get<ProfileRequestMemo>(memoKey(groupId, targetPubkey), profileRequestMemoStore)) ?? null;
}

/** Save a memo verbatim. */
export async function saveProfileRequestMemo(memo: ProfileRequestMemo): Promise<void> {
  await set(memoKey(memo.groupId, memo.targetPubkey), memo, profileRequestMemoStore);
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

/**
 * Record that a profile request was emitted for (groupId, targetPubkey).
 *
 * - If no memo exists: creates one with attempts=1, lastRequestAt=now, lastAnsweredAt=null.
 * - If a memo exists and now - prev.lastRequestAt > REQUEST_DEDUPE_MS:
 *   resets attempts=1, sets lastRequestAt=now, clears lastAnsweredAt.
 * - Otherwise (within the dedupe window): increments attempts, sets lastRequestAt=now.
 */
export async function recordRequestEmitted(
  groupId: string,
  targetPubkey: string,
  now: number,
): Promise<void> {
  const prev = await loadProfileRequestMemo(groupId, targetPubkey);

  if (!prev) {
    const memo: ProfileRequestMemo = {
      groupId,
      targetPubkey,
      lastRequestAt: now,
      lastAnsweredAt: null,
      attempts: 1,
    };
    await saveProfileRequestMemo(memo);
    return;
  }

  if (now - prev.lastRequestAt > REQUEST_DEDUPE_MS) {
    // Dedupe window expired — fresh start
    const memo: ProfileRequestMemo = {
      groupId,
      targetPubkey,
      lastRequestAt: now,
      lastAnsweredAt: null,
      attempts: 1,
    };
    await saveProfileRequestMemo(memo);
  } else {
    // Within dedupe window — bump attempts
    const memo: ProfileRequestMemo = {
      ...prev,
      lastRequestAt: now,
      attempts: prev.attempts + 1,
    };
    await saveProfileRequestMemo(memo);
  }
}

/**
 * Record that a profile answer was received for (groupId, targetPubkey).
 * Sets lastAnsweredAt=now and resets attempts=0.
 */
export async function recordRequestAnswered(
  groupId: string,
  targetPubkey: string,
  now: number,
): Promise<void> {
  const prev = await loadProfileRequestMemo(groupId, targetPubkey);
  const memo: ProfileRequestMemo = {
    groupId,
    targetPubkey,
    lastRequestAt: prev?.lastRequestAt ?? now,
    lastAnsweredAt: now,
    attempts: 0,
  };
  await saveProfileRequestMemo(memo);
}

/**
 * Delete every memo whose key starts with `${groupId}:`.
 * When groupId is '*', clears all memos (used by clearAllGroupData).
 */
export async function clearProfileRequestMemos(groupId: string): Promise<void> {
  if (groupId === '*') {
    await clear(profileRequestMemoStore);
    return;
  }
  const all = await entries<string, ProfileRequestMemo>(profileRequestMemoStore);
  await Promise.all(
    all
      .filter(([key]) => key.startsWith(`${groupId}:`))
      .map(([key]) => del(key, profileRequestMemoStore)),
  );
}
