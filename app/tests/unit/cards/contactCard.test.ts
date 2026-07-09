import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, getEventHash, verifyEvent } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';
import {
  CARD_CONTENT,
  encodeCard,
  buildShareUrl,
  decodeCard,
  parseContactCard,
  bytesToBase64Url,
  base64UrlToBytes,
  MAX_NAME_BYTES,
  SIGNED_CARD_FIXED_OVERHEAD_BYTES,
  utf8ByteLength,
  truncateUtf8,
} from '@/src/lib/contactCard';

const FIXED_CREATED_AT = 1735689600; // 2025-01-01T00:00:00Z

function makeIdentity() {
  const sk = generateSecretKey();
  const skHex = bytesToHex(sk);
  const pubkeyHex = getPublicKey(sk);
  const signer = createPrivateKeySigner(skHex);
  return { skHex, pubkeyHex, signer };
}

// ── base64url ──────────────────────────────────────────────────────────────

describe('base64url (RFC 4648 §5, no padding)', () => {
  it('round-trips byte buffers of every length-mod-3 remainder', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 6, 7, 16, 33, 107]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) % 256;
      const encoded = bytesToBase64Url(bytes);
      expect(encoded).not.toContain('=');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      const decoded = base64UrlToBytes(encoded);
      expect(decoded).not.toBeNull();
      expect(Array.from(decoded!)).toEqual(Array.from(bytes));
    }
  });

  it('rejects a non-base64url character rather than throwing', () => {
    expect(() => base64UrlToBytes('abc!def')).not.toThrow();
    expect(base64UrlToBytes('abc!def')).toBeNull();
    expect(base64UrlToBytes('has spaces')).toBeNull();
    expect(base64UrlToBytes('has+plus')).toBeNull();
    expect(base64UrlToBytes('has/slash')).toBeNull();
  });

  it('rejects a length that cannot represent a whole number of bytes', () => {
    // length % 4 === 1 leaves only 6 leftover bits — not enough for a byte.
    expect(base64UrlToBytes('a')).toBeNull();
    expect(base64UrlToBytes('abcde')).toBeNull();
  });

  it('empty input round-trips to an empty buffer', () => {
    expect(bytesToBase64Url(new Uint8Array(0))).toBe('');
    expect(Array.from(base64UrlToBytes('')!)).toEqual([]);
  });

  it('rejects a non-canonical spelling (non-zero padding bits) of an otherwise valid payload', () => {
    // 'AC' and 'AA' both decode to the single byte 0x00, but 'AC' leaves
    // non-zero trailing bits — a non-canonical spelling that must be
    // rejected so the decoder stays injective (one payload, one spelling).
    expect(base64UrlToBytes('AC')).toBeNull();
    expect(Array.from(base64UrlToBytes('AA')!)).toEqual([0]);

    // Same shape at the length%4===3 boundary ('AAC' vs 'AAA').
    expect(base64UrlToBytes('AAC')).toBeNull();
    expect(Array.from(base64UrlToBytes('AAA')!)).toEqual([0, 0]);
  });
});

// ── CARD_CONTENT — the shared canonical builder (AC-SIG-5) ─────────────────

describe('CARD_CONTENT', () => {
  it('is exactly {"name":"<name>"} with no other keys or whitespace', () => {
    expect(CARD_CONTENT('Alice')).toBe('{"name":"Alice"}');
  });

  it('is deterministic across repeated calls', () => {
    expect(CARD_CONTENT('Bob')).toBe(CARD_CONTENT('Bob'));
  });

  it('JSON-escapes quotes and backslashes', () => {
    expect(CARD_CONTENT('a"b\\c')).toBe('{"name":"a\\"b\\\\c"}');
  });
});

// ── AC-CARD-1 — round trip ──────────────────────────────────────────────────

describe('AC-CARD-1: encode/decode round trip', () => {
  it('yields the same pubkeyHex and name, version 0, SIGNED implied by profile presence', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    expect(decoded.version).toBe(0);
    expect(decoded.pubkeyHex).toBe(pubkeyHex);
    expect(decoded.profile).toBeDefined();
    expect(decoded.profile!.nickname).toBe('Alice');
    expect(decoded.profile!.createdAt).toBe(FIXED_CREATED_AT);
  });
});

