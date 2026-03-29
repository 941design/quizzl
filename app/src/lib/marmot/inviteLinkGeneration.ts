/**
 * Pure utility functions for invite link generation.
 *
 * Separated from the modal component for testability.
 */

const INVITE_BASE_URL = 'https://quizzl.941design.de/groups';

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
  const url = new URL(INVITE_BASE_URL);
  url.searchParams.set('join', params.nonce);
  url.searchParams.set('admin', params.adminNpub);
  url.searchParams.set('name', params.groupName);
  return url.toString();
}
