import { describe, expect, it } from 'vitest';
import { normaliseNpubPayload } from '@/src/lib/qr';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';

const samplePubkey = 'f'.repeat(64);
const sampleNpub = pubkeyToNpub(samplePubkey);

describe('normaliseNpubPayload', () => {
  it('accepts a plain npub', () => {
    expect(normaliseNpubPayload(sampleNpub)).toBe(sampleNpub);
  });

  it('accepts a nostr: npub payload', () => {
    expect(normaliseNpubPayload(`nostr:${sampleNpub}`)).toBe(sampleNpub);
  });

  it('trims whitespace', () => {
    expect(normaliseNpubPayload(`  ${sampleNpub}  `)).toBe(sampleNpub);
  });

  it('rejects non-npub payloads', () => {
    expect(normaliseNpubPayload('hello world')).toBeNull();
    expect(normaliseNpubPayload('nsec1foo')).toBeNull();
    expect(normaliseNpubPayload('')).toBeNull();
  });
});
