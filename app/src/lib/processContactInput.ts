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
 */
import { addContactByNpub } from '@/src/lib/contacts';
import { parseContactCard } from '@/src/lib/contactCard';
import { importCard } from '@/src/lib/contactCardImport';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';

/** Mirrors contacts.ts's AddContactResult error union — reused, not redefined. */
export type AddContactSubmissionResult =
  | { ok: true; pubkeyHex: string; reactivated: boolean; cachedNickname: boolean }
  | { ok: false; error: 'invalid_npub' | 'self' | 'already_exists' };

export function processContactInput(
  input: string,
  ownPubkeyHex: string | null | undefined,
): AddContactSubmissionResult {
  const parsed = parseContactCard(input);
  if ('error' in parsed) {
    return { ok: false, error: 'invalid_npub' };
  }

  const npub = pubkeyToNpub(parsed.pubkeyHex);
  const addResult = addContactByNpub(npub, ownPubkeyHex);

  const shouldImportProfile = addResult.ok || addResult.error === 'already_exists';
  let cachedNickname = false;
  if (shouldImportProfile && 'profile' in parsed && parsed.profile) {
    const importResult = importCard(parsed.pubkeyHex, parsed.profile);
    cachedNickname = importResult.cached;
  }

  if (!addResult.ok) {
    return { ok: false, error: addResult.error };
  }
  return {
    ok: true,
    pubkeyHex: addResult.pubkeyHex,
    reactivated: addResult.reactivated,
    cachedNickname,
  };
}
