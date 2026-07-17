/**
 * Unit coverage for the isFreshIdentity derivation (AC-DETECT-1, AC-DETECT-2).
 *
 * Plain vitest, no jsdom — deriveIsFreshIdentity is a pure function over the
 * loadStoredIdentity() result captured at init, before auto-generation runs.
 */
import { describe, it, expect } from 'vitest';
import { deriveIsFreshIdentity } from '@/src/lib/freshIdentity';
import type { StoredNostrIdentity } from '@/src/lib/nostrKeys';

const SOME_IDENTITY: StoredNostrIdentity = {
  privateKeyHex: 'a'.repeat(64),
  pubkeyHex: 'b'.repeat(64),
  seedHex: 'c'.repeat(32),
};

describe('deriveIsFreshIdentity', () => {
  // AC-DETECT-1: no stored identity at init -> true.
  it('returns true when loadStoredIdentity() returned null at init', () => {
    expect(deriveIsFreshIdentity(null)).toBe(true);
  });

  // AC-DETECT-2 (first sentence): a stored identity already exists at init -> false.
  it('returns false when a stored identity already exists at init', () => {
    expect(deriveIsFreshIdentity(SOME_IDENTITY)).toBe(false);
  });

  // AC-DETECT-2 (second sentence): first-timer's identity was auto-generated
  // and saved, then the page is reloaded — the *next* init's
  // loadStoredIdentity() now returns the just-saved identity (non-null), so
  // the same production code path resolves to false. No divergent branch.
  it('returns false on a simulated reload after a first-timer identity was just generated and saved', () => {
    // First init: nothing stored yet.
    const atFirstInit: StoredNostrIdentity | null = null;
    expect(deriveIsFreshIdentity(atFirstInit)).toBe(true);

    // NostrIdentityContext's init() would now auto-generate and
    // saveStoredIdentity(...) here — simulated by the freshly-generated
    // identity becoming what loadStoredIdentity() returns on the next init.
    const generated: StoredNostrIdentity = SOME_IDENTITY;

    // Reload: a fresh init() call, loadStoredIdentity() now returns the
    // previously-saved identity.
    const atReloadInit: StoredNostrIdentity | null = generated;
    expect(deriveIsFreshIdentity(atReloadInit)).toBe(false);
  });

  it('returns false for a legacy identity without a seedHex (no seed on old accounts)', () => {
    const legacy: StoredNostrIdentity = { privateKeyHex: 'd'.repeat(64), pubkeyHex: 'e'.repeat(64) };
    expect(deriveIsFreshIdentity(legacy)).toBe(false);
  });
});