// ── AC-CARD-2 — exact byte layout + malformed-length rejection ─────────────

describe('AC-CARD-2: byte layout', () => {
  it('matches header(1)+pubkey(32)+created_at(4,BE)+name_len(1)+name+sig(64) exactly', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes = base64UrlToBytes(payload)!;

    expect(bytes[0]).toBe(0x20); // SIGNED flag, version 0, no reserved bits
    expect(bytesToHex(bytes.slice(1, 33))).toBe(pubkeyHex);

    const createdAtBytes = bytes.slice(33, 37);
    const recoveredCreatedAt =
      ((createdAtBytes[0] << 24) | (createdAtBytes[1] << 16) | (createdAtBytes[2] << 8) | createdAtBytes[3]) >>> 0;
    expect(recoveredCreatedAt).toBe(FIXED_CREATED_AT);

    const nameLen = bytes[37];
    expect(nameLen).toBe(5); // 'Alice'.length UTF-8 bytes
    const name = new TextDecoder().decode(bytes.slice(38, 38 + nameLen));
    expect(name).toBe('Alice');

    expect(bytes.length).toBe(SIGNED_CARD_FIXED_OVERHEAD_BYTES + nameLen);
    const sig = bytes.slice(38 + nameLen, 38 + nameLen + 64);
    expect(sig.length).toBe(64);
  });

  it('rejects a payload one byte shorter than name_len implies (truncated sig)', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes = base64UrlToBytes(payload)!;
    const truncated = bytes.slice(0, bytes.length - 1);
    const decoded = decodeCard(bytesToBase64Url(truncated));
    expect('error' in decoded).toBe(true);
  });

  it('rejects a payload one byte longer than name_len implies (extra trailing byte)', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes = base64UrlToBytes(payload)!;
    const extended = new Uint8Array(bytes.length + 1);
    extended.set(bytes, 0);
    extended[bytes.length] = 0x00;
    const decoded = decodeCard(bytesToBase64Url(extended));
    expect('error' in decoded).toBe(true);
  });

  it('generalizes the length check across small (0) and large (30) name_len values, off by more than one byte', async () => {
    const { pubkeyHex, signer } = makeIdentity();

    // A signed card with name_len=0 is a legal v1 layout (0-32 bytes allowed) but never
    // produced by encodeCard (an empty nickname takes the unsigned path, AC-CARD-6) -- build
    // it by hand to exercise decodeCard's length check at this boundary directly.
    const pubkeyBytes = Uint8Array.from(pubkeyHex.match(/../g)!.map((byte) => parseInt(byte, 16)));
    const nameLenZeroBuf = new Uint8Array(1 + 32 + 4 + 1 + 64); // header + pubkey + created_at + name_len(0) + sig
    nameLenZeroBuf[0] = 0x20;
    nameLenZeroBuf.set(pubkeyBytes, 1);
    nameLenZeroBuf[37] = 0; // name_len = 0
    const shortNameLenZero = nameLenZeroBuf.slice(0, nameLenZeroBuf.length - 3); // 3 bytes short
    expect('error' in decodeCard(bytesToBase64Url(shortNameLenZero))).toBe(true);

    const name30 = 'B'.repeat(30);
    const payload30 = await encodeCard(pubkeyHex, { nickname: name30, createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes30 = base64UrlToBytes(payload30)!;
    // bytes30 layout: header(1)+pubkey(32)+created_at(4)+name_len(1)+name(30)+sig(64) = 132
    expect(bytes30.length).toBe(1 + 32 + 4 + 1 + 30 + 64);
    const shortBySeveral = bytes30.slice(0, bytes30.length - 5); // drop 5 sig bytes
    expect('error' in decodeCard(bytesToBase64Url(shortBySeveral))).toBe(true);

    const paddedBySeveral = new Uint8Array(bytes30.length + 5);
    paddedBySeveral.set(bytes30, 0);
    expect('error' in decodeCard(bytesToBase64Url(paddedBySeveral))).toBe(true);
  });
});

// ── AC-CARD-3 — strict v1 header rejection ──────────────────────────────────

