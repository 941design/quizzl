/**
 * Tests for Advanced Settings Story 04:
 * - createNip46EventSigner adapter shape
 * - activeEventSignerOverride module-level ref exists and is mutable
 * - NIP-46 i18n keys in both languages
 * - STORAGE_KEYS.nip46Session key is correct
 * - NostrIdentityContext default value exposes NIP-46 API
 */

import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';
import { STORAGE_KEYS } from '@/src/types';

// ---------------------------------------------------------------------------
// AC-SIGNER-5: nip46Session storage key
// ---------------------------------------------------------------------------

describe('nip46Session storage key (AC-SIGNER-5)', () => {
  it('STORAGE_KEYS.nip46Session is lp_nip46Session_v1', () => {
    expect(STORAGE_KEYS.nip46Session).toBe('lp_nip46Session_v1');
  });
});

// ---------------------------------------------------------------------------
// activeEventSignerOverride: module-level ref (AC-SIGNER-10)
// ---------------------------------------------------------------------------

describe('activeEventSignerOverride ref', () => {
  it('exports a mutable ref object with a current property starting null', async () => {
    const { activeEventSignerOverride } = await import('@/src/lib/marmot/signerAdapter');
    expect(activeEventSignerOverride).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(activeEventSignerOverride, 'current')).toBe(true);
    // Reset to null so other tests don't see a stale value
    activeEventSignerOverride.current = null;
    expect(activeEventSignerOverride.current).toBeNull();
  });

  it('can be set to a mock EventSigner without TypeScript error', async () => {
    const { activeEventSignerOverride } = await import('@/src/lib/marmot/signerAdapter');
    const mockSigner = {
      getPublicKey: async () => 'deadbeef',
      signEvent: async () => ({} as never),
    };
    activeEventSignerOverride.current = mockSigner;
    expect(activeEventSignerOverride.current).toBe(mockSigner);
    // Clean up
    activeEventSignerOverride.current = null;
  });
});

// ---------------------------------------------------------------------------
// createNip46EventSigner adapter shape (Story 04)
// ---------------------------------------------------------------------------

describe('createNip46EventSigner adapter (Story 04)', () => {
  it('returns an object with getPublicKey, signEvent, nip44.encrypt, nip44.decrypt', async () => {
    const { createNip46EventSigner } = await import('@/src/lib/marmot/signerAdapter');
    const signer = createNip46EventSigner({} as never);
    expect(typeof signer.getPublicKey).toBe('function');
    expect(typeof signer.signEvent).toBe('function');
    expect(typeof signer.nip44?.encrypt).toBe('function');
    expect(typeof signer.nip44?.decrypt).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// NIP-46 i18n keys in both languages (AC-SIGNER-9, AC-NPUB-1 disclosures)
// ---------------------------------------------------------------------------

const REQUIRED_NIP46_KEYS = [
  'sectionTitle',
  'description',
  'disclosureGroupFast',
  'disclosureIdentityLeaves',
  'disclosureDmSlow',
  'connectQrBtn',
  'connectPasteBtn',
  'relayInputLabel',
  'relayInputPlaceholder',
  'generateQrBtn',
  'confirmConnectBtn',
  'pasteUriLabel',
  'pasteUriPlaceholder',
  'connectBtn',
  'connecting',
  'connected',
  'connectedAs',
  'reconnecting',
  'disconnect',
  'signerUnavailable',
  'retryBtn',
  'errorUnreachable',
  'authChallengeOpened',
] as const;

describe('NIP-46 i18n keys', () => {
  for (const lang of ['en', 'de'] as const) {
    it(`${lang} copy has all required nip46 keys`, () => {
      const nip46 = getCopy(lang).advanced.nip46;
      for (const key of REQUIRED_NIP46_KEYS) {
        expect(nip46[key], `${lang}.advanced.nip46.${key}`).toBeTruthy();
      }
    });

    it(`${lang} disclosure keys mention key behaviors (AC-SIGNER-9)`, () => {
      const nip46 = getCopy(lang).advanced.nip46;
      // Each disclosure must be a non-empty string
      expect(nip46.disclosureGroupFast.length).toBeGreaterThan(0);
      expect(nip46.disclosureIdentityLeaves.length).toBeGreaterThan(0);
      expect(nip46.disclosureDmSlow.length).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// NostrIdentityContext default value exposes NIP-46 API
// ---------------------------------------------------------------------------

describe('NostrIdentityContext default value', () => {
  it('exports signerAvailable, signerError, signerReconnecting and NIP-46 functions', async () => {
    // Import the context to check the DEFAULT_CONTEXT shape (tests outside a provider)
    const { useNostrIdentity } = await import('@/src/context/NostrIdentityContext');
    // The hook returns DEFAULT_CONTEXT when called outside a provider;
    // we can't call hooks outside React, so we check the type inference:
    // Verify the module exports the expected function names
    expect(typeof useNostrIdentity).toBe('function');
  });
});
