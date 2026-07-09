/**
 * shareCard.ts — pure card-production + cache-invalidation helpers for the
 * "Share contact card" surface (epic: contact-card-exchange, story S6).
 *
 * This is deliberately a thin, React-free layer sitting between the S1 codec
 * seam (`encodeCard`/`buildShareUrl` in `@/src/lib/contactCard`) and
 * settings.tsx. It exists so:
 *
 *   1. The signed-card cache's staleness rule (rebuild iff the nickname, the
 *      active signer mode, or the active identity's pubkey changed since the
 *      last build — VQ-S6-001, VQ-S6-006) is a plain, jsdom-free-testable
 *      pure function instead of logic buried in a React effect/callback. The
 *      pubkeyHex check guards a mid-session identity restore that lands on
 *      an unchanged (nickname, signerMode) pair — see `ShareCardCacheKey`.
 *   2. The exact production path settings.tsx uses (encodeCard -> buildShareUrl)
 *      can be exercised by adapter-mode unit tests (local-key / NIP-07-stub /
 *      NIP-46-stub) without importing settings.tsx or any React context.
 *
 * settings.tsx is the ONLY caller. It owns the actual signer selection
 * (`activeEventSignerOverride.current ?? createPrivateKeySigner(privateKeyHex)`,
 * the existing precedent — see IncomingCallWatcher.tsx) and passes it in via
 * `getSignEvent`, so this module never sees a private key and never imports
 * `signerAdapter` itself. `NpubQrModal.tsx` never imports this module either —
 * it only ever receives the resulting `shareUrl` string as a prop.
 */

import type { EventSigner } from 'applesauce-core';
import { encodeCard, buildShareUrl } from '@/src/lib/contactCard';
import type { SignerMode } from '@/src/context/NostrIdentityContext';

// ── Cache key/entry ──────────────────────────────────────────────────────

export type ShareCardCacheKey = {
  nickname: string;
  signerMode: SignerMode;
  /**
   * The active identity's pubkey at the time of build. Without this, a
   * mid-session identity restore (`replaceIdentity` swaps identity via
   * `setIdentity()` with no page reload — see NostrIdentityContext.tsx) that
   * lands on the same (nickname, signerMode) — e.g. two local-signer
   * identities that both have an empty nickname, the common default — would
   * be indistinguishable from the prior identity's key and produce a cache
   * HIT that serves the PREVIOUS identity's already-signed card (wrong
   * pubkey, stale signature) instead of rebuilding for the new one.
   */
  pubkeyHex: string;
};

export type ShareCardCacheEntry = {
  key: ShareCardCacheKey;
  shareUrl: string;
};

/**
 * True when `cached` is missing or stale relative to `key` — i.e. the
 * nickname, the active signer mode, or the active identity's pubkeyHex
 * differs from what the cache was built with. A repeat call with an
 * unchanged key returns false, which is what keeps a repeat share-modal
 * open from re-invoking a (possibly remote, NIP-46) signer (VQ-S6-001). A
 * nickname edit or a signer-mode switch (e.g. local -> NIP-46 mid-session)
 * correctly invalidates the cache (VQ-S6-006). A mid-session identity
 * restore (`replaceIdentity`, which swaps identity in place with no page
 * reload) that lands on the same (nickname, signerMode) — e.g. two
 * local-signer identities that both default to an empty nickname — is
 * caught by the pubkeyHex comparison instead, which is what prevents a
 * stale, wrong-identity signed card from being served on cache HIT.
 */
export function shouldRebuildShareCard(
  cached: ShareCardCacheEntry | null,
  key: ShareCardCacheKey,
): boolean {
  if (!cached) return true;
  return (
    cached.key.nickname !== key.nickname ||
    cached.key.signerMode !== key.signerMode ||
    cached.key.pubkeyHex !== key.pubkeyHex
  );
}

// ── Card production ──────────────────────────────────────────────────────

/**
 * Build the current user's contact card (signed, or — with an empty
 * nickname — unsigned per AC-CARD-6, `encodeCard`'s own graceful
 * degradation) and wrap it in the shareable onboarding URL. Adds no
 * encoding logic of its own; it exists so callers (and their tests) have a
 * single call instead of `encodeCard(...).then(buildShareUrl)` duplicated
 * at every site.
 */
export async function buildOwnShareCard(
  pubkeyHex: string,
  profile: { nickname: string; createdAt: number },
  signEvent: EventSigner['signEvent'],
): Promise<string> {
  const payload = await encodeCard(pubkeyHex, profile, signEvent);
  return buildShareUrl(payload);
}

// ── Cache-driven orchestration ───────────────────────────────────────────

export type GetOwnShareCardParams = {
  pubkeyHex: string;
  nickname: string;
  signerMode: SignerMode;
  /** The caller's current cache entry (or null on a cold start). */
  cache: ShareCardCacheEntry | null;
  /**
   * Lazily resolves the signer's `signEvent` function. Only invoked on a
   * cache MISS — a cache hit never calls this, which is what guarantees no
   * remote NIP-46 round trip happens on a repeat share-modal open with an
   * unchanged nickname/signerMode/pubkeyHex.
   */
  getSignEvent: () => Promise<EventSigner['signEvent']>;
  /** Injectable clock for deterministic tests; defaults to Date.now(). */
  now?: () => number;
};

export type GetOwnShareCardResult = {
  /** True iff the card was freshly (re)signed on this call. */
  rebuilt: boolean;
  shareUrl: string;
  /** The cache entry to persist for the next call. */
  cache: ShareCardCacheEntry;
};

/**
 * The single orchestration entry point settings.tsx calls when the user
 * opens the share-card modal: returns the cached share URL unchanged when
 * the (nickname, signerMode, pubkeyHex) key hasn't moved, otherwise resolves
 * a signer and rebuilds. Pure aside from `getSignEvent`/`now`, both
 * injected, so it is fully testable without React or a real signer.
 */
export async function getOwnShareCard(params: GetOwnShareCardParams): Promise<GetOwnShareCardResult> {
  const key: ShareCardCacheKey = {
    nickname: params.nickname,
    signerMode: params.signerMode,
    pubkeyHex: params.pubkeyHex,
  };
  const cached = params.cache;

  if (!shouldRebuildShareCard(cached, key)) {
    return { rebuilt: false, shareUrl: cached!.shareUrl, cache: cached! };
  }

  const signEvent = await params.getSignEvent();
  const createdAt = (params.now ?? (() => Math.floor(Date.now() / 1000)))();
  const shareUrl = await buildOwnShareCard(params.pubkeyHex, { nickname: params.nickname, createdAt }, signEvent);
  const cache: ShareCardCacheEntry = { key, shareUrl };
  return { rebuilt: true, shareUrl, cache };
}
