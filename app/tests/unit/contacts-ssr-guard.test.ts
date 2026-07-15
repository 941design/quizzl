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
const { purgeStrangerContacts, listContacts, rememberContact } = await import('@/src/lib/contacts');

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

  /**
   * Doc-comment contract: "@returns `{ deleted: number }`" — the count must
   * be a real number even on the early-return SSR path, not just a
   * side-effect-free no-op. Kills the ObjectLiteral repl='{}' mutant on the
   * `{ deleted: 0 }` early return, which no prior test here asserted (no AC
   * covers this specific shape; filed as a spec-gap finding).
   */
  it('returns { deleted: 0 } — not an empty object — when storage is unavailable', () => {
    expect(purgeStrangerContacts(getWhitelist)).toEqual({ deleted: 0 });
  });
});

/**
 * SSR-guard test for contacts.ts:40 (readContactCacheSnapshot).
 *
 * `readContactCacheSnapshot` — reached only indirectly via `listContacts` —
 * bails when `isStorageAvailable()` returns false, so no localStorage.getItem
 * happens on the contactCache key. Under the mutation `if (false) return {}`
 * → guard removed → the function would call localStorage.getItem, which the
 * spy below catches.
 */
describe('readContactCacheSnapshot — SSR guard (contacts.ts:40)', () => {
  it('listContacts does not call localStorage.getItem when storage is unavailable (covers both readStoredContacts and readContactCacheSnapshot guards)', () => {
    getItemSpy.mockClear();

    listContacts(null);

    // Under original code both guards bail and nothing gets read. Under the
    // readContactCacheSnapshot guard mutation, at least one getItem call to
    // the contactCache key happens.
    expect(getItemSpy).not.toHaveBeenCalled();
  });
});

/**
 * SSR-guard test for contacts.ts:77 (writeStoredContacts).
 *
 * `writeStoredContacts` — reached indirectly via `rememberContact` — bails
 * when `isStorageAvailable()` returns false, so no localStorage.setItem
 * happens. Under the mutation `if (false) return` → guard removed → the
 * function would call localStorage.setItem, which the spy below catches.
 */
describe('writeStoredContacts — SSR guard (contacts.ts:77)', () => {
  it('rememberContact does not call localStorage.setItem when storage is unavailable', () => {
    setItemSpy.mockClear();

    rememberContact('a'.repeat(64), '2026-06-01T00:00:00.000Z');

    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
