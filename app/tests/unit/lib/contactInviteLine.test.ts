import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';
import { encodeCard, encodeCardV2, buildShareUrl } from '@/src/lib/contactCard';
import { deriveInviterName } from '@/src/lib/contactInviteLine';

const FIXED_CREATED_AT = 1735689600; // 2025-01-01T00:00:00Z
const FIXED_EXPIRES_AT = FIXED_CREATED_AT + 1800;

function makeIdentity() {
  const sk = generateSecretKey();
  const skHex = bytesToHex(sk);
  const pubkeyHex = getPublicKey(sk);
  const signer = createPrivateKeySigner(skHex);
  return { skHex, pubkeyHex, signer };
}

/** A deterministic, valid 16-byte pairing nonce (32 hex chars), mirroring contactCard.test.ts's fixture. */
function makeNonceHex(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = (i * 17 + 3) % 256;
  return bytesToHex(bytes);
}

/** Extract the `c=` payload from a card link built via buildShareUrl, for direct deriveInviterName() input. */
function payloadFromShareUrl(shareUrl: string): string {
  const idx = shareUrl.indexOf('#c=');
  if (idx === -1) throw new Error('not a card link');
  return shareUrl.slice(idx + '#c='.length);
}

describe('deriveInviterName (AC-CONTACT-2 / AC-CONTACT-3)', () => {
  it('returns the verified nickname for a signed v1 card', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const shareUrl = buildShareUrl(payload);
    expect(deriveInviterName(payloadFromShareUrl(shareUrl))).toBe('Alice');
  });

  it('returns the verified nickname for a signed v2 pairing card', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const encoded = await encodeCardV2(
      pubkeyHex,
      { nickname: 'Bob', createdAt: FIXED_CREATED_AT },
      makeNonceHex(),
      FIXED_EXPIRES_AT,
      signer.signEvent,
    );
    expect(deriveInviterName(encoded.cardB64Url)).toBe('Bob');
  });

  it('also accepts a full card link (not just the bare payload)', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Carol', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const shareUrl = buildShareUrl(payload);
    expect(deriveInviterName(shareUrl)).toBe('Carol');
  });

  it('returns null for a v1 card with no name (unsigned, pubkey-only)', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    // encodeCard emits an UNSIGNED (pubkey-only) card when nickname is empty (AC-CARD-6).
    const payload = await encodeCard(pubkeyHex, { nickname: '', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    expect(deriveInviterName(payload)).toBeNull();
  });

  it('returns null for a bare npub', () => {
    const { pubkeyHex } = makeIdentity();
    const npub = pubkeyToNpub(pubkeyHex);
    expect(deriveInviterName(npub)).toBeNull();
  });

  it('returns null for a nostr: URI wrapping an npub', () => {
    const { pubkeyHex } = makeIdentity();
    const npub = pubkeyToNpub(pubkeyHex);
    expect(deriveInviterName(`nostr:${npub}`)).toBeNull();
  });

  it('returns null for a malformed/unparseable payload', () => {
    expect(deriveInviterName('not-a-valid-payload!!!')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(deriveInviterName('')).toBeNull();
  });

  it('returns null for a tampered (signature-invalid) signed card', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Dave', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    // Flip the last character to invalidate the signature bytes without
    // touching the payload's length/shape.
    const tamperedChar = payload.at(-1) === 'A' ? 'B' : 'A';
    const tampered = payload.slice(0, -1) + tamperedChar;
    expect(deriveInviterName(tampered)).toBeNull();
  });

  // AC-CONTACT-2 output contract: the surfaced inviter name is the nickname's
  // *trimmed* form, and a nickname that is only whitespace surfaces no name at
  // all (null). encodeCard signs any non-empty nickname (only an EMPTY nickname
  // becomes an unsigned, pubkey-only card), and its UTF-8 round-trip does not
  // trim — so a padded or whitespace-only nickname reaches deriveInviterName
  // with the whitespace intact, making deriveInviterName the sole trim point.
  // Asserting `=== (nickname.trim() || null)` states the contract without
  // naming any internal branch, so it survives refactors of the derivation.
  describe('whitespace normalization of the surfaced name', () => {
    const nicknames = [
      'Alice', // no whitespace — unchanged
      '  Alice  ', // symmetric padding — trimmed
      ' Bob', // leading whitespace — trimmed
      'Carol ', // trailing whitespace — trimmed
      '   ', // whitespace-only — nothing remains, so null
      '\t\n ', // tab/newline-only — nothing remains, so null
    ];

    it.each(nicknames)('surfaces the trimmed name (or null when empty) for %j', async (nickname) => {
      const { pubkeyHex, signer } = makeIdentity();
      const payload = await encodeCard(pubkeyHex, { nickname, createdAt: FIXED_CREATED_AT }, signer.signEvent);
      const shareUrl = buildShareUrl(payload);
      const expected = nickname.trim().length > 0 ? nickname.trim() : null;
      expect(deriveInviterName(payloadFromShareUrl(shareUrl))).toBe(expected);
    });
  });
});
