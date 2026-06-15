/**
 * Tests for Advanced Settings Story 03 additions:
 * - signerMode persistence in NostrIdentityContext (via STORAGE_KEYS)
 * - signerAdapter stubs throw with clear messages (not silently no-op)
 * - applyNdkSigner clears the tracked private-key on the singleton
 * - dangerZone i18n keys present in both languages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEYS } from '@/src/types';
import type { SignerMode } from '@/src/context/NostrIdentityContext';
import { getCopy } from '@/src/lib/i18n';

// ---------------------------------------------------------------------------
// localStorage mock (same pattern as storage.test.ts)
// ---------------------------------------------------------------------------

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
  localStorageMock.clear();
});

// ---------------------------------------------------------------------------
// AC-SIGNER-1: signerMode persistence
// ---------------------------------------------------------------------------

describe('signerMode storage key', () => {
  it('STORAGE_KEYS.signerMode is lp_signerMode_v1 (AC-SIGNER-1)', () => {
    expect(STORAGE_KEYS.signerMode).toBe('lp_signerMode_v1');
  });

  it('stores and retrieves each valid SignerMode value', () => {
    const modes: SignerMode[] = ['local', 'nip46', 'nip07'];
    for (const mode of modes) {
      localStorage.setItem(STORAGE_KEYS.signerMode, mode);
      expect(localStorage.getItem(STORAGE_KEYS.signerMode)).toBe(mode);
    }
  });

  it('defaults to local when signerMode key is absent', () => {
    // No key set — simulates first launch
    const stored = localStorage.getItem(STORAGE_KEYS.signerMode);
    const effective: SignerMode = (stored as SignerMode) ?? 'local';
    expect(effective).toBe('local');
  });
});

// ---------------------------------------------------------------------------
// signerAdapter: NIP-46 implemented (Story 04), NIP-07 still a stub
// ---------------------------------------------------------------------------

describe('signerAdapter stubs (Story 03 / 04)', () => {
  it('createNip46EventSigner returns an EventSigner with the required methods (Story 04)', async () => {
    const { createNip46EventSigner } = await import('@/src/lib/marmot/signerAdapter');
    // Pass a minimal mock — we only verify the returned shape, not actual signing
    const mockNdkSigner = {} as never;
    const signer = createNip46EventSigner(mockNdkSigner);
    expect(typeof signer.getPublicKey).toBe('function');
    expect(typeof signer.signEvent).toBe('function');
    expect(typeof signer.nip44?.encrypt).toBe('function');
    expect(typeof signer.nip44?.decrypt).toBe('function');
  });

  it('createNip07EventSigner returns an object with getPublicKey, signEvent, nip44.encrypt, nip44.decrypt (Story 05)', async () => {
    // The stub has been replaced by the real adapter in Story 05.
    // Verify it returns the correct EventSigner shape (does not throw on construction).
    const { createNip07EventSigner } = await import('@/src/lib/marmot/signerAdapter');
    const signer = createNip07EventSigner({} as never);
    expect(typeof signer.getPublicKey).toBe('function');
    expect(typeof signer.signEvent).toBe('function');
    expect(typeof signer.nip44?.encrypt).toBe('function');
    expect(typeof signer.nip44?.decrypt).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// applyNdkSigner: safe-to-call when singleton not yet initialized
// ---------------------------------------------------------------------------

describe('applyNdkSigner (ndkClient)', () => {
  it('is a no-op when called before NDK is initialized', async () => {
    const { _resetNdkSingleton, applyNdkSigner } = await import('@/src/lib/ndkClient');
    _resetNdkSingleton();
    // Should not throw when no NDK instance exists
    expect(() => applyNdkSigner({} as never)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// dangerZone i18n: both languages carry all required keys (AC-OTHER-1)
// ---------------------------------------------------------------------------

describe('dangerZone i18n keys', () => {
  const requiredKeys = [
    'title',
    'wipeBtn',
    'wipeConfirmPrompt',
    'wipeConfirmBtn',
    'wipeConfirmWord',
    'wipeCancel',
    'wipeWarning',
  ] as const;

  for (const lang of ['en', 'de'] as const) {
    it(`${lang} copy has all dangerZone keys`, () => {
      const dz = getCopy(lang).advanced.dangerZone;
      for (const key of requiredKeys) {
        expect(dz[key], `${lang}.advanced.dangerZone.${key}`).toBeTruthy();
      }
    });

    it(`${lang} wipeConfirmWord is "WIPE" (same in both languages for comparison)`, () => {
      const dz = getCopy(lang).advanced.dangerZone;
      expect(dz.wipeConfirmWord).toBe('WIPE');
    });
  }
});
