import { describe, it, expect } from 'vitest';
import {
  mnemonicFromSeed,
  identityFromMnemonic,
  isValidMnemonic,
  mnemonicFromHex,
  hexFromMnemonic,
} from '@/src/lib/bip39';
import { derivePrivateKeyFromSeed } from '@/src/lib/nostrKeys';

// 128-bit seed (32 hex chars = 16 bytes) for 12-word mnemonic tests
const TEST_SEED = 'a'.repeat(32);
const ZEROS_SEED = '0'.repeat(32);
const ALTERNATING_SEED = '0f'.repeat(16);

// Legacy 256-bit key (64 hex chars) for backward-compat tests
const LEGACY_KEY = 'a'.repeat(64);

describe('bip39 — 12-word (128-bit seed)', () => {
  describe('mnemonicFromSeed', () => {
    it('returns a 12-word mnemonic for a valid 32-char hex seed', async () => {
      const mnemonic = await mnemonicFromSeed(TEST_SEED);
      expect(mnemonic).not.toBeNull();
      expect(mnemonic!.split(' ').length).toBe(12);
    });

    it('returns null for 64-char hex (wrong length)', async () => {
      const result = await mnemonicFromSeed('a'.repeat(64));
      expect(result).toBeNull();
    });

    it('returns null for too-short hex', async () => {
      const result = await mnemonicFromSeed('abcd1234');
      expect(result).toBeNull();
    });

    it('returns null for non-hex string', async () => {
      const result = await mnemonicFromSeed('z'.repeat(32));
      expect(result).toBeNull();
    });

    it('generates deterministic mnemonic for same input', async () => {
      const first = await mnemonicFromSeed(ZEROS_SEED);
      const second = await mnemonicFromSeed(ZEROS_SEED);
      expect(first).toBe(second);
    });

    it('generates different mnemonic for different input', async () => {
      const first = await mnemonicFromSeed(ZEROS_SEED);
      const second = await mnemonicFromSeed(TEST_SEED);
      expect(first).not.toBe(second);
    });
  });

  describe('identityFromMnemonic', () => {
    it('round-trips seed → mnemonic → same seed + derived key', async () => {
      const mnemonic = await mnemonicFromSeed(ALTERNATING_SEED);
      expect(mnemonic).not.toBeNull();

      const result = await identityFromMnemonic(mnemonic!);
      expect(result).not.toBeNull();
      expect(result!.seedHex).toBe(ALTERNATING_SEED.toLowerCase());

      // Verify derived private key matches
      const expectedKey = await derivePrivateKeyFromSeed(ALTERNATING_SEED);
      expect(result!.privateKeyHex).toBe(expectedKey);
    });

    it('returns null for invalid mnemonic', async () => {
      const result = await identityFromMnemonic('this is not a valid mnemonic phrase at all ever');
      expect(result).toBeNull();
    });

    it('returns null for empty string', async () => {
      const result = await identityFromMnemonic('');
      expect(result).toBeNull();
    });

    it('returns null for a 24-word mnemonic (wrong length)', async () => {
      const mnemonic24 = await mnemonicFromHex(LEGACY_KEY);
      expect(mnemonic24).not.toBeNull();
      const result = await identityFromMnemonic(mnemonic24!);
      expect(result).toBeNull();
    });

    it('handles extra whitespace in input', async () => {
      const mnemonic = await mnemonicFromSeed(ZEROS_SEED);
      expect(mnemonic).not.toBeNull();
      const withSpaces = '  ' + mnemonic!.replace(/ /g, '  ') + '  ';
      const result = await identityFromMnemonic(withSpaces);
      expect(result).not.toBeNull();
      expect(result!.seedHex).toBe(ZEROS_SEED.toLowerCase());
    });
  });

  describe('isValidMnemonic', () => {
    it('returns true for a valid 12-word mnemonic', async () => {
      const mnemonic = await mnemonicFromSeed(TEST_SEED);
      expect(mnemonic).not.toBeNull();
      const valid = await isValidMnemonic(mnemonic!);
      expect(valid).toBe(true);
    });

    it('returns true for a valid 24-word mnemonic (legacy)', async () => {
      const mnemonic = await mnemonicFromHex(LEGACY_KEY);
      expect(mnemonic).not.toBeNull();
      const valid = await isValidMnemonic(mnemonic!);
      expect(valid).toBe(true);
    });

    it('returns false for random text', async () => {
      const valid = await isValidMnemonic('foo bar baz qux');
      expect(valid).toBe(false);
    });

    it('returns false for empty string', async () => {
      const valid = await isValidMnemonic('');
      expect(valid).toBe(false);
    });
  });
});

describe('bip39 — legacy 24-word (backward compat)', () => {
  it('mnemonicFromHex returns 24 words for 64-char hex', async () => {
    const mnemonic = await mnemonicFromHex(LEGACY_KEY);
    expect(mnemonic).not.toBeNull();
    expect(mnemonic!.split(' ').length).toBe(24);
  });

  it('hexFromMnemonic round-trips with mnemonicFromHex', async () => {
    const mnemonic = await mnemonicFromHex(LEGACY_KEY);
    expect(mnemonic).not.toBeNull();
    const restored = await hexFromMnemonic(mnemonic!);
    expect(restored).toBe(LEGACY_KEY.toLowerCase());
  });
});
