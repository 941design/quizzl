/**
 * SSR-guard test for contacts.ts:192
 *
 * Line 192 — purgeStrangerContacts SSR guard:
 *   `if (!isStorageAvailable()) return;`
 *   When storage is unavailable (SSR / restricted context), the function must
 *   return immediately without reading or writing localStorage.
 *
 * The guard is tested by mocking `@/src/lib/storage` so that
 * `isStorageAvailable()` returns false. Under the mutation
 * `if (false) return` → guard removed → the function proceeds to call
 * localStorage.getItem, which in a true SSR context would throw.
 * The test verifies no localStorage interaction occurs.
 */

import { describe, expect, it, vi } from 'vitest';

// ── Mock storage module BEFORE importing contacts ─────────────────────────────
// vi.mock is hoisted to the top of the module by Vite's transform, so this
// declaration runs before any import even though it appears here textually.
vi.mock('@/src/lib/storage', () => ({
  isStorageAvailable: vi.fn(() => false),
  // Stub the remaining helpers contacts.ts doesn't call but types may expect:
  readItem: vi.fn(),
  writeItem: vi.fn(),
  resetAllData: vi.fn(),
}));

// ── localStorage spy (must be set up before the module imports it) ────────────
const getItemSpy = vi.fn(() => null);
const setItemSpy = vi.fn();
vi.stubGlobal('localStorage', {
  getItem: getItemSpy,
  setItem: setItemSpy,
  removeItem: vi.fn(),
  clear: vi.fn(),
  get length() { return 0; },
  key: vi.fn(() => null),
});

// ── SUT import (after mocks) ──────────────────────────────────────────────────
const { purgeStrangerContacts } = await import('@/src/lib/contacts');

// ── Whitelist factory ─────────────────────────────────────────────────────────
const OWN = 'cc'.repeat(32);
function getWhitelist() {
  return { groups: [], knownPeers: new Set<string>(), ownPubkeyHex: OWN };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('purgeStrangerContacts — SSR guard (contacts.ts:192)', () => {
  /**
   * Property: when isStorageAvailable() returns false, purgeStrangerContacts
   * must return without touching localStorage (no getItem, no setItem).
   *
   * Kills: the ConditionalExpression repl='false' mutant that removes the guard
   * (the function would then proceed to call localStorage.getItem, triggering
   * the spy and failing the expectation below).
   */

  it('does not call localStorage.getItem when storage is unavailable', () => {
    getItemSpy.mockClear();

    purgeStrangerContacts(getWhitelist);

    expect(getItemSpy).not.toHaveBeenCalled();
  });

  it('does not call localStorage.setItem when storage is unavailable', () => {
    setItemSpy.mockClear();

    purgeStrangerContacts(getWhitelist);

    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('does not throw when storage is unavailable', () => {
    expect(() => purgeStrangerContacts(getWhitelist)).not.toThrow();
  });
});
