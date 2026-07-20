/**
 * pubkeyDisplay.ts — Pure helpers for rendering a hex pubkey as a
 * human-facing label.
 *
 * Both helpers are local-only: `resolveInviterLabel` reads the
 * localStorage-backed contact list via `getContact` (no relay call, no
 * network I/O), and `truncatePubkey` is a plain string transform. Neither
 * publishes, syncs, or fetches anything — see the privacy invariant in the
 * project CLAUDE.md.
 */

import { getContact } from '@/src/lib/contacts';

/**
 * Truncates a hex pubkey to `first8…last8` for compact display. Strings
 * shorter than 16 chars are returned unchanged (nothing meaningful to
 * truncate).
 */
export function truncatePubkey(hex: string): string {
  return hex.length >= 16 ? `${hex.slice(0, 8)}…${hex.slice(-8)}` : hex;
}

/**
 * Resolves a display label for an inviter pubkey: the contact's nickname
 * when known and non-empty, otherwise the truncated pubkey. A known contact
 * with an empty nickname (profile not yet synced) falls through to the
 * truncated form rather than showing a blank label.
 */
export function resolveInviterLabel(
  inviterPubkeyHex: string,
  ownPubkeyHex: string | null | undefined,
): string {
  const nickname = getContact(inviterPubkeyHex, ownPubkeyHex)?.nickname;
  return nickname ? nickname : truncatePubkey(inviterPubkeyHex);
}
