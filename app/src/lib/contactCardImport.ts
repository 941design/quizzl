/**
 * contactCardImport.ts — Card-to-cache import adapter (epic: contact-card-exchange, story S2).
 *
 * A thin storage adapter over `contactCache`: turns the `profile` half of a
 * `ParseContactCardResult` (produced by S1's `parseContactCard`) into a
 * `contactCache` upsert. Deliberately kept separate from `contactCard.ts` —
 * that module is the PURE codec core (architecture.md: "MUST NOT import
 * React, storage, NDK, or MarmotContext") and this module's whole job is to
 * write to storage, so folding it in would cross that boundary.
 *
 * LWW and the actual write are entirely owned by `writeContactEntry`
 * (contactCache.ts:33) — this module never reimplements that comparison for
 * the write itself; it only peeks the same predicate ahead of the call so it
 * can report whether this call actually wrote (see `importCard` below).
 */

import { readContactEntry, writeContactEntry } from '@/src/lib/contactCache';

/**
 * The S2 -> S4 / S2 -> S7 seam contract (stories.json cross-story data flow;
 * verification.json VQ-S2-007). `cached` reflects the LWW-predicate outcome
 * (i.e. whether this call *would* write per `writeContactEntry`'s
 * `updatedAt >=` comparison) — false when the incoming profile lost LWW
 * (AC-CACHE-2) or was an idempotent replay (AC-CACHE-3), true otherwise.
 *
 * This is NOT a persistence guarantee: `writeContactEntry` can swallow a
 * storage failure (e.g. localStorage unavailable, or a quota-exceeded write
 * it catches internally) without surfacing an error here, so `cached: true`
 * means "the LWW predicate said write", not "the write durably landed".
 */
export type ImportCardResult = {
  pubkeyHex: string;
  cached: boolean;
};

/**
 * Upsert `contactCache` for `pubkeyHex` from a parsed contact-card profile.
 *
 * `profile.updatedAt` is consumed as-is — it is already an ISO-8601 string
 * derived by S1's `parseContactCard` from the card's `created_at` (this
 * module does not re-derive it from Unix seconds).
 *
 * Avatar preservation (AC-CACHE-4): `writeContactEntry` replaces the whole
 * cache entry, so the existing avatar is read first and threaded through —
 * a name-only card import must never null out an avatar populated by group
 * profile sync.
 *
 * LWW (AC-CACHE-1/2) and idempotency (AC-CACHE-3) fall out of
 * `writeContactEntry`'s existing `updatedAt >=` comparison — this function
 * does not reimplement that comparison for the write path.
 */
export function importCard(
  pubkeyHex: string,
  profile: { nickname: string; updatedAt: string },
): ImportCardResult {
  const existing = readContactEntry(pubkeyHex);
  // Mirrors writeContactEntry's own gate purely to report the outcome; the
  // actual write decision and the write itself both belong to
  // writeContactEntry (contactCache.ts:38), never reimplemented here.
  const willWrite = !existing || existing.updatedAt < profile.updatedAt;

  writeContactEntry(pubkeyHex, {
    nickname: profile.nickname,
    avatar: existing?.avatar ?? null,
    updatedAt: profile.updatedAt,
  });

  return { pubkeyHex, cached: willWrite };
}
