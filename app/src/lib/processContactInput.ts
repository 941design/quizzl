/**
 * processContactInput.ts — the single pure core for turning arbitrary
 * add-contact input (a bare npub, a signed contact-card link, or a raw card
 * payload) into a persisted contact.
 *
 * Extracted from the former `AddContactModal.tsx` so the `/add` deep-link
 * page (via `addDeepLink.ts`) can drive the exact same flow without depending
 * on any React component. The manual "Add Contact by npub" modal was removed
 * (the npub abstraction confused new users). A new trust relationship now
 * begins only two ways: sharing an MLS group, or opening a contact-card link
 * (`/add#c=…`, this module's path) — both seed `knownPeers`. An inbound DM is
 * NOT an admission path: the walled garden (`isAllowedDmSender`) drops any DM
 * from a sender not already allowed by one of those two, so a stranger can
 * never reach the user or become a contact. This module is the card-link
 * path's core.
 *
 * Routes `input` through `parseContactCard` — the single card decode seam
 * (contact-card-exchange architecture.md DD 1) — FIRST. A `{ error }` result
 * (e.g. a card whose signature does not verify) is treated as an add-failure
 * and `addContactByNpub` is never called: no silent downgrade to a
 * bare-pubkey add (AC-PARSE-4 / VQ-S4-006).
 *
 * On a successful parse, re-encodes the decoded `pubkeyHex` back to an npub
 * and calls the UNCHANGED `addContactByNpub(npub, ownPubkeyHex)` — contact /
 * knownPeers seeding behaves exactly as it did for a bare npub (AC-UX-1,
 * AC-UX-5).
 *
 * The card's profile cache write is independent of the add outcome (AC-UX-6):
 * `importCard` runs whenever the parsed result carries a `profile` AND the add
 * either succeeded or failed with `already_exists` — refreshing the cached
 * nickname (subject to `importCard`'s own LWW) even when no new contact entry
 * is created. A `self` rejection (or a parse failure) never calls `importCard`.
 *
 * Epic: contact-pairing-code, story S4. When the parsed card carries a
 * `pairing` field (S1's `ParsedPairingCard` seam — present iff the scanned
 * card is v2) AND the add either succeeded OR failed with `already_exists`
 * (the SAME `shouldImportProfile` gate AC-UX-6's cache refresh already uses
 * — review-remediation: a RETURNING scanner, one who already has the issuer
 * as a one-directional contact from before this epic, re-scanning the
 * issuer's live code must still reciprocate; the mutual channel this
 * feature exists to create must not silently fail to complete just because
 * the add itself was a no-op), this module computes a pure `pairingEcho`
 * candidate on the result: `{ issuerPubkeyHex, nonceHex, expiresAt }`,
 * gated only on the card's `expiresAt` not yet having passed per THIS
 * call's clock (AC-SCAN-2 — an already-expired v2 code degrades to the
 * plain one-directional add, no candidate, on EITHER branch). A malformed
 * pairing sub-object (defense-in-depth against untrusted input,
 * VQ-S4-006) degrades the same way rather than throwing. A `self`
 * rejection or a parse failure never carries a candidate — echoing to
 * one's own pubkey is meaningless and a parse failure has no `parsed.pairing`
 * to read. This module NEVER sends the echo or touches
 * `pendingIntent.ts`/`pairingAck.ts` itself — computing the candidate is
 * the full extent of the "decision" this pure core owns; the named-vs-
 * nameless branch and the actual network side effect belong to the caller
 * (`app/pages/add.tsx`), consistent with architecture.md's "S4 owns the
 * decision, S3 owns the mechanics" split.
 */
import { addContactByNpub } from '@/src/lib/contacts';
import { parseContactCard, UNSUPPORTED_VERSION_ERROR } from '@/src/lib/contactCard';
import { importCard } from '@/src/lib/contactCardImport';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';

