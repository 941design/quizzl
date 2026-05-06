/**
 * Pure UI helper functions for the reaction surface (story-08).
 *
 * These helpers are extracted from components to enable unit testing
 * without component rendering (no @testing-library/react in this project).
 *
 * Exported from lib/ so they can be imported by components/chat/ without
 * violating the downward-import rule (lib/ ← components/ is forbidden;
 * components/ → lib/ is allowed).
 */

import type { ReactionAggregate } from '@/src/lib/reactions/api';
import { truncateNpub, pubkeyToNpub } from '@/src/lib/nostrKeys';

/**
 * Determine whether clicking (emoji, message) should add or remove the reaction.
 *
 * D2 multi-emoji policy: clicking an emoji the user already has applied removes it;
 * clicking a new emoji adds it — without affecting other existing reactions.
 *
 * Returns 'remove' iff there is an aggregate entry with agg.emoji === emoji
 * AND agg.selfReacted === true. Otherwise 'add'.
 *
 * Degenerate case (selfReacted=true but agg absent from the array): treated as 'add'
 * because there is no local aggregate to remove — the state is inconsistent.
 */
export function computeReactOp(
  aggregates: ReactionAggregate[],
  emoji: string,
): 'add' | 'remove' {
  const agg = aggregates.find((a) => a.emoji === emoji);
  if (agg && agg.selfReacted) return 'remove';
  return 'add';
}

/**
 * Chakra style props for a reaction badge based on own-reaction state.
 *
 * selfReacted=true  → brand.50 background + brand.300 border (highlighted)
 * selfReacted=false → surfaceMutedBg background + borderSubtle border (normal)
 */
export function selfReactedStyle(selfReacted: boolean): {
  bg: string;
  borderColor: string;
  borderWidth: string;
} {
  if (selfReacted) {
    return { bg: 'brand.50', borderColor: 'brand.300', borderWidth: '1px' };
  }
  return { bg: 'surfaceMutedBg', borderColor: 'borderSubtle', borderWidth: '1px' };
}

const MAX_DISPLAY_DEFAULT = 5;

/**
 * Format a list of reactor pubkeys into a human-readable tooltip string.
 *
 * Lookup order:
 * 1. selfPubkey → always rendered as "you"
 * 2. displayNameCache.get(pubkey) → display name from profile cache
 * 3. truncateNpub(pubkeyToNpub(pubkey)) → fallback abbreviated npub
 *
 * Overflow: when reactors.length > maxDisplay, the remainder is shown as
 * "... and N others".
 *
 * Empty reactors → empty string.
 */
export function formatReactorList(
  reactors: string[],
  displayNameCache: Map<string, string>,
  selfPubkey: string,
  maxDisplay: number = MAX_DISPLAY_DEFAULT,
): string {
  if (reactors.length === 0) return '';

  const visible = reactors.slice(0, maxDisplay);
  const overflow = reactors.length - visible.length;

  const names = visible.map((pubkey) => {
    if (pubkey.toLowerCase() === selfPubkey.toLowerCase()) return 'you';
    const cached = displayNameCache.get(pubkey);
    if (cached) return cached;
    return truncateNpub(pubkeyToNpub(pubkey));
  });

  const base = names.join(', ');
  if (overflow > 0) return `${base} ... and ${overflow} others`;
  return base;
}
