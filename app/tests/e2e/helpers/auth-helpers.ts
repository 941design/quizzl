import { Page } from '@playwright/test';

/**
 * Pre-computed deterministic test keypairs.
 *
 * Derivation: seed (16 bytes hex) → SHA-256 → privateKeyHex → schnorr pubkey → npub
 * These are computed offline so tests don't depend on crypto at import time.
 */

export const USER_A = {
  seedHex: 'aa'.repeat(16),
  // SHA-256(16 bytes of 0xaa) → privateKeyHex
  privateKeyHex: 'bceef655b5a034911f1c3718ce056531b45ef03b4c7b1f15629e867294011a7d',
  pubkeyHex: '', // filled at runtime via computeTestKeypairs()
  npub: '',      // filled at runtime via computeTestKeypairs()
};

export const USER_B = {
  seedHex: 'bb'.repeat(16),
  // SHA-256(16 bytes of 0xbb) → privateKeyHex
  privateKeyHex: 'cbecda1c7d37d4c0aa5466243bb4a0018c31bf06d74fa7338290dd3068db4fed',
  pubkeyHex: '',
  npub: '',
};

export const USER_C = {
  seedHex: 'cc'.repeat(16),
  // SHA-256(16 bytes of 0xcc) → privateKeyHex
  privateKeyHex: 'd595a3162141a506924be60c2c75b1cd3c28ef4d4b7f4418705677270e54aedf',
  pubkeyHex: '',
  npub: '',
};

/**
 * Compute pubkeys at runtime using the same derivation as the app.
 * Call this once during global setup.
 */
export async function computeTestKeypairs(): Promise<void> {
  // Dynamic import to avoid top-level await issues
  const { getPublicKey } = await import('nostr-tools/pure');
  const { nip19 } = await import('nostr-tools');

  for (const user of [USER_A, USER_B, USER_C]) {
    const privBytes = hexToBytes(user.privateKeyHex);
    user.pubkeyHex = getPublicKey(privBytes);
    user.npub = nip19.npubEncode(user.pubkeyHex);
  }
}

/**
 * Inject a deterministic identity into the page's localStorage.
 * Must be called after page.goto() so we have access to the page's storage.
 */
export async function injectIdentity(
  page: Page,
  user: typeof USER_A,
): Promise<void> {
  await page.evaluate(
    ({ privateKeyHex, pubkeyHex, seedHex }) => {
      const identity = { privateKeyHex, pubkeyHex, seedHex };
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify(identity));
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex },
  );
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}
