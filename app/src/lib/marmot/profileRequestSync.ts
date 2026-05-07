/**
 * profileRequestSync.ts — Pure module for profile-request rumor construction,
 * parsing, timing constants, and deduplication predicates.
 *
 * Epic: member-profile-discovery-and-relay-on-behalf | Story 02
 *
 * This module has ZERO side effects. No await, no IDB, no NDK, no React.
 * All functions are pure and fully testable without mocks.
 */

import type { MemberProfile } from '@/src/types';

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

/** A profile older than this is considered stale and warrants a request. */
export const PROFILE_STALENESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** A request for the same targetPubkey within this window is skipped. */
export const REQUEST_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** After sending a request, wait this long before retrying unanswered ones. */
export const UNANSWERED_RETRY_MS = 60 * 60 * 1000; // 1 hour

/** Stop retrying after this many unanswered attempts. */
export const UNANSWERED_MAX_ATTEMPTS = 3;

/** Relay backoff floor (ms). */
export const RELAY_BACKOFF_MIN_MS = 5_000;

/** Relay backoff ceiling (ms). */
export const RELAY_BACKOFF_MAX_MS = 30_000;

// ---------------------------------------------------------------------------
// Wire-format types
// ---------------------------------------------------------------------------

/** MLS application-message rumor kind for profile requests (kind 30). */
export const PROFILE_REQUEST_KIND = 30;

/**
 * Wire format for a profile-request rumor content.
 * Carried as a JSON string inside the MLS rumor's `content` field.
 */
export type ProfileRequestPayload = {
  type: 'profile_request';
  targetPubkey: string;
  /** ISO timestamp — "only respond if your profile is newer than this". */
  sinceUpdatedAt?: string;
  /** Random nonce for deduplication at the wire level. */
  nonce: string;
};

// ---------------------------------------------------------------------------
// Serialise / parse
// ---------------------------------------------------------------------------

/**
 * Build the JSON string for a profile-request rumor.
 * A fresh random nonce is generated for each call so two calls with identical
 * other inputs return different strings.
 */
export function serialiseProfileRequest(input: {
  targetPubkey: string;
  sinceUpdatedAt?: string;
}): string {
  const payload: ProfileRequestPayload = {
    type: 'profile_request',
    targetPubkey: input.targetPubkey,
    sinceUpdatedAt: input.sinceUpdatedAt,
    nonce: crypto.randomUUID(),
  };
  return JSON.stringify(payload);
}

/**
 * Parse a JSON string into a typed ProfileRequestPayload.
 * Returns null for malformed JSON, missing `type`, or missing `targetPubkey`.
 */
export function parseProfileRequestPayload(content: string): ProfileRequestPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.type !== 'profile_request') return null;
  if (typeof o.targetPubkey !== 'string' || o.targetPubkey.length === 0) return null;
  return {
    type: 'profile_request',
    targetPubkey: o.targetPubkey as string,
    sinceUpdatedAt: typeof o.sinceUpdatedAt === 'string' ? o.sinceUpdatedAt : undefined,
    nonce: typeof o.nonce === 'string' ? o.nonce : '',
  };
}

// ---------------------------------------------------------------------------
// Staleness predicate
// ---------------------------------------------------------------------------

/**
 * Returns true when `profile` is stale relative to `now`.
 *
 * - profile is undefined / null  → stale (never seen)
 * - now - Date.parse(profile.updatedAt) >= PROFILE_STALENESS_MS → stale
 * - otherwise → not stale
 */
export function isProfileStale(profile: MemberProfile | undefined, now: number): boolean {
  if (!profile) return true;
  const age = now - Date.parse(profile.updatedAt);
  return age >= PROFILE_STALENESS_MS;
}

// ---------------------------------------------------------------------------
// Memo shape (mirrors seam contract — kept here so the pure module can use it)
// ---------------------------------------------------------------------------

/**
 * Deduplication memo stored in IndexedDB.
 * Lives in the seam contract and is re-exported so consumers import from one place.
 */
export type ProfileRequestMemo = {
  groupId: string;
  targetPubkey: string;
  /** Unix ms of the most recent request emission. */
  lastRequestAt: number;
  /** Unix ms of the most recent answer arrival; null if never answered. */
  lastAnsweredAt: number | null;
  /** Number of unanswered request emissions in the current window. */
  attempts: number;
};

// ---------------------------------------------------------------------------
// Dedup predicate
// ---------------------------------------------------------------------------

/**
 * Truth table:
 *
 * | memo | condition                                    | emit? |
 * |------|----------------------------------------------|-------|
 * | null | always emit                                  | YES   |
 * | has  | answered within REQUEST_DEDUPE_MS           | NO    |
 * | has  | last request within UNANSWERED_RETRY_MS      | NO    |
 * | has  | last request older but attempts >= MAX       | NO    |
 * | has  | last request older, attempts < MAX           | YES   |
 * | has  | last request older, no answer, first window | YES   |
 */
export function shouldEmitRequest(memo: ProfileRequestMemo | null, now: number): boolean {
  if (!memo) return true;

  const sinceLastRequest = now - memo.lastRequestAt;

  // Recently answered — skip
  if (memo.lastAnsweredAt !== null && (now - memo.lastAnsweredAt) < REQUEST_DEDUPE_MS) {
    return false;
  }

  // Within retry window — skip
  if (sinceLastRequest < UNANSWERED_RETRY_MS) {
    return false;
  }

  // At or past dedupe window
  if (sinceLastRequest >= REQUEST_DEDUPE_MS) {
    return true;
  }

  // In UNANSWERED_RETRY_MS .. REQUEST_DEDUPE_MS window
  // Emit only if we still have retry attempts left
  return memo.attempts < UNANSWERED_MAX_ATTEMPTS;
}

// ---------------------------------------------------------------------------
// Backoff helper
// ---------------------------------------------------------------------------

/**
 * Returns a random backoff value in [RELAY_BACKOFF_MIN_MS, RELAY_BACKOFF_MAX_MS].
 * Uniform distribution over the closed interval.
 */
export function pickBackoffMs(): number {
  return (
    RELAY_BACKOFF_MIN_MS +
    Math.random() * (RELAY_BACKOFF_MAX_MS - RELAY_BACKOFF_MIN_MS)
  );
}
