/**
 * Unit tests for `pages/feedback.tsx`'s block-gating wiring (gate-remediation
 * finding 3, epic: block-contact).
 *
 * The maintainer (`MAINTAINER_ACTIVE_PUBKEY_HEX`) is addable-by-npub like any
 * other contact (`isMaintainerPubkey`, `processContactInput.ts`) and
 * therefore blockable. Before this fix, `/feedback` mounted `ContactChat`
 * UNCONDITIONALLY for the maintainer — while blocked, the composer (text,
 * image, paste, drop, reactions) still sent. The fix renders a Blocked notice
 * INSTEAD of `ContactChat` (mirroring `ContactDetailView`'s own banner in
 * `pages/contacts.tsx`, AC-VIEW-1/7) whenever the maintainer is blocked.
 *
 * `pages/feedback.tsx` is a page component (Chakra/Next imports) — this repo
 * has no jsdom/@testing-library/renderHook precedent (see
 * `pages/profile-announce-fanout.test.ts`'s own doc comment), so the
 * composer-vs-notice decision is extracted into a pure, exported function,
 * `shouldShowMaintainerBlockedNotice`, directly testable without mounting
 * React. Importing the page module itself (to reach that export) is safe —
 * only top-level function/const declarations execute at import time, exactly
 * as `pages/profile-announce-fanout.test.ts` already relies on for
 * `pages/profile.tsx`.
 */
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

// ── localStorage mock (hand-rolled, no jsdom — mirrors
//    contactChat-block-gating.test.ts / profile-announce-fanout.test.ts) ────

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
  localStorageMock.clear();
});

const { shouldShowMaintainerBlockedNotice } = await import('@/pages/feedback');
const { MAINTAINER_ACTIVE_PUBKEY_HEX } = await import('@/src/config/maintainer');
const { rememberContact, archiveContact, unarchiveContact } = await import('@/src/lib/contacts');
const { loadBlockedPeers } = await import('@/src/lib/blockedPeers');

const OTHER_PEER = 'c'.repeat(64);

describe('shouldShowMaintainerBlockedNotice (gate-remediation finding 3)', () => {
  it('returns false when the maintainer pubkey is null (feature disabled) regardless of the block set', () => {
    expect(shouldShowMaintainerBlockedNotice(null, new Set(['anything']))).toBe(false);
  });

  it('returns false when the maintainer is a known, non-archived contact', () => {
    expect(MAINTAINER_ACTIVE_PUBKEY_HEX).not.toBeNull();
    const maintainerHex = MAINTAINER_ACTIVE_PUBKEY_HEX as string;
    rememberContact(maintainerHex, '2021-01-01T00:00:00.000Z');

    const result = shouldShowMaintainerBlockedNotice(maintainerHex, loadBlockedPeers());

    expect(result).toBe(false);
  });

  it('returns true once the maintainer contact is archived (blocked)', () => {
    expect(MAINTAINER_ACTIVE_PUBKEY_HEX).not.toBeNull();
    const maintainerHex = MAINTAINER_ACTIVE_PUBKEY_HEX as string;
    rememberContact(maintainerHex, '2021-01-01T00:00:00.000Z');
    archiveContact(maintainerHex);

    const result = shouldShowMaintainerBlockedNotice(maintainerHex, loadBlockedPeers());

    expect(result).toBe(true);
  });

  it('flips back to false once the maintainer is unblocked', () => {
    expect(MAINTAINER_ACTIVE_PUBKEY_HEX).not.toBeNull();
    const maintainerHex = MAINTAINER_ACTIVE_PUBKEY_HEX as string;
    rememberContact(maintainerHex, '2021-01-01T00:00:00.000Z');
    archiveContact(maintainerHex);
    unarchiveContact(maintainerHex);

    const result = shouldShowMaintainerBlockedNotice(maintainerHex, loadBlockedPeers());

    expect(result).toBe(false);
  });

  it('a DIFFERENT blocked contact does not trip the maintainer notice (peer-scoped, not a global block flag)', () => {
    expect(MAINTAINER_ACTIVE_PUBKEY_HEX).not.toBeNull();
    const maintainerHex = MAINTAINER_ACTIVE_PUBKEY_HEX as string;
    rememberContact(maintainerHex, '2021-01-01T00:00:00.000Z');
    rememberContact(OTHER_PEER, '2021-01-01T00:00:00.000Z');
    archiveContact(OTHER_PEER); // block someone else, not the maintainer

    const result = shouldShowMaintainerBlockedNotice(maintainerHex, loadBlockedPeers());

    expect(result).toBe(false);
  });
});
