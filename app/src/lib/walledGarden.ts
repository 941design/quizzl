/**
 * walledGarden.ts — Whitelist computation for the DM walled-garden feature.
 *
 * Single export: `isAllowedDmSender`. Pure function over the current MLS group
 * snapshot — no IDB, no NDK, no React, no side effects.
 *
 * Whitelist definition (DD-1): a peer pubkey is allowed if it appears in
 * `group.memberPubkeys` of at least one currently joined MLS group, excluding
 * the user's own pubkey (DD-10, AC-SEC-1).
 *
 * Comparisons are case-insensitive (AC-SEC-2) because Nostr pubkeys arrive in
 * various capitalisations from different relay and client implementations.
 */

import type { Group } from '@/src/types';

/**
 * Parameter bag for the purge helpers' `getWhitelist` accessor.
 * Carries the current group snapshot and own pubkey at the time of the sweep.
 */
export type WhitelistArgs = {
  groups: ReadonlyArray<Group>;
  ownPubkeyHex: string | null | undefined;
};

/**
 * Determines whether `peerHex` is a permitted DM sender for the local user.
 *
 * @param peerHex      - Hex pubkey of the candidate sender. May be any case.
 * @param groups       - Snapshot of the user's currently joined MLS groups.
 * @param ownPubkeyHex - The local user's hex pubkey (any case, or null/undefined).
 *
 * @returns `true` if and only if:
 *   - `peerHex` is non-empty, AND
 *   - `peerHex` (case-insensitive) does NOT equal `ownPubkeyHex`, AND
 *   - `groups` is non-empty, AND
 *   - `peerHex` (case-insensitive) appears in `group.memberPubkeys`
 *     (case-insensitive) of at least one element of `groups`.
 *
 * Returns `false` for any other case, including empty `peerHex`, self-addressing,
 * or a peer absent from every group.
 */
export function isAllowedDmSender(
  peerHex: string,
  groups: ReadonlyArray<Group>,
  ownPubkeyHex: string | null | undefined,
): boolean {
  // AC-SEC-1: empty peerHex
  if (!peerHex) return false;

  const peerLower = peerHex.toLowerCase();

  // AC-SEC-1: self-addressing (case-insensitive)
  if (ownPubkeyHex && peerLower === ownPubkeyHex.toLowerCase()) return false;

  // AC-SEC-1: empty groups
  if (groups.length === 0) return false;

  // AC-SEC-2: peer must appear in memberPubkeys of at least one group
  for (const group of groups) {
    for (const memberPubkey of group.memberPubkeys) {
      if (memberPubkey.toLowerCase() === peerLower) return true;
    }
  }

  return false;
}
