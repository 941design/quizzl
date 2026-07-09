/**
 * contactCard.ts — Contact Card Format v1 (epic: contact-card-exchange, story S1).
 *
 * A pure, side-effect-free codec: bytes in, bytes out, sign/verify via
 * nostr-tools. No React, no storage, no relay, no NDK, no MarmotContext.
 * This is the seam every other story in the epic consumes — see
 * specs/epic-contact-card-exchange/architecture.md "Seams".
 *
 * Wire format (see spec.md "Contact Card Format v1"):
 *
 *   header (1 byte)     bits 7–6 = version (v1 = 0), bit 5 = SIGNED,
 *                        bit 4 = HAS_AVATAR (reserved, must be 0 in v1),
 *                        bits 3–0 reserved (must be 0).
 *   pubkey (32 bytes)    raw x-only secp256k1 public key.
 *   -- present iff SIGNED --
 *   created_at (4 bytes) uint32 big-endian, Unix seconds.
 *   name_len (1 byte)    UTF-8 byte length of name (0–32).
 *   name (name_len bytes) UTF-8 display name.
 *   sig (64 bytes)       NIP-01 kind-0 event signature over
 *                        { pubkey, created_at, kind:0, tags:[], content: CARD_CONTENT(name) }.
 *
 * The whole buffer is base64url-encoded (RFC 4648 §5, no padding).
 *
 * v1 is a STRICT parser: any header outside { version=0, HAS_AVATAR=0,
 * reserved=0 } is rejected rather than tolerated, so a future avatar/
 * extended layout cannot be misparsed by a v1 reader (AC-CARD-3).
 */

import { getEventHash, verifyEvent } from 'nostr-tools/pure';
import type { Event as NostrToolsEvent, UnsignedEvent } from 'nostr-tools';
import type { EventSigner } from 'applesauce-core';
import { hexToBytes, bytesToHex, npubToPubkeyHex } from '@/src/lib/nostrKeys';

// ── Constants ────────────────────────────────────────────────────────────

/** Maximum UTF-8 byte length of a card's display name (DD 11). */
export const MAX_NAME_BYTES = 32;

/** header(1) + pubkey(32) — the unsigned (pubkey-only) card length. */
const UNSIGNED_CARD_LEN = 1 + 32;

/**
 * Fixed byte overhead of a signed card excluding the name itself:
 * header(1) + pubkey(32) + created_at(4) + name_len(1) + sig(64) = 102.
 */
export const SIGNED_CARD_FIXED_OVERHEAD_BYTES = 1 + 32 + 4 + 1 + 64;

const HEADER_UNSIGNED = 0x00;
/** bit 5 set (0b00100000) — version bits 00, HAS_AVATAR 0, reserved 0000. */
const HEADER_SIGNED = 0x20;

/** The onboarding deep-link page's origin + path (spec.md, DD 9 — fragment-only). */
const CARD_LINK_URL_PREFIX = 'https://few.chat/add#c=';
/** Marker used to locate an embedded card payload inside a card link. */
const CARD_LINK_FRAGMENT_MARKER = '#c=';

// ── base64url (RFC 4648 §5, no padding) — no existing helper, so pure/local ──

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const B64URL_LOOKUP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < B64URL_ALPHABET.length; i++) {
    map[B64URL_ALPHABET[i]] = i;
  }
  return map;
})();

/** Encode raw bytes as a base64url string (RFC 4648 §5), no padding. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result += B64URL_ALPHABET[(chunk >> 18) & 0x3f];
    result += B64URL_ALPHABET[(chunk >> 12) & 0x3f];
    result += B64URL_ALPHABET[(chunk >> 6) & 0x3f];
    result += B64URL_ALPHABET[chunk & 0x3f];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    result += B64URL_ALPHABET[(chunk >> 18) & 0x3f];
    result += B64URL_ALPHABET[(chunk >> 12) & 0x3f];
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    result += B64URL_ALPHABET[(chunk >> 18) & 0x3f];
    result += B64URL_ALPHABET[(chunk >> 12) & 0x3f];
    result += B64URL_ALPHABET[(chunk >> 6) & 0x3f];
  }
  return result;
}

/**
 * Decode a base64url string (RFC 4648 §5, no padding) to raw bytes.
 * Returns null for any input containing characters outside the base64url
 * alphabet, or a length that cannot represent a whole number of bytes
 * (never throws).
 */
