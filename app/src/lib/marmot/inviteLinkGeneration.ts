/**
 * Pure utility functions for invite link generation.
 *
 * Separated from the modal component for testability.
 */

/**
 * Production origin used only as a fallback when no browser `window` is
 * available (e.g. during the static-export build or in a non-DOM test
 * environment). At runtime the invite link is built from the current
 * `window.location.origin`, so a link always points back to whichever
 * deployment the inviter is actually using — surviving domain/brand changes
 * without a code edit.
 */
const FALLBACK_ORIGIN = 'https://nostling.941design.de';

/**
 * Resolve the base URL for invite links from the current document origin,
 * falling back to the production origin outside the browser.
 *
 * The path is `/groups/` (trailing slash) to match `trailingSlash: true` in
 * next.config — the canonically served path on GitHub Pages.
 */
function resolveInviteBaseUrl(): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : FALLBACK_ORIGIN;
  return `${origin}/groups/`;
}

/**
 * Generate a 16-byte random nonce as a 32-character hex string.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build a full invite link URL from its components.
 */
export function buildInviteUrl(params: {
  nonce: string;
  adminNpub: string;
  groupName: string;
}): string {
  const url = new URL(resolveInviteBaseUrl());
  url.searchParams.set('join', params.nonce);
  url.searchParams.set('admin', params.adminNpub);
  url.searchParams.set('name', params.groupName);
  return url.toString();
}
