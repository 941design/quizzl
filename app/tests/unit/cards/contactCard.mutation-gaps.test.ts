import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { encodeCard, decodeCard } from '@/src/lib/contactCard';

/**
 * Gap-closing tests derived from the contact-card-exchange pre-ship mutation
 * gate (base:mutation-testing). The existing suite asserts every *rejection*
 * boundary for `createdAt` (negative, fractional, > uint32, NaN via
 * `.rejects.toThrow(/createdAt/)`) but never asserts that the two *accepted*
 * endpoints of the valid uint32 range actually encode. That left two boundary
 * mutants alive:
 *
 *   - `createdAt < 0`  → `createdAt <= 0`      (rejects the valid value 0)
 *   - `createdAt > 0xffffffff` → `>= 0xffffffff` (rejects the valid max 0xffffffff)
 *
 * Both are real gaps: a mutant that wrongly rejects a *valid* card at the
 * boundary ships green. These lock the inclusive [0, 0xffffffff] accept range
 * by round-tripping each endpoint.
 */

function makeIdentity() {
  const sk = generateSecretKey();
  const skHex = bytesToHex(sk);
  const pubkeyHex = getPublicKey(sk);
  const signer = createPrivateKeySigner(skHex);
  return { skHex, pubkeyHex, signer };
}

describe('encodeCard — createdAt accepts the inclusive uint32 boundary (mutation gate)', () => {
  it.each([
    ['the low endpoint (0, the Unix epoch)', 0],
    ['the high endpoint (0xffffffff, max uint32)', 0xffffffff],
  ])('accepts and round-trips createdAt at %s', async (_label, createdAt) => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await encodeCard(pubkeyHex, { nickname: 'Alice', createdAt }, signer.signEvent);
    const decoded = decodeCard(payload);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) throw new Error('unreachable');
    expect(decoded.profile).toBeDefined();
    expect(decoded.profile!.createdAt).toBe(createdAt);
  });
});