export function base64UrlToBytes(input: string): Uint8Array | null {
  if (input.length === 0) return new Uint8Array(0);
  // A valid unpadded base64 encoding never leaves exactly 6 leftover bits
  // (a single trailing char) — that is not enough to reconstruct a byte.
  if (input.length % 4 === 1) return null;
  for (let i = 0; i < input.length; i++) {
    if (!(input[i] in B64URL_LOOKUP)) return null;
  }
  const byteLength = Math.floor((input.length * 6) / 8);
  const out = new Uint8Array(byteLength);
  let buffer = 0;
  let bitsInBuffer = 0;
  let outIdx = 0;
  for (let i = 0; i < input.length; i++) {
    buffer = (buffer << 6) | B64URL_LOOKUP[input[i]];
    bitsInBuffer += 6;
    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      out[outIdx++] = (buffer >> bitsInBuffer) & 0xff;
    }
  }
  // Canonical-encoding check: any leftover bits after the last full byte must
  // be zero. A non-zero remainder means the input has a non-canonical
  // spelling — a different string that decodes to the same bytes plus
  // garbage padding bits — which would make the decoder non-injective and
  // could let two distinct base64url strings collide on the same payload.
  if (bitsInBuffer > 0 && (buffer & ((1 << bitsInBuffer) - 1)) !== 0) {
    return null;
  }
  return out;
}

// ── Canonical signed content ─────────────────────────────────────────────

/**
 * The ONE canonical signed-content builder, shared by encode and decode.
 * Determinism here is load-bearing (AC-SIG-5): any divergence between the
 * encoder's and decoder's content construction breaks every signature.
 */
export function CARD_CONTENT(name: string): string {
  return JSON.stringify({ name });
}

// ── Name normalization / truncation ──────────────────────────────────────

/**
 * Normalize a name by round-tripping it through UTF-8 encode→decode.
 * TextEncoder always produces well-formed UTF-8, substituting an unpaired
 * surrogate with U+FFFD's UTF-8 bytes; decoding those bytes back yields a
 * string with no unpaired surrogates. Signing over this normalized string
 * (rather than the raw input) keeps encode and decode byte-identical, so an
 * unpaired surrogate is normalized at sign time instead of silently
 * mismatching on import (AC-SIG-5).
 */
