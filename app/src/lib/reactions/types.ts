/**
 * Discriminated union identifying the persistence namespace for a reaction thread.
 * - group: reactions stored under quizzl:reactions:group:{groupId}
 * - dm:    reactions stored under quizzl:reactions:dm:{peerPubkeyHex}
 *
 * Single-identity app (D11): no identity_id concept.
 */
export type ReactionThreadKey =
  | { kind: 'group'; groupId: string }
  | { kind: 'dm'; peerPubkeyHex: string };

/**
 * A single reaction row stored in idb-keyval.
 *
 * Seam S1 — consumed by reactions-store (S2), rumor-builder (S3),
 * group-reactions (story-06), dm-reactions (story-07), and reaction-ui (story-08).
 *
 * Invariants:
 * - identity_id is absent (D11 — single-identity app).
 * - emoji is a non-empty Unicode glyph; NIP-30 shortcodes are out of scope (D4).
 * - eventId is an empty string for in-flight optimistic rows; a 64-char hex string once confirmed.
 * - removed === true means the row is kept for dedup purposes but not rendered.
 * - At most one non-removed row per (messageId, reactorPubkey, emoji) triple (D2).
 */
export interface Reaction {
  /** Local UUID for optimistic rows; replaced by the wire id on confirm. */
  id: string;

  /** Local message id (== ChatMessage.id) the reaction attaches to. */
  messageId: string;

  /** Reactor identity (hex pubkey). */
  reactorPubkey: string;

  /** Unicode glyph. NIP-30 shortcodes are out of scope (D4). */
  emoji: string;

  /** Wire event id. Empty string for in-flight optimistic rows. */
  eventId: string;

  /** ms since epoch (matches ChatMessage.createdAt). */
  createdAt: number;

  /**
   * Tombstone marker: true if a content="-" removal rumor has been observed
   * for this (messageId, reactorPubkey, emoji) tuple.
   * Tombstoned rows are not rendered but are kept for dedup.
   */
  removed: boolean;
}

/**
 * Curated set of 24 Unicode emoji glyphs used by both the compose picker
 * and the reaction picker (D3).
 *
 * Layout: 4 columns × 6 rows.
 * Categories: Faces (8), Gestures (6), Symbols (6), Objects (4).
 *
 * These are the glyphs from spec §1.1 default table. No NIP-30 shortcodes (D4).
 */
export const CURATED_EMOJI: readonly string[] = [
  // Faces (8)
  '😀', '😂', '😊', '😢', '😍', '🥰', '😎', '🤔',
  // Gestures (6)
  '👍', '👋', '🙏', '✌️', '👏', '💪',
  // Symbols (6)
  '❤️', '✨', '🔥', '💯', '✅', '❌',
  // Objects (4)
  '🎉', '💡', '📌', '🔔',
] as const;
