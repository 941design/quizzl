// app/src/lib/badgeAccent.ts
//
// Decorative badge palette. Badges lean on five neutral-named theme colors —
// badge1 … badge5 — that alias the theme's brand / success / warning / danger
// / neutral scales (wired in buildChakraTheme.ts). The names are deliberately
// neutral: a badge color carries NO severity, rank, or hierarchy, so the
// palette is named badge1..badge5 rather than "danger"/"warning" to make sure
// no status meaning reads through a badge. The scale a kind maps to is an
// arbitrary aesthetic choice, not a signal — do not read meaning into it.
//
// The only real constraint on the mapping is that badge kinds which can
// appear side by side (e.g. admin vs removal-pending in the same member row)
// get visually distinct colors, and that the assignment is stable across
// renders. Everything reuses the theme's own scales, so each color is already
// tuned per theme ("leaned on the theme").
//
// Attention indicators are deliberately NOT part of this palette — the
// unread-count pill (UnreadCountBadge), the nav pending-invite dot (Layout),
// and the notification bell keep a single strong color so they still "pop".

/** The decorative badge palette: five neutral-named theme colors. */
export const BADGE_ACCENTS = ['badge1', 'badge2', 'badge3', 'badge4', 'badge5'] as const;

export type BadgeAccent = (typeof BADGE_ACCENTS)[number];

/**
 * Decorative color per badge kind. Values are arbitrary palette colors chosen
 * for visual distinction, not meaning. Kinds that can render together in one
 * MemberList row (`admin`, `memberPending`, `removalPending`) are kept
 * pairwise distinct on purpose; see badgeAccent.test.ts.
 */
export const BADGE_ACCENT = {
  /** Member role marker. */
  admin: 'badge1',
  /** Join-request row awaiting approval. */
  memberRequested: 'badge2',
  /** Invited member who has not joined yet. */
  memberPending: 'badge3',
  /** Member departed / removal cleanup pending. */
  removalPending: 'badge4',
  /** Group member-count pill. */
  memberCount: 'badge1',
  /** Our own outbound join request awaiting a decision. */
  awaiting: 'badge3',
  /** Incoming video call. */
  callVideo: 'badge1',
  /** Incoming voice call. */
  callVoice: 'badge2',
  /** Dev-only theme-status chip (experimental / hidden). */
  themeStatus: 'badge5',
} as const satisfies Record<string, BadgeAccent>;