function normalizeUtf8RoundTrip(name: string): string {
  const bytes = new TextEncoder().encode(name);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * UTF-8 byte length of a string. Shared pure helper — exported so other
 * stories in the epic (e.g. S3's profile nickname 32-byte cap) can reuse the
 * exact byte-counting rule instead of re-implementing it (a multi-owner risk
 * on the "card-name-byte-cap" concept, per cross-story review).
 */
export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Truncate a string to at most `maxBytes` UTF-8 bytes, cutting only on a
 * codepoint boundary (never mid-character, never producing a broken
 * multi-byte sequence). Iterating a JS string with `for...of` walks by
 * Unicode codepoint, keeping surrogate pairs (e.g. emoji) intact. Exported
 * for the same cross-story reuse reason as `utf8ByteLength`.
 */
export function truncateUtf8(s: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(s).length <= maxBytes) return s;
  let byteCount = 0;
  let result = '';
  for (const ch of s) {
    const chByteLen = encoder.encode(ch).length;
    if (byteCount + chByteLen > maxBytes) break;
    byteCount += chByteLen;
    result += ch;
  }
  return result;
}

// ── Binary pack helpers ───────────────────────────────────────────────────

function assertPubkeyHex(pubkeyHex: string): void {
  if (!/^[0-9a-f]{64}$/i.test(pubkeyHex)) {
    throw new Error('contactCard: pubkeyHex must be 64 hex characters');
  }
}

function packUnsigned(pubkeyHex: string): Uint8Array {
  const buf = new Uint8Array(UNSIGNED_CARD_LEN);
  buf[0] = HEADER_UNSIGNED;
  buf.set(hexToBytes(pubkeyHex), 1);
  return buf;
}

function packSigned(pubkeyHex: string, createdAt: number, name: string, sigHex: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const sigBytes = hexToBytes(sigHex);
  const buf = new Uint8Array(SIGNED_CARD_FIXED_OVERHEAD_BYTES + nameBytes.length);
  let offset = 0;
  buf[offset++] = HEADER_SIGNED;
  buf.set(hexToBytes(pubkeyHex), offset);
  offset += 32;
  buf[offset++] = (createdAt >>> 24) & 0xff;
  buf[offset++] = (createdAt >>> 16) & 0xff;
  buf[offset++] = (createdAt >>> 8) & 0xff;
  buf[offset++] = createdAt & 0xff;
  buf[offset++] = nameBytes.length;
  buf.set(nameBytes, offset);
  offset += nameBytes.length;
  buf.set(sigBytes, offset);
  return buf;
}

// ── encodeCard ─────────────────────────────────────────────────────────────

/**
 * Build and sign a contact card for `pubkeyHex`, returning the base64url
 * payload.
 *
 * If `nickname` is empty, emits an UNSIGNED (pubkey-only) card — equivalent
 * to sharing a bare npub (AC-CARD-6, DD 10). Otherwise the name is
 * normalized (UTF-8 round trip, so an unpaired surrogate cannot silently
 * mismatch the signature) and truncated to `MAX_NAME_BYTES` on a codepoint
 * boundary (AC-CARD-5) before being signed as a NIP-01 kind-0 event via the
 * supplied `signEvent` — the same `EventSigner.signEvent` shape used by
 * `createPrivateKeySigner` / NIP-46 / NIP-07 adapters
 * (`app/src/lib/marmot/signerAdapter.ts`), so this works in every signer
 * mode.
 */
export async function encodeCard(
  pubkeyHex: string,
  profile: { nickname: string; createdAt: number },
  signEvent: EventSigner['signEvent'],
): Promise<string> {
  assertPubkeyHex(pubkeyHex);
  // Normalize to lowercase so the packed bytes and the post-sign equality
  // check below agree in case — nostr-tools always returns a lowercase
  // `pubkey`, but assertPubkeyHex accepts either case.
  pubkeyHex = pubkeyHex.toLowerCase();

  if (
    !Number.isInteger(profile.createdAt) ||
    profile.createdAt < 0 ||
    profile.createdAt > 0xffffffff
  ) {
    throw new Error('contactCard: createdAt must be a uint32 Unix-seconds integer');
  }

  const normalized = normalizeUtf8RoundTrip(profile.nickname);
  if (normalized.length === 0) {
    return bytesToBase64Url(packUnsigned(pubkeyHex));
  }

  const name = truncateUtf8(normalized, MAX_NAME_BYTES);
  const draft = {
    kind: 0,
    created_at: profile.createdAt,
    tags: [] as string[][],
    content: CARD_CONTENT(name),
  };
  const signed = await signEvent(draft);
  if (signed.pubkey !== pubkeyHex) {
    throw new Error('contactCard: signer pubkey does not match the supplied pubkeyHex');
  }
  // Pack the SIGNED created_at (what the signature actually covers), not the
  // input value — they are equal only by convention, and a signer that
  // overrides created_at would otherwise make the packed field diverge from
  // what verifyEvent checks, failing every fresh card's own decodeCard.
  return bytesToBase64Url(packSigned(pubkeyHex, signed.created_at, name, signed.sig));
}

/** Build the shareable onboarding URL for a card payload (DD 9 — hash fragment, never sent to the server). */
export function buildShareUrl(payload: string): string {
  return `${CARD_LINK_URL_PREFIX}${payload}`;
}

// ── decodeCard ─────────────────────────────────────────────────────────────

export type DecodedCard = {
  version: 0;
  pubkeyHex: string;
  profile?: { nickname: string; createdAt: number };
};

export type DecodeCardResult = DecodedCard | { error: string };

/**
 * Strictly parse and (for signed cards) verify a base64url card payload.
 * Never throws — any malformed or adversarial input yields `{ error }`
 * (VQ-S1-006).
 */
export function decodeCard(b64url: string): DecodeCardResult {
  try {
    const bytes = base64UrlToBytes(b64url);
    if (!bytes) return { error: 'contactCard: not a valid base64url payload' };
    if (bytes.length < UNSIGNED_CARD_LEN) return { error: 'contactCard: payload too short' };

    const header = bytes[0];
    const version = (header >> 6) & 0x03;
    if (version !== 0) return { error: 'contactCard: unsupported version' };
    const hasAvatar = (header >> 4) & 0x01;
    if (hasAvatar !== 0) return { error: 'contactCard: HAS_AVATAR is reserved and must be unset in v1' };
    const reserved = header & 0x0f;
    if (reserved !== 0) return { error: 'contactCard: reserved header bits must be unset' };
    const signed = ((header >> 5) & 0x01) === 1;

    const pubkeyHex = bytesToHex(bytes.slice(1, UNSIGNED_CARD_LEN));

    if (!signed) {
      if (bytes.length !== UNSIGNED_CARD_LEN) {
        return { error: 'contactCard: unsigned payload has unexpected trailing bytes' };
      }
      return { version: 0, pubkeyHex };
    }

    const HEADER_LEN = 1;
    const PUBKEY_LEN = 32;
    const CREATED_AT_LEN = 4;
    const NAME_LEN_LEN = 1;
    const SIG_LEN = 64;
    const minSignedLen = HEADER_LEN + PUBKEY_LEN + CREATED_AT_LEN + NAME_LEN_LEN;
    if (bytes.length < minSignedLen) {
      return { error: 'contactCard: signed payload truncated before name_len' };
    }

    let offset = HEADER_LEN + PUBKEY_LEN;
    const createdAt =
      ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    offset += CREATED_AT_LEN;
    const nameLen = bytes[offset];
    offset += NAME_LEN_LEN;

    if (nameLen > MAX_NAME_BYTES) return { error: 'contactCard: name_len exceeds the 32-byte cap' };

    const expectedLen = HEADER_LEN + PUBKEY_LEN + CREATED_AT_LEN + NAME_LEN_LEN + nameLen + SIG_LEN;
    if (bytes.length !== expectedLen) {
      return { error: 'contactCard: payload length inconsistent with name_len' };
    }

    const nameBytes = bytes.slice(offset, offset + nameLen);
    offset += nameLen;
    const sigBytes = bytes.slice(offset, offset + SIG_LEN);
    const sigHex = bytesToHex(sigBytes);

    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    } catch {
      return { error: 'contactCard: name is not valid UTF-8' };
    }

    const unsignedEvent: UnsignedEvent = {
      pubkey: pubkeyHex,
      created_at: createdAt,
      kind: 0,
      tags: [],
      content: CARD_CONTENT(name),
    };
    // AC-SIG-6: verifyEvent rejects any event without a matching `id`, so the
    // computed hash MUST be attached before calling it — an id-less
    // reconstruction would fail closed for every card, valid or not.
    const id = getEventHash(unsignedEvent);
    const fullEvent = { ...unsignedEvent, id, sig: sigHex } as NostrToolsEvent;

    let verified = false;
    try {
      verified = verifyEvent(fullEvent);
    } catch {
      verified = false;
    }
    if (!verified) return { error: 'contactCard: signature verification failed' };

    return { version: 0, pubkeyHex, profile: { nickname: name, createdAt } };
  } catch {
    return { error: 'contactCard: malformed payload' };
  }
}

