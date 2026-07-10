/**
 * addDeepLink.ts — pure hash-parse + mode-branch core for pages/add.tsx
 * (epic: contact-card-exchange, story S7).
 *
 * Kept as a plain function module — importable and unit-testable with no
 * jsdom, per this repo's hooks-via-pure-function-extraction convention (see
 * `processContactInput` in processContactInput.ts / dmMessageEdits.test.ts) —
 * so the page's hash-read -> mode-branch -> add logic is exercised directly by
 * tests, not reimplemented inline in a way that could silently diverge from
 * production (VQ-S7-004).
 *
 * Single-parse discipline (VQ-S7-002, architecture.md DD 1): the ONLY
 * `parseContactCard` call for a `/add` page load happens inside
 * `processContactInput` (processContactInput.ts). `resolveAddDeepLink`
 * below never parses the raw hash itself — it extracts the `#c=` payload
 * string and, once a local identity is hydrated, hands that string to
 * `processContactInput` exactly once. It never re-parses the hash a second
 * time for any other step of the flow.
 */

import {
  processContactInput,
  type AddContactSubmissionResult,
} from '@/src/lib/processContactInput';

/** Marker used to locate the embedded card payload inside `window.location.hash` (DD 9 — fragment, never a query param, so the card is never sent to the server). */
const CARD_HASH_MARKER = '#c=';

/**
 * SSR-safe hash reader. Takes an injectable window-like object rather than
 * touching the global directly, so both branches — window present / absent —
 * are directly unit-testable without jsdom (VQ-S7-001). In production,
 * `pages/add.tsx` only ever calls this from inside a `useEffect`, which React
 * never runs during the static export's build-time prerender pass; passing
 * `undefined` here mirrors exactly what that pass would see if it *did* reach
 * this code, so the `undefined` branch is a genuine no-op, not a check that
 * merely looks defensive.
 */
export function readLocationHash(win: { location?: { hash?: string } } | undefined): string {
  if (!win || typeof win.location?.hash !== 'string') return '';
  return win.location.hash;
}

/**
 * Pure: extract the `c=` card payload from a location hash fragment such as
 * `"#c=<base64url>"`. Returns `null` when the hash carries no card marker or
 * an empty payload — the page treats that as "no card" without ever waiting
 * on identity hydration or calling `processContactInput`/`parseContactCard`.
 */
export function extractCardPayloadFromHash(hash: string): string | null {
  if (!hash) return null;
  const idx = hash.indexOf(CARD_HASH_MARKER);
  if (idx === -1) return null;
  const payload = hash.slice(idx + CARD_HASH_MARKER.length);
  return payload.length > 0 ? payload : null;
}

export type AddDeepLinkOutcome =
  | { state: 'no_card' }
  | { state: 'awaiting_identity' }
  | ({ state: 'complete' } & AddContactSubmissionResult);

/**
 * The page's hash-parse-then-mode-branch core (VQ-S7-004, AC-UX-3, AC-UX-7).
 *
 * Given the raw location hash, whether a local identity is hydrated yet
 * (`useNostrIdentity().hydrated`), and the active identity's `pubkeyHex`:
 *
 *  - no `#c=` payload            -> `{ state: 'no_card' }` — nothing to add,
 *    resolved immediately regardless of identity state.
 *  - payload present, `!hydrated` -> `{ state: 'awaiting_identity' }` — mode
 *    (b): the app's auto-generated identity (NostrIdentityContext, no bespoke
 *    onboarding wizard exists or is needed) is not ready yet. The payload is
 *    NOT consumed here — only the raw hash is read — so the card survives
 *    this wait by construction: the caller re-invokes this function with the
 *    same hash once `hydrated` flips true, and only THEN is the card parsed
 *    and the add completed (AC-UX-7). The hash is never transmitted anywhere
 *    in the meantime (AC-SEC-1).
 *  - payload present, `hydrated`  -> calls `processContactInput(payload,
 *    ownPubkeyHex)` EXACTLY ONCE — mode (a), or the completion of mode (b) —
 *    and returns its outcome wrapped as `{ state: 'complete', ...result }`.
 */
export function resolveAddDeepLink(
  hash: string,
  hydrated: boolean,
  ownPubkeyHex: string | null | undefined,
): AddDeepLinkOutcome {
  const payload = extractCardPayloadFromHash(hash);
  if (!payload) return { state: 'no_card' };
  if (!hydrated) return { state: 'awaiting_identity' };
  const result = processContactInput(payload, ownPubkeyHex);
  return { state: 'complete', ...result };
}
