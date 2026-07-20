/**
 * pubkeyDisplay.test.ts — unit tests for `truncatePubkey` and
 * `resolveInviterLabel` (inline-invitation-cards epic, Story S1).
 *
 * `resolveInviterLabel` is driven through the REAL localStorage-backed
 * `contacts.ts` / `contactCache.ts` implementation (no mocking of
 * `getContact`), mirroring `tests/unit/contacts.test.ts`'s convention: a
 * plain-object localStorage mock installed at module scope, cleared in
 * `beforeEach`, and `writeContactEntry` used to seed known contacts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { truncatePubkey, resolveInviterLabel } from '@/src/lib/pubkeyDisplay';
import { writeContactEntry } from '@/src/lib/contactCache';

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Mock idb-keyval — needed only so `chatPersistence.ts` can be safely
// imported transitively (via contacts.ts) without touching real IndexedDB,
// which does not exist under vitest's node environment. Mirrors
// contacts.test.ts's identical mock.
vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  del: vi.fn(async () => undefined),
  delMany: vi.fn(async () => undefined),
  keys: vi.fn(async () => []),
}));

const KNOWN_PUBKEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const EMPTY_NICKNAME_PUBKEY = 'b1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const UNKNOWN_PUBKEY = 'c1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

describe('truncatePubkey', () => {
  it('returns a short (< 16 char) hex string unchanged', () => {
    expect(truncatePubkey('abc123')).toBe('abc123');
  });

  it('truncates a >= 16-char hex string to first8…last8', () => {
    expect(truncatePubkey(KNOWN_PUBKEY)).toBe('a1b2c3d4…e5f6a1b2');
  });
});

describe('resolveInviterLabel', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('returns the nickname for a known contact with a non-empty nickname', () => {
    writeContactEntry(KNOWN_PUBKEY, {
      nickname: 'Alice',
      avatar: null,
      updatedAt: new Date().toISOString(),
    });

    expect(resolveInviterLabel(KNOWN_PUBKEY, null)).toBe('Alice');
  });

  it('falls through to the truncated pubkey for a known contact with an empty nickname', () => {
    writeContactEntry(EMPTY_NICKNAME_PUBKEY, {
      nickname: '',
      avatar: null,
      updatedAt: new Date().toISOString(),
    });

    const label = resolveInviterLabel(EMPTY_NICKNAME_PUBKEY, null);
    expect(label).toBe(truncatePubkey(EMPTY_NICKNAME_PUBKEY));
    expect(label).not.toBe('');
    expect(label).not.toBe(EMPTY_NICKNAME_PUBKEY);
  });

  it('falls through to the truncated pubkey for an unknown pubkey (never seeded)', () => {
    expect(resolveInviterLabel(UNKNOWN_PUBKEY, null)).toBe(truncatePubkey(UNKNOWN_PUBKEY));
  });
});
