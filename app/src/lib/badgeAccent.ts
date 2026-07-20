// app/src/lib/badgeAccent.ts
//
// Decorative badge palette. Badges lean on the theme's five existing hued
// color scales — brand, success, warning, danger, neutral — purely as
// COLORS. They carry NO severity, rank, or hierarchy: a "removal pending"
// badge drawn from the danger scale is exactly as important as a "requested"
// badge drawn from the success scale. The scale a kind maps to is an
// arbitrary aesthetic choice, not a signal — do not read meaning into it.
//
// The only real constraint on the mapping is that badge kinds which can
// appear side by side (e.g. admin vs removal-pending in the same member row)
// get visually distinct accents, and that the assignment is stable across
// renders. Everything reuses the theme's own scales, so each accent is
// already tuned per theme ("leaned on the theme").
//
// Attention indicators are deliberately NOT part of this palette — the
// unread-count pill (UnreadCountBadge), the nav pending-invite dot (Layout),
// and the notification bell keep a single strong color so they still "pop".

/** The decorative badge palette: the theme's five hued scales, used as colors only. */
export const BADGE_ACCENTS = ['brand', 'success', 'warning', 'danger', 'neutral'] as const;

export type BadgeAccent = (typeof BADGE_ACCENTS)[number];

/**
 * Decorative accent per badge kind. Values are arbitrary theme colors chosen
 * for visual distinction, not meaning. Kinds that can render together in one
 * MemberList row (`admin`, `memberPending`, `removalPending`) are kept
 * pairwise distinct on purpose; see badgeAccent.test.ts.
 */
export const BADGE_ACCENT = {
  /** Member role marker. */
  admin: 'brand',
  /** Join-request row awaiting approval. */
  memberRequested: 'success',
  /** Invited member who has not joined yet. */
  memberPending: 'warning',
  /** Member departed / removal cleanup pending. */
  removalPending: 'danger',
  /** Group member-count pill. */
  memberCount: 'brand',
  /** Our own outbound join request awaiting a decision. */
  awaiting: 'warning',
  /** Incoming video call. */
  callVideo: 'brand',
  /** Incoming voice call. */
  callVoice: 'success',
  /** Dev-only theme-status chip (experimental / hidden). */
  themeStatus: 'neutral',
} as const satisfies Record<string, BadgeAccent>;
