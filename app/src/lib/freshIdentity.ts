/**
 * First-launch detection (AC-DETECT-1, AC-DETECT-2).
 *
 * "First-time visitor" is derived purely from whether a stored identity
 * existed at this page load's init — no new persisted marker is introduced.
 * `NostrIdentityContext.tsx` calls `loadStoredIdentity()` on mount; when that
 * call returns null, it auto-generates and saves a new keypair. The
 * `isFreshIdentity` signal must reflect the *pre*-auto-generation result, so
 * a returning first-timer who reloads the page after their identity was
 * generated and saved sees `isFreshIdentity = false` on that reload.
 *
 * Extracted as a small pure function so the derivation is unit-testable
 * without jsdom (this repo's unit tests are plain vitest, no DOM).
 */
import type { StoredNostrIdentity } from '@/src/lib/nostrKeys';

/**
 * Returns true iff no identity existed in storage at this init — i.e.
 * `loadStoredIdentity()` returned null before auto-generation ran.
 *
 * Callers must pass the result captured *before* any auto-generation/save
 * step, since this function only observes that pre-generation snapshot; it
 * does not itself read storage.
 */
export function deriveIsFreshIdentity(storedIdentityAtInit: StoredNostrIdentity | null): boolean {
  return storedIdentityAtInit === null;
}