// ── parseContactCard — the single decode seam ────────────────────────────

export type ParseContactCardResult =
  | { pubkeyHex: string }
  | { pubkeyHex: string; profile: { nickname: string; updatedAt: string } }
  | { error: string };

/**
 * The single canonical decoder every npub entry point routes through
 * (architecture.md DD 1). Accepts a bare npub, a card link
 * (`https://few.chat/add#c=<b64url>`), or a raw base64url card payload.
 * Never throws (AC-PARSE-5).
 */
export function parseContactCard(input: string): ParseContactCardResult {
  try {
    if (typeof input !== 'string') return { error: 'contactCard: input must be a string' };
    const rawTrimmed = input.trim();
    if (rawTrimmed.length === 0) return { error: 'contactCard: empty input' };

    // A NIP-21 `nostr:` URI is a legitimate way to express an npub — other
    // clients copy npubs in this form. Strip an optional scheme prefix so the
    // npub branch below recognises `nostr:npub1…`. normaliseScanPayload already
    // strips this for the scan path; doing it here at the single decode seam
    // also covers the paste path at every caller (AddContactModal, invite,
    // /add page) without each re-implementing the strip. A card link
    // (https://few.chat/add#c=…) or raw base64url payload never carries this
    // prefix, so the strip is a no-op for the card branch.
    const trimmed = rawTrimmed.toLowerCase().startsWith('nostr:')
      ? rawTrimmed.slice('nostr:'.length).trim()
      : rawTrimmed;
    if (trimmed.length === 0) return { error: 'contactCard: empty input' };

    // bech32 is case-insensitive (all-upper or all-lower, never mixed), and
    // QR alphanumeric mode commonly encodes an uppercase NPUB1…; detect the
    // npub branch case-insensitively so an uppercase npub is not misrouted
    // into the card decoder. npubToPubkeyHex/nip19.decode accept either case.
    if (trimmed.toLowerCase().startsWith('npub1')) {
      const pubkeyHex = npubToPubkeyHex(trimmed);
      if (!pubkeyHex) return { error: 'contactCard: invalid npub' };
      return { pubkeyHex };
    }

    let payload = trimmed;
    const markerIdx = trimmed.indexOf(CARD_LINK_FRAGMENT_MARKER);
    if (markerIdx !== -1) {
      payload = trimmed.slice(markerIdx + CARD_LINK_FRAGMENT_MARKER.length);
    }
    if (payload.length === 0) return { error: 'contactCard: empty card payload' };

    const decoded = decodeCard(payload);
    if ('error' in decoded) return { error: decoded.error };

    if (!decoded.profile) {
      return { pubkeyHex: decoded.pubkeyHex };
    }

    return {
      pubkeyHex: decoded.pubkeyHex,
      profile: {
        nickname: decoded.profile.nickname,
        updatedAt: new Date(decoded.profile.createdAt * 1000).toISOString(),
      },
    };
  } catch {
    return { error: 'contactCard: unparseable input' };
  }
}