/** The `ParsedPairingCard` seam's echo-candidate shape, resolved to a concrete send target (epic: contact-pairing-code, S4). */
export type PairingEchoCandidate = {
  issuerPubkeyHex: string;
  nonceHex: string;
  expiresAt: number;
};

/** Mirrors contacts.ts's AddContactResult error union — reused, not redefined. */
export type AddContactSubmissionResult =
  | {
      ok: true;
      pubkeyHex: string;
      reactivated: boolean;
      cachedNickname: boolean;
      /** Present iff the parsed card carried an unexpired `pairing` field (AC-SCAN-1/2/8) — undefined for a v1/npub input or an already-expired v2 code. */
      pairingEcho?: PairingEchoCandidate;
    }
  | {
      ok: false;
      /**
       * `unsupported_version` (epic: contact-pairing-code, story S5, AC-UI-3
       * / RD-5): the parse failed specifically because `decodeCard` rejected
       * an unrecognized header version (AC-CODEC-4) — distinguished from
       * every other parse failure (`invalid_npub`) so the import UI can show
       * friendly "update your app" copy instead of the generic invalid-input
       * message. This is a read of the same error signal S1's codec already
       * produces, not a new decision.
       */
      error: 'invalid_npub' | 'self' | 'already_exists' | 'unsupported_version';
      /** Review-remediation (sev 5): present iff `error === 'already_exists'` AND the parsed card carried an unexpired `pairing` field — a RETURNING scanner re-scanning a live code must still reciprocate. Always undefined for `invalid_npub`/`self`/`unsupported_version`. */
      pairingEcho?: PairingEchoCandidate;
    };

export function processContactInput(
  input: string,
  ownPubkeyHex: string | null | undefined,
  now: () => number = Date.now,
): AddContactSubmissionResult {
  const parsed = parseContactCard(input);
  if ('error' in parsed) {
    if (parsed.error === UNSUPPORTED_VERSION_ERROR) {
      return { ok: false, error: 'unsupported_version' };
    }
    return { ok: false, error: 'invalid_npub' };
  }

  const npub = pubkeyToNpub(parsed.pubkeyHex);
  const addResult = addContactByNpub(npub, ownPubkeyHex);

  // Review-remediation (sev 5): the SAME gate AC-UX-6's cache refresh
  // already uses for "does this outcome represent a genuine, already-known
  // relationship with this pubkey" — ok (brand-new or reactivated) OR
  // already_exists (a returning scanner). `self`/`invalid_npub` never
  // qualify: echoing to your own pubkey is meaningless, and a parse failure
  // has no `parsed.pairing` to read in the first place.
  const shouldImportProfile = addResult.ok || addResult.error === 'already_exists';
  let cachedNickname = false;
  if (shouldImportProfile && 'profile' in parsed && parsed.profile) {
    const importResult = importCard(parsed.pubkeyHex, parsed.profile);
    cachedNickname = importResult.cached;
  }

  let pairingEcho: PairingEchoCandidate | undefined;
  if (shouldImportProfile && 'pairing' in parsed && parsed.pairing) {
    const { nonce, expiresAt } = parsed.pairing;
    // VQ-S4-006: a malformed pairing sub-object (shouldn't happen — S1's
    // decoder only ever produces this shape — but the ultimate input is
    // untrusted external bytes) degrades gracefully to "no echo candidate"
    // rather than throwing and aborting the whole add.
    if (typeof nonce === 'string' && typeof expiresAt === 'number' && Math.floor(now() / 1000) <= expiresAt) {
      pairingEcho = { issuerPubkeyHex: parsed.pubkeyHex, nonceHex: nonce, expiresAt };
    }
  }

  if (!addResult.ok) {
    return { ok: false, error: addResult.error, pairingEcho };
  }

  return {
    ok: true,
    pubkeyHex: addResult.pubkeyHex,
    reactivated: addResult.reactivated,
    cachedNickname,
    pairingEcho,
  };
}