describe('AC-CARD-3: strict header rejection', () => {
  it.each([
    ['version bit set', 0x40],
    ['HAS_AVATAR bit set', 0x10],
    ['reserved bit set', 0x01],
  ])('rejects a signed-card header with %s', async (_label, bitToSet) => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes = base64UrlToBytes(payload)!;
    const mutated = new Uint8Array(bytes);
    mutated[0] = mutated[0] | bitToSet;
    const decoded = decodeCard(bytesToBase64Url(mutated));
    expect('error' in decoded).toBe(true);
  });

  it('a well-formed v1 header (0x00 unsigned, 0x20 signed) is accepted', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const signedPayload = await encodeCard(
      pubkeyHex,
      { nickname: 'Alice', createdAt: FIXED_CREATED_AT },
      signer.signEvent,
    );
    expect('error' in decodeCard(signedPayload)).toBe(false);

    const unsignedPayload = await encodeCard(pubkeyHex, { nickname: '', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    expect('error' in decodeCard(unsignedPayload)).toBe(false);
  });
});

// ── AC-CARD-4 — length bound at the name cap ────────────────────────────────

describe('AC-CARD-4: length bound at the 32-byte name cap', () => {
  it('a signed card at the cap encodes to <=180 chars, and its share URL to <=205 chars', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const name32 = 'A'.repeat(MAX_NAME_BYTES);
    const payload = await encodeCard(pubkeyHex, { nickname: name32, createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const shareUrl = buildShareUrl(payload);

    expect(payload.length).toBeLessThanOrEqual(180);
    expect(shareUrl.length).toBeLessThanOrEqual(205);

    // Confirm the boundary is real: decoding the actual payload recovers the full name.
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    expect(decoded.profile!.nickname).toBe(name32);
  });
});

// ── AC-CARD-5 — codepoint-safe truncation ───────────────────────────────────

describe('AC-CARD-5: 32-UTF-8-byte codepoint-safe truncation', () => {
  it('truncates 31 ASCII bytes + a 4-byte emoji (35 bytes) down to the 31 ASCII bytes, never a broken sequence', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const name = 'a'.repeat(31) + '\u{1F600}'; // 31 + 4 = 35 bytes
    const payload = await encodeCard(pubkeyHex, { nickname: name, createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    expect(decoded.profile!.nickname).toBe('a'.repeat(31));
    expect(new TextEncoder().encode(decoded.profile!.nickname).length).toBeLessThanOrEqual(MAX_NAME_BYTES);
    // Never contains a replacement char from a broken byte sequence.
    expect(decoded.profile!.nickname).not.toContain('�');
  });

  it('truncates 8 four-byte emoji (32 bytes exactly) intact, dropping the 9th', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const emoji = '\u{1F600}';
    const name = emoji.repeat(9); // 36 bytes
    const payload = await encodeCard(pubkeyHex, { nickname: name, createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    expect(decoded.profile!.nickname).toBe(emoji.repeat(8));
    expect(new TextEncoder().encode(decoded.profile!.nickname).length).toBe(32);
  });

  it('a name already within the cap is not truncated', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Bärbel', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    expect(decoded.profile!.nickname).toBe('Bärbel');
  });
});

// ── AC-CARD-6 — unsigned (pubkey-only) card ─────────────────────────────────

describe('AC-CARD-6: unsigned card (no nickname)', () => {
  it('encoding with an empty nickname yields a decoded { pubkeyHex } with no profile', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: '', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    expect(decoded.pubkeyHex).toBe(pubkeyHex);
    expect(decoded.profile).toBeUndefined();
    expect('profile' in decoded).toBe(false);
  });

  it('the unsigned payload does not require created_at, name, or sig bytes (33-byte buffer)', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: '', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes = base64UrlToBytes(payload)!;
    expect(bytes.length).toBe(33); // header(1) + pubkey(32) only
    expect(bytes[0]).toBe(0x00);
  });

  it('rejects an unsigned payload with one extra trailing byte (34 bytes)', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: '', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes = base64UrlToBytes(payload)!;
    const extended = new Uint8Array(bytes.length + 1);
    extended.set(bytes, 0);
    extended[bytes.length] = 0x00;
    const decoded = decodeCard(bytesToBase64Url(extended));
    expect('error' in decoded).toBe(true);
  });
});

// ── AC-SIG-1 — fresh signed card verifies ───────────────────────────────────

