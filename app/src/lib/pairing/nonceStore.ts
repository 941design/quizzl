/**
 * nonceStore.ts — Issuer-side pairing-nonce lifecycle (epic: contact-pairing-
 * code, story S2; RD-2 in specs/epic-contact-pairing-code/architecture.md).
 *
 * Owns the single-rolling-active-nonce mint/reuse decision and the durable
 * record of every nonce this device has ever issued:
 *
 *   - `getOrMintActiveNonce` reuses the active nonce while the session is
 *     live and it is unexpired (AC-NONCE-1: no rotation on repeat display),
 *     mints a fresh one the first time this module runs after a page reload
 *     (AC-NONCE-2), and mints a fresh one when the active nonce has expired
 *     even with no reload (AC-NONCE-3). It never burns a nonce on use.
 *   - Every issued nonce is persisted (idb-keyval `few-pairing-nonces`,
 *     architecture.md boundary rule 7's `few-*` naming convention) keyed by
 *     its own value, together with its `expiresAt`, and remains queryable
 *     for at least `expiresAt + NONCE_GRACE_SEC` (AC-NONCE-4).
 *   - `isNonceAdmissible` is the pure, read-only `NonceAdmissibility` seam
 *     (specs/epic-contact-pairing-code/stories.json) S3's ack handler
 *     consumes as-is: true iff a nonce is present in the store and
 *     `nowSec <= storedExpiresAt + NONCE_GRACE_SEC` (AC-NONCE-5).
 *   - A nonce past its grace window is pruned no later than the next mint
 *     call (`getOrMintActiveNonce` triggers `pruneExpiredNonces` on every
 *     mint) or the next ack-processing pass — S3, out of this story's scope,
 *     calls the exported `pruneExpiredNonces` directly (AC-NONCE-6).
 *
 * Follows `profileRequestStorage.ts`'s idb-keyval convention: module-scope
 * `createStore`, small async CRUD, `few-*` naming (frozen `lp_*` is
 * localStorage-only and not used here). Pure stateless helpers (mint, the
 * admissibility comparison) are kept separable from the store I/O so the
 * boundary math is easy to reason about even though the store itself is
 * necessarily async.
 *
 * This module is a stateful adapter (imports idb-keyval, touches
 * `crypto.getRandomValues`) and therefore intentionally NOT part of the pure
 * codec layer (`contactCard.ts`) — see architecture.md's paradigm section
 * ("pure computation... stays free of React/storage/relay; stateful adapters
 * ... wrap it"). It imports no React.
 */

import { createStore, get, set, del, entries, clear } from 'idb-keyval';

// ── Constants (RD-2) ─────────────────────────────────────────────────────

/** Active-nonce validity window: 30 minutes, in seconds. */
export const NONCE_TTL_SEC = 30 * 60;

/**
 * Post-expiry grace window during which an issued (but no longer active)
 * nonce still admits an echoed pairing-ack: 2 hours, in seconds.
 */
export const NONCE_GRACE_SEC = 2 * 60 * 60;

/** A single issued nonce as persisted in the store. */
export type StoredNonce = {
  /** 32 lowercase hex characters (16 raw bytes). */
  nonce: string;
  /** Unix seconds. */
  expiresAt: number;
};

// ── Store ─────────────────────────────────────────────────────────────────

const nonceIdbStore = createStore('few-pairing-nonces', 'nonces');

function defaultNowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ── In-memory active-nonce pointer ───────────────────────────────────────

/**
 * The current session's active nonce, or `null` if this module has not
 * minted/loaded one yet this session. Module-scope state is what makes
 * "reload" a well-defined signal for AC-NONCE-2 without needing an explicit
 * persisted flag: a page reload always re-executes the module graph from
 * scratch, clearing this back to `null` — so the very next
 * `getOrMintActiveNonce` call is guaranteed to mint fresh. Within the same
 * session, repeat calls reuse this pointer (AC-NONCE-1) until it expires
 * (AC-NONCE-3).
 */
let activeNonce: StoredNonce | null = null;

/**
 * Test-only reset of the in-memory active-nonce pointer — simulates "a page
 * reload just happened" without needing `vi.resetModules()`. Mirrors
 * `ndkClient.ts`'s `_resetNdkSingleton` precedent. Does NOT touch the
 * persisted store (use `clearAllNonces` for that).
 */
export function _resetActiveNonceForTests(): void {
  activeNonce = null;
}

/**
 * Review-remediation (epic: contact-pairing-code, story S5, sev 3
 * correctness finding): a genuinely read-only accessor for the in-memory
 * active-nonce pointer. Unlike `getOrMintActiveNonce`, this NEVER mints,
 * persists, or prunes — it only returns whatever `activeNonce` currently
 * holds (or `null` if this module has not minted/loaded one yet this
 * session, or the previously-active nonce has since expired without a new
 * mint/reload having happened). Additive-only: `getOrMintActiveNonce`'s own
 * mint-on-expiry behavior (AC-NONCE-1/2/3) is unchanged.
 *
 * Exists because a caller that only wants to KNOW the active nonce for
 * read/display purposes (e.g. the admission-digest notification counting
 * admissions against it) must not have that read accidentally rotate the
 * issuer's nonce as a side effect — `getOrMintActiveNonce` is the wrong
 * primitive for that use, since it mints (a store write) whenever the
 * in-memory pointer is absent or expired.
 */
