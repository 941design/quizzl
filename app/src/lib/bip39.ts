/**
 * bip39.ts — Minimal BIP-39 mnemonic utilities for Nostr identity backup.
 *
 * We use 128-bit entropy (12-word mnemonic) derived from a 16-byte seed.
 * The seed is generated at key creation time and stored alongside the identity.
 * The 32-byte Nostr private key is derived via SHA-256(seed).
 *
 * Flow:
 *   seed (16 bytes) → BIP-39 12-word mnemonic (for backup)
 *   seed (16 bytes) → SHA-256 → private key (32 bytes)
 */

import { derivePrivateKeyFromSeed } from './nostrKeys';

/**
 * Convert a 128-bit seed hex (32 chars / 16 bytes) to a 12-word mnemonic.
 * Returns null on invalid input.
 */
export async function mnemonicFromSeed(seedHex: string): Promise<string | null> {
  try {
    const { entropyToMnemonic } = await import('@scure/bip39');
    const { wordlist } = await import('@scure/bip39/wordlists/english');

    if (!/^[0-9a-fA-F]{32}$/.test(seedHex)) return null;

    const bytes = hexToBytes(seedHex);
    return entropyToMnemonic(bytes, wordlist);
  } catch {
    return null;
  }
}

/**
 * Convert a 12-word BIP-39 mnemonic back to seed hex + derived private key hex.
 * Returns null on invalid mnemonic.
 */
export async function identityFromMnemonic(
  mnemonic: string
): Promise<{ seedHex: string; privateKeyHex: string } | null> {
  try {
    const { mnemonicToEntropy, validateMnemonic } = await import('@scure/bip39');
    const { wordlist } = await import('@scure/bip39/wordlists/english');

    const normalised = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(normalised, wordlist)) return null;

    const entropy = mnemonicToEntropy(normalised, wordlist);
    if (entropy.length !== 16) return null; // Must be 128-bit (12-word)

    const seedHex = bytesToHex(entropy);
    const privateKeyHex = await derivePrivateKeyFromSeed(seedHex);
    return { seedHex, privateKeyHex };
  } catch {
    return null;
  }
}

/**
 * Validate a mnemonic phrase.
 */
export async function isValidMnemonic(mnemonic: string): Promise<boolean> {
  try {
    const { validateMnemonic } = await import('@scure/bip39');
    const { wordlist } = await import('@scure/bip39/wordlists/english');
    const normalised = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    return validateMnemonic(normalised, wordlist);
  } catch {
    return false;
  }
}

// --- Kept for backwards compatibility with any legacy 24-word backups ---

/**
 * Convert a hex-encoded private key (64 chars / 32 bytes) to a 24-word mnemonic.
 * @deprecated Use mnemonicFromSeed for new identities.
 */
export async function mnemonicFromHex(privateKeyHex: string): Promise<string | null> {
  try {
    const { entropyToMnemonic } = await import('@scure/bip39');
    const { wordlist } = await import('@scure/bip39/wordlists/english');

    if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) return null;

    const bytes = hexToBytes(privateKeyHex);
    return entropyToMnemonic(bytes, wordlist);
  } catch {
    return null;
  }
}

/**
 * Convert a BIP-39 mnemonic (24 words) back to a 64-char hex private key.
 * @deprecated Use identityFromMnemonic for new identities.
 */
export async function hexFromMnemonic(mnemonic: string): Promise<string | null> {
  try {
    const { mnemonicToEntropy, validateMnemonic } = await import('@scure/bip39');
    const { wordlist } = await import('@scure/bip39/wordlists/english');

    const normalised = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(normalised, wordlist)) return null;

    const entropy = mnemonicToEntropy(normalised, wordlist);
    if (entropy.length !== 32) return null;

    return bytesToHex(entropy);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