describe('AC-SIG-1: signature verification', () => {
  it('a freshly encoded signed card verifies as a NIP-01 kind-0 event', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
  });
});

// ── AC-SIG-2/3/4 — tamper-and-reject ─────────────────────────────────────────

describe('AC-SIG-2: tampered name is rejected', () => {
  it('flipping a byte inside the name causes verification to fail', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes = base64UrlToBytes(payload)!;
    const nameOffset = 1 + 32 + 4 + 1; // header + pubkey + created_at + name_len
    const mutated = new Uint8Array(bytes);
    mutated[nameOffset] = mutated[nameOffset] ^ 0x02; // 'A' (0x41) -> 'C' (0x43), still ASCII
    const decoded = decodeCard(bytesToBase64Url(mutated));
    expect('error' in decoded).toBe(true);
    if (!('error' in decoded)) throw new Error('unreachable');
  });
});

describe('created_at is bound to the signature', () => {
  it('flipping a byte inside created_at (offset 33) causes verification to fail', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes = base64UrlToBytes(payload)!;
    const mutated = new Uint8Array(bytes);
    mutated[33] = mutated[33] ^ 0xff; // inside the created_at field (offset 33..37)
    const decoded = decodeCard(bytesToBase64Url(mutated));
    expect('error' in decoded).toBe(true);
  });
});

describe('AC-SIG-3: tampered pubkey is rejected', () => {
  it('flipping a byte inside the pubkey causes verification to fail', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes = base64UrlToBytes(payload)!;
    const mutated = new Uint8Array(bytes);
    mutated[5] = mutated[5] ^ 0xff; // inside the pubkey field (offset 1..33)
    const decoded = decodeCard(bytesToBase64Url(mutated));
    expect('error' in decoded).toBe(true);
  });
});

describe('AC-SIG-4: signature produced by a different key is rejected', () => {
  it('splicing another identity\'s signature onto this card fails verification', async () => {
    const a = makeIdentity();
    const b = makeIdentity();
    const payloadA = await encodeCard(a.pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, a.signer.signEvent);
    const payloadB = await encodeCard(b.pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, b.signer.signEvent);
    const bytesA = base64UrlToBytes(payloadA)!;
    const bytesB = base64UrlToBytes(payloadB)!;

    // Same nickname/created_at => identical layout/offsets; splice B's sig into A's buffer.
    const sigOffset = 1 + 32 + 4 + 1 + 'Alice'.length;
    const franken = new Uint8Array(bytesA);
    franken.set(bytesB.slice(sigOffset, sigOffset + 64), sigOffset);

    const decoded = decodeCard(bytesToBase64Url(franken));
    expect('error' in decoded).toBe(true);
  });
});

// ── AC-SIG-5 — shared CARD_CONTENT builder over varied name classes ────────

describe('AC-SIG-5: round trip holds across name classes', () => {
  it.each([
    ['ASCII with quotes and backslashes', 'She said "hi" \\o/'],
    ['German umlauts', 'Müller Käse'],
    ['emoji', '🎉 Party 🎈'],
  ])('round-trips %s', async (_label, name) => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: name, createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    // Names here are all <=32 UTF-8 bytes, so no truncation should occur.
    expect(decoded.profile!.nickname).toBe(name);
  });

  it('normalizes an unpaired surrogate at sign time rather than mangling it silently on import', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const nameWithLoneSurrogate = 'A\uD800B'; // lone high surrogate, invalid UTF-16 on its own
    const payload = await encodeCard(
      pubkeyHex,
      { nickname: nameWithLoneSurrogate, createdAt: FIXED_CREATED_AT },
      signer.signEvent,
    );
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    // TextEncoder/TextDecoder normalize the lone surrogate to U+FFFD deterministically;
    // both encode and decode agree, so the signature verifies over the SAME string.
    expect(decoded.profile!.nickname).toBe('A�B');
  });

  it('encode and decode build CARD_CONTENT through the one shared helper', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Zoë', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    // If encode/decode used two independently-written content builders, this would still
    // pass by luck for ASCII names — the umlaut/escaping/surrogate cases above are what
    // actually pin the two call sites to CARD_CONTENT's single definition.
    expect(CARD_CONTENT(decoded.profile!.nickname)).toBe(CARD_CONTENT('Zoë'));
  });
});

