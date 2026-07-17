/**
 * Pure leave-eligibility predicates and modal-state decision for group leave.
 *
 * Extracted from LeaveGroupButton.tsx to enable unit testing without
 * rendering React (the unit bucket's vitest env has no jsdom/JSX support).
 * Zero imports from app/src/context/; never imports marmot-ts.
 */

export type LeaveModalState = 'abandon' | 'blocked' | 'confirm';

/** True when ownPubkeyHex is the group's only member. Case-insensitive. */
export function isLastMember(
  memberPubkeys: string[] | undefined,
  ownPubkeyHex: string | null | undefined,
): boolean {
  if (!ownPubkeyHex || !memberPubkeys || memberPubkeys.length !== 1) return false;
  return memberPubkeys[0].toLowerCase() === ownPubkeyHex.toLowerCase();
}

/**
 * Pure predicate: returns true when ownPubkeyHex is the only member in adminPubkeys.
 * Comparison is case-insensitive. Moved verbatim from LeaveGroupButton.tsx.
 */
export function isSoleAdmin(
  adminPubkeys: string[] | undefined,
  ownPubkeyHex: string | null | undefined,
): boolean {
  if (!ownPubkeyHex || !adminPubkeys || adminPubkeys.length !== 1) return false;
  return adminPubkeys[0].toLowerCase() === ownPubkeyHex.toLowerCase();
}

/**
 * The epic's load-bearing decision. Last-member is tested FIRST (DD-2):
 * a last member is ALSO a sole admin, so admin-first ordering swallows the
 * abandon case entirely. Absent/unreadable memberPubkeys must fail closed to
 * 'blocked' or 'confirm' — NEVER 'abandon'.
 */
export function selectLeaveModalState(
  memberPubkeys: string[] | undefined,
  adminPubkeys: string[] | undefined,
  ownPubkeyHex: string | null | undefined,
): LeaveModalState {
  if (isLastMember(memberPubkeys, ownPubkeyHex)) return 'abandon';
  if (isSoleAdmin(adminPubkeys, ownPubkeyHex)) return 'blocked';
  return 'confirm';
}