export function peekActiveNonce(): StoredNonce | null {
  return activeNonce;
}

// ── Store CRUD ────────────────────────────────────────────────────────────

/** Raw store read for a specific nonce value, or `undefined` if absent/pruned. */
export async function getStoredNonce(nonceHex: string): Promise<StoredNonce | undefined> {
  return get<StoredNonce>(nonceHex, nonceIdbStore);
}

/**
 * Delete every stored nonce whose `expiresAt + NONCE_GRACE_SEC` has passed
 * as of `nowSec`. Exported standalone (not only invoked internally by
 * `getOrMintActiveNonce`) so S3's ack-processing pass — the other AC-NONCE-6
 * prune trigger, out of this story's scope — can call it directly.
 */
export async function pruneExpiredNonces(nowSec: number = defaultNowSec()): Promise<void> {
  const all = await entries<string, StoredNonce>(nonceIdbStore);
  await Promise.all(
    all
      .filter(([, stored]) => nowSec > stored.expiresAt + NONCE_GRACE_SEC)
      .map(([key]) => del(key, nonceIdbStore)),
  );
}

/**
 * Delete every issued nonce and reset the in-memory active-nonce pointer —
 * a test/dev-reset helper mirroring `profileRequestStorage.ts`'s
 * `clearProfileRequestMemos('*')`.
 */
export async function clearAllNonces(): Promise<void> {
  await clear(nonceIdbStore);
  activeNonce = null;
}

// ── Mint ──────────────────────────────────────────────────────────────────

function mintNonceHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Return the issuer's current active pairing nonce, minting and persisting
 * a fresh one only when required (see `activeNonce`'s doc comment for why
 * the in-memory pointer alone is a sufficient reload signal):
 *
 *   - In-memory pointer set AND `nowSec <= activeNonce.expiresAt` → reuse it
 *     unchanged (AC-NONCE-1).
 *   - Otherwise (no pointer yet this session — i.e. the first call after a
 *     reload — or the pointer has expired) → mint 16 random bytes
 *     (`crypto.getRandomValues`), persist `{ nonce, expiresAt: nowSec +
 *     NONCE_TTL_SEC }`, update the pointer, prune expired-past-grace entries
 *     (AC-NONCE-6's mint-time trigger), and return the fresh entry
 *     (AC-NONCE-2, AC-NONCE-3).
 *
 * The nonce is never burned on use — only replaced on expiry or reload.
 */
export async function getOrMintActiveNonce(nowSec: number = defaultNowSec()): Promise<StoredNonce> {
  if (activeNonce && nowSec <= activeNonce.expiresAt) {
    return activeNonce;
  }
  const fresh: StoredNonce = { nonce: mintNonceHex(), expiresAt: nowSec + NONCE_TTL_SEC };
  await set(fresh.nonce, fresh, nonceIdbStore);
  activeNonce = fresh;
  await pruneExpiredNonces(nowSec);
  return fresh;
}

// ── Admissibility — the NonceAdmissibility seam S3 consumes ────────────────

const NONCE_HEX_RE = /^[0-9a-f]{32}$/i;

/**
 * The `NonceAdmissibility` seam contract (specs/epic-contact-pairing-code/
 * stories.json) — S3's `pairingAck.ts#handlePairingAck` calls this exactly
 * as written, without re-deriving the grace math itself.
 *
 * True iff `nonceHex` is present in the store (i.e. was minted by
 * `getOrMintActiveNonce` and not yet pruned) AND `nowSec <= storedExpiresAt
 * + NONCE_GRACE_SEC` (AC-NONCE-5). False for a nonce that was never issued,
 * a nonce past its grace boundary, or any malformed input (non-hex, wrong
 * length) — this function never throws.
 *
 * Read-only: never mutates or prunes the store, even when called with
 * attacker-influenced input (an echoed nonce from a received pairing-ack).
 * A predicate that pruned as a side effect of being queried would be usable
 * as a nonce-eviction oracle by anyone who can send a pairing-ack; pruning
 * only ever happens via `getOrMintActiveNonce`'s mint path or an explicit
 * `pruneExpiredNonces` call.
 */
export async function isNonceAdmissible(nonceHex: string, nowSec: number): Promise<boolean> {
  if (typeof nonceHex !== 'string' || !NONCE_HEX_RE.test(nonceHex)) return false;
  const stored = await get<StoredNonce>(nonceHex.toLowerCase(), nonceIdbStore);
  if (!stored) return false;
  return nowSec <= stored.expiresAt + NONCE_GRACE_SEC;
}