// ── AC-SIG-6 — id-attachment guard ──────────────────────────────────────────

describe('AC-SIG-6: verification requires a computed id attached before verifyEvent', () => {
  it('an id-less reconstruction of a validly-signed event is rejected; the id-attached one verifies', () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const unsignedEvent = {
      pubkey,
      created_at: FIXED_CREATED_AT,
      kind: 0,
      tags: [] as string[][],
      content: CARD_CONTENT('Alice'),
    };
    const id = getEventHash(unsignedEvent);
    // Sign the real hash with schnorr via createPrivateKeySigner's own path is overkill here;
    // reuse finalizeEvent-equivalent by encoding through the real card pipeline instead:
    const signer = createPrivateKeySigner(bytesToHex(sk));
    return signer.signEvent({ kind: 0, created_at: FIXED_CREATED_AT, tags: [], content: CARD_CONTENT('Alice') }).then(
      (signed) => {
        const withoutId = { ...unsignedEvent, sig: signed.sig } as unknown as Parameters<typeof verifyEvent>[0];
        expect(verifyEvent(withoutId)).toBe(false);

        const withId = { ...unsignedEvent, id, sig: signed.sig } as unknown as Parameters<typeof verifyEvent>[0];
        expect(verifyEvent(withId)).toBe(true);
      },
    );
  });

  it('decodeCard itself (the production path) attaches id and verifies a real card', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    expect('error' in decodeCard(payload)).toBe(false);
  });
});

// ── AC-PARSE-1..5 — parseContactCard discrimination ─────────────────────────

describe('AC-PARSE-1: bare npub', () => {
  it('returns { pubkeyHex } with no profile field at all', () => {
    const { pubkeyHex } = makeIdentity();
    const npub = pubkeyToNpub(pubkeyHex);
    const result = parseContactCard(npub);
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error('unreachable');
    expect(result.pubkeyHex).toBe(pubkeyHex);
    expect('profile' in result).toBe(false);
    expect(Object.keys(result)).toEqual(['pubkeyHex']);
  });

  it('accepts a NIP-21 nostr: prefixed npub (paste form from other clients)', () => {
    // Regression: parseContactCard only stripped nostr: on the scan path
    // (normaliseScanPayload); a pasted `nostr:npub1…` fell through to the card
    // decoder and was rejected, though the prior inviteByNpub/normaliseNpubPayload
    // path accepted it. Stripping at the single decode seam covers every caller.
    const { pubkeyHex } = makeIdentity();
    const npub = pubkeyToNpub(pubkeyHex);
    for (const variant of [`nostr:${npub}`, `NOSTR:${npub.toUpperCase()}`, `  nostr:${npub}  `]) {
      const result = parseContactCard(variant);
      expect('error' in result).toBe(false);
      if ('error' in result) throw new Error('unreachable');
      expect(result.pubkeyHex).toBe(pubkeyHex);
      expect('profile' in result).toBe(false);
    }
  });

  it('accepts an uppercase npub — bech32 is case-insensitive', () => {
    // Regression: parseContactCard branched on a lowercase `npub1` prefix only,
    // so an uppercase NPUB1… (as emitted by QR alphanumeric mode) fell through
    // to the card decoder and was rejected, though the prior addContactByNpub
    // path accepted it via nip19.decode.
    const { pubkeyHex } = makeIdentity();
    const npub = pubkeyToNpub(pubkeyHex);
    for (const variant of [npub.toUpperCase(), `  ${npub.toUpperCase()}  `]) {
      const result = parseContactCard(variant);
      expect('error' in result).toBe(false);
      if ('error' in result) throw new Error('unreachable');
      expect(result.pubkeyHex).toBe(pubkeyHex);
      expect('profile' in result).toBe(false);
    }
  });
});

describe('AC-PARSE-2: card link', () => {
  it('extracts the #c= fragment and returns { pubkeyHex, profile }', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const link = buildShareUrl(payload);
    const result = parseContactCard(link);
    expect('error' in result).toBe(false);
    if ('error' in result || !('profile' in result)) throw new Error('unreachable');
    expect(result.pubkeyHex).toBe(pubkeyHex);
    expect(result.profile.nickname).toBe('Alice');
    expect(result.profile.updatedAt).toBe(new Date(FIXED_CREATED_AT * 1000).toISOString());
  });
});

