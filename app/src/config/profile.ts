import { MAX_NAME_BYTES, truncateUtf8 } from '@/src/lib/contactCard';

/**
 * Authoritative nickname cap: the contact-card format's 32-UTF-8-byte name
 * limit (`MAX_NAME_BYTES`), re-exported under a profile-domain name so the
 * profile surface has a single import site. This is the same cap the card
 * encoder assumes — we deliberately reuse S1's constant rather than declaring
 * a competing number.
 */
export const NICKNAME_MAX_BYTES = MAX_NAME_BYTES;

/**
 * Cap a nickname to {@link NICKNAME_MAX_BYTES} UTF-8 bytes at save time,
 * cutting only on codepoint boundaries (a German umlaut counts as 2 bytes, an
 * emoji as 4 — never split mid-character). Delegates the byte counting and
 * truncation to `contactCard.truncateUtf8` (S1) — this is a thin profile-side
 * adapter, NOT a second byte-cap implementation. `capped` reports whether the
 * input exceeded the limit so the UI can surface a translated notice.
 */
export function capNickname(raw: string): { value: string; capped: boolean } {
  const value = truncateUtf8(raw, NICKNAME_MAX_BYTES);
  return { value, capped: value !== raw };
}

export const AVATAR_BROWSER_CONFIG = {
  defaultSubject: 'strawberry',
  endpointBaseUrl: '//few.chat/assets',
} as const;
