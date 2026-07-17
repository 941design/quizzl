/**
 * contactInviteLine.ts — pure mapping from a contact-card link payload to
 * the inviter's display name for the first-visit welcome screen (epic:
 * first-visit-invite-welcome, story S3; AC-CONTACT-2, AC-CONTACT-3).
 *
 * Composes the existing `parseContactCard` seam (app/src/lib/contactCard.ts)
 * — this module owns NO decode or signature-verification logic of its own
 * (story scope.excludes; VQ-S3-002). `parseContactCard`/`decodeCard` already
 * verify a signed card's NIP-01 (v1) or synthetic-event (v2) signature
 * before ever returning a `profile.nickname` (contactCard.ts#decodeCard), so
 * a name is only ever surfaced here for a card that verified (VQ-S3-006) —
 * this function never falls back to displaying unverified/untrusted payload
 * data.
 *
 * `deriveInviterName` returns `null` uniformly for every "no readable name"
 * case named in architecture.md's testing guidance: an older v1 card with no
 * name (unsigned, pubkey-only), a bare npub, a `nostr:` URI (which
 * `parseContactCard` resolves to the same bare-pubkey shape), and any
 * decode/verification error. `add.tsx` treats `null` as "render no invite
 * line at all" (WelcomeInviteProps' documented contract) — the pitch, name
 * input, and action still render (AC-CONTACT-3).
 *
 * Read-only and side-effect-free: this call never mutates state, never
 * touches storage, and (per `parseContactCard`'s own doc) requires no relay
 * read — showing the invite line induces no broadcast of the newcomer's own
 * data (AC-PRIV-2).
 */
import { parseContactCard } from '@/src/lib/contactCard';

/**
 * `cardPayload` is anything `parseContactCard` itself accepts: the raw `c=`
 * fragment payload (e.g. `extractCardPayloadFromHash`'s output), a bare
 * npub, or a `nostr:npub…` URI. Returns the inviter's verified, readable
 * display name, or `null` when the card carries none.
 */
export function deriveInviterName(cardPayload: string): string | null {
  const parsed = parseContactCard(cardPayload);
  if ('error' in parsed) return null;
  if (!('profile' in parsed) || !parsed.profile) return null;
  const nickname = parsed.profile.nickname.trim();
  return nickname.length > 0 ? nickname : null;
}