describe('AC-PARSE-3: raw base64url payload (no URL wrapper)', () => {
  it('returns the same { pubkeyHex, profile } as the card-link form', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const link = buildShareUrl(payload);

    const viaRaw = parseContactCard(payload);
    const viaLink = parseContactCard(link);
    expect(viaRaw).toEqual(viaLink);
  });
});

describe('AC-PARSE-4: signature does not verify', () => {
  it('returns an error result and never a usable pubkeyHex+profile pair', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const bytes = base64UrlToBytes(payload)!;
    const nameOffset = 1 + 32 + 4 + 1;
    const mutated = new Uint8Array(bytes);
    mutated[nameOffset] = mutated[nameOffset] ^ 0x02;
    const tamperedPayload = bytesToBase64Url(mutated);

    const result = parseContactCard(tamperedPayload);
    expect('error' in result).toBe(true);
    expect('pubkeyHex' in result).toBe(false);
    expect('profile' in result).toBe(false);
  });
});

describe('encodeCard defensive guards (post-impl)', () => {
  it('rejects a malformed pubkeyHex (not 64 hex chars) rather than packing a corrupted card', async () => {
    const { signer } = makeIdentity();
    await expect(
      encodeCard('not-a-pubkey', { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent),
    ).rejects.toThrow(/pubkeyHex/);
  });

  it('rejects when the signer\'s returned event pubkey does not match the supplied pubkeyHex', async () => {
    const a = makeIdentity();
    const b = makeIdentity();
    await expect(
      encodeCard(b.pubkeyHex, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, a.signer.signEvent),
    ).rejects.toThrow(/signer pubkey/);
  });

  it('accepts a mixed-case pubkeyHex and normalizes it so packed bytes and verification agree', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    // Flip the case of every hex letter to build an equivalent, but
    // differently-spelled, mixed-case pubkeyHex.
    const mixedCase = pubkeyHex.replace(/[a-f]/g, (c) => c.toUpperCase());
    const payload = await encodeCard(mixedCase, { nickname: 'Alice', createdAt: FIXED_CREATED_AT }, signer.signEvent);
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    expect(decoded.pubkeyHex).toBe(pubkeyHex.toLowerCase());
  });

  it.each([
    ['a fractional value', 1735689600.5],
    ['a negative value', -1],
    ['a value beyond uint32 range', 0x100000000],
    ['NaN', NaN],
  ])('rejects createdAt that is %s', async (_label, badCreatedAt) => {
    const { pubkeyHex, signer } = makeIdentity();
    await expect(
      encodeCard(pubkeyHex, { nickname: 'Alice', createdAt: badCreatedAt }, signer.signEvent),
    ).rejects.toThrow(/createdAt/);
  });
});

// ── cross-story helpers — utf8ByteLength / truncateUtf8 ─────────────────────

describe('utf8ByteLength / truncateUtf8 (exported for S3 reuse)', () => {
  it('utf8ByteLength counts UTF-8 bytes, not UTF-16 code units', () => {
    expect(utf8ByteLength('')).toBe(0);
    expect(utf8ByteLength('Alice')).toBe(5);
    expect(utf8ByteLength('Bärbel')).toBe(7); // ä is 2 bytes in UTF-8
    expect(utf8ByteLength('\u{1F600}')).toBe(4); // astral emoji, 4 UTF-8 bytes
  });

  it('truncateUtf8 cuts only on a codepoint boundary and is a no-op under the cap', () => {
    expect(truncateUtf8('Alice', 32)).toBe('Alice');
    expect(truncateUtf8('a'.repeat(31) + '\u{1F600}', 32)).toBe('a'.repeat(31));
    expect(truncateUtf8('\u{1F600}'.repeat(9), 32)).toBe('\u{1F600}'.repeat(8));
  });
});

describe('AC-PARSE-5: neither npub nor decodable card', () => {
  it('returns an error result rather than throwing, for garbage/empty/oversized input', () => {
    for (const garbage of ['', 'not-a-card-at-all!!!', 'npub1invalid', 'x'.repeat(500), '   ']) {
      expect(() => parseContactCard(garbage)).not.toThrow();
      const result = parseContactCard(garbage);
      expect('error' in result).toBe(true);
    }
  });
});
