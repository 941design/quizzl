/**
 * Nostr identity management: keypair generation, localStorage persistence,
 * and npub/nsec encoding utilities.
 *
 * Tier 1 identity: private key stored as hex in localStorage.
 * The user accepts that clearing browser storage loses their identity.
 */

import { nip19 } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha2.js';
import { STORAGE_KEYS } from '@/src/types';

export type StoredNostrIdentity = {
  privateKeyHex: string;
  pubkeyHex: string;
  /** 128-bit seed hex (32 chars) used to derive the private key. Present for new identities. */
  seedHex?: string;
};

/**
 * Generate a 128-bit random seed and derive a 32-byte private key from it via SHA-256.
 * Returns both the seed (for BIP-39 12-word backup) and the derived private key.
 */
export async function generateIdentityFromSeed(): Promise<{ seedHex: string; privateKeyHex: string }> {
  const seed = new Uint8Array(16);
  crypto.getRandomValues(seed);
  const seedHex = bytesToHex(seed);
  const privateKeyHex = await derivePrivateKeyFromSeed(seedHex);
  return { seedHex, privateKeyHex };
}

/**
 * Derive a 32-byte private key from a 128-bit (16-byte / 32-char hex) seed via SHA-256.
 * Uses @noble/hashes (pure JS) so it works in non-secure contexts (HTTP).
 */
export function derivePrivateKeyFromSeed(seedHex: string): string {
  const seedBytes = hexToBytes(seedHex);
  return bytesToHex(sha256(seedBytes));
}

/** @deprecated Use generateIdentityFromSeed() instead */
export function generatePrivateKeyHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * Derive the public key (hex) from a private key (hex).
 * Uses the nostr-tools schnorr implementation.
 */
export async function derivePublicKeyHex(privateKeyHex: string): Promise<string> {
  const { getPublicKey } = await import('nostr-tools/pure');
  const privKeyBytes = hexToBytes(privateKeyHex);
  return getPublicKey(privKeyBytes);
}

/** Convert a hex string to Uint8Array */
export function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

/** Convert Uint8Array to hex string */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Encode a hex public key as npub (NIP-19 bech32) */
export function pubkeyToNpub(pubkeyHex: string): string {
  return nip19.npubEncode(pubkeyHex);
}

/** Encode a hex private key as nsec (NIP-19 bech32) */
export function privkeyToNsec(privateKeyHex: string): string {
  return nip19.nsecEncode(hexToBytes(privateKeyHex));
}

/** Decode an npub to hex pubkey. Returns null if invalid. */
export function npubToPubkeyHex(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub') return null;
    return decoded.data as string;
  } catch {
    return null;
  }
}

/** Truncate an npub for display: "npub1abc...xyz" */
export function truncateNpub(npub: string, chars = 8): string {
  if (npub.length <= chars * 2 + 3) return npub;
  return `${npub.slice(0, chars + 5)}...${npub.slice(-chars)}`;
}

/**
 * Load the stored Nostr identity from localStorage.
 * Returns null if not present or invalid.
 */
export function loadStoredIdentity(): StoredNostrIdentity | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.nostrIdentity);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredNostrIdentity>;
    if (
      typeof parsed.privateKeyHex === 'string' &&
      parsed.privateKeyHex.length === 64 &&
      typeof parsed.pubkeyHex === 'string' &&
      parsed.pubkeyHex.length === 64
    ) {
      const result: StoredNostrIdentity = { privateKeyHex: parsed.privateKeyHex, pubkeyHex: parsed.pubkeyHex };
      if (typeof parsed.seedHex === 'string' && parsed.seedHex.length === 32) {
        result.seedHex = parsed.seedHex;
      }
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist a Nostr identity to localStorage.
 */
export function saveStoredIdentity(identity: StoredNostrIdentity): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.nostrIdentity, JSON.stringify(identity));
  } catch {
    // Silent fail
  }
}

/**
 * Clear the stored identity from localStorage.
 */
export function clearStoredIdentity(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEYS.nostrIdentity);
  } catch {
    // Silent fail
  }
}
