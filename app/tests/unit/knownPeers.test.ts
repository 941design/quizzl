/**
 * Unit tests for knownPeers.ts — covers all 6 exported functions (AC-STRUCT-1, VQ-S1-004).
 * Runs without a browser or IDB — uses a synchronous localStorage mock.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acknowledgeMigrationNotice,
  isKnownPeer,
  isMigrationNoticeAcknowledged,
  knownPeersMigrationComplete,
  loadKnownPeers,
  markKnownPeersMigrationComplete,
  rememberKnownPeer,
  rememberKnownPeers,
} from '@/src/lib/knownPeers';

// ─── localStorage mock ────────────────────────────────────────────────────────

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// ─── Constants (must match knownPeers.ts) ────────────────────────────────────
const KNOWN_PEERS_KEY = 'lp_knownPeers_v1';
const KNOWN_PEERS_MIGRATED_KEY = 'lp_knownPeersMigrated_v2';

const ALICE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OWN = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

beforeEach(() => {
  localStorageMock.clear();
});

afterEach(() => {
  localStorageMock.clear();
});

// ─── loadKnownPeers ───────────────────────────────────────────────────────────

describe('loadKnownPeers', () => {
  it('returns an empty set when localStorage is empty', () => {
    const result = loadKnownPeers();
    expect(result.size).toBe(0);
  });

  it('returns the stored set when peers are present', () => {
    store[KNOWN_PEERS_KEY] = JSON.stringify([ALICE, BOB]);
    const result = loadKnownPeers();
    expect(result.size).toBe(2);
    expect(result.has(ALICE)).toBe(true);
    expect(result.has(BOB)).toBe(true);
  });

  it('returns an empty set when the stored value is corrupt JSON', () => {
    store[KNOWN_PEERS_KEY] = '{not-valid-json';
    const result = loadKnownPeers();
    expect(result.size).toBe(0);
  });

  it('returns an empty set when the stored value is not an array', () => {
    store[KNOWN_PEERS_KEY] = JSON.stringify({ alice: ALICE });
    const result = loadKnownPeers();
    expect(result.size).toBe(0);
  });
});

// ─── rememberKnownPeer ────────────────────────────────────────────────────────

describe('rememberKnownPeer', () => {
  it('stores a peer in lowercase (AC-EVER-1)', () => {
    rememberKnownPeer(ALICE.toUpperCase());
    const stored = JSON.parse(store[KNOWN_PEERS_KEY]);
    expect(stored).toContain(ALICE.toLowerCase());
    expect(stored).not.toContain(ALICE.toUpperCase());
  });

  it('is idempotent — duplicate call does not grow the set (AC-EVER-1)', () => {
    rememberKnownPeer(ALICE);
    rememberKnownPeer(ALICE);
    const stored = JSON.parse(store[KNOWN_PEERS_KEY]) as string[];
    expect(stored.filter((v) => v === ALICE).length).toBe(1);
  });

  it('is idempotent — mixed-case duplicate does not grow the set', () => {
    rememberKnownPeer(ALICE.toLowerCase());
    rememberKnownPeer(ALICE.toUpperCase());
    const stored = JSON.parse(store[KNOWN_PEERS_KEY]) as string[];
    expect(stored.length).toBe(1);
  });

  it('is a silent no-op on empty string — does not write (AC-EVER-3)', () => {
    rememberKnownPeer('');
    expect(store[KNOWN_PEERS_KEY]).toBeUndefined();
  });

  it('is a silent no-op on null (coerced) — does not throw (AC-EVER-3)', () => {
    expect(() => rememberKnownPeer(null as unknown as string)).not.toThrow();
    expect(store[KNOWN_PEERS_KEY]).toBeUndefined();
  });

  it('is a silent no-op on undefined (coerced) — does not throw (AC-EVER-3)', () => {
    expect(() => rememberKnownPeer(undefined as unknown as string)).not.toThrow();
    expect(store[KNOWN_PEERS_KEY]).toBeUndefined();
  });

  it('adds multiple peers across calls', () => {
    rememberKnownPeer(ALICE);
    rememberKnownPeer(BOB);
    const result = loadKnownPeers();
    expect(result.has(ALICE)).toBe(true);
    expect(result.has(BOB)).toBe(true);
  });
});

// ─── rememberKnownPeers ───────────────────────────────────────────────────────

describe('rememberKnownPeers', () => {
  it('adds multiple peers in a single write', () => {
    rememberKnownPeers([ALICE, BOB]);
    const result = loadKnownPeers();
    expect(result.has(ALICE)).toBe(true);
    expect(result.has(BOB)).toBe(true);
  });

  it('is idempotent — adding same peers twice does not duplicate entries', () => {
    rememberKnownPeers([ALICE, BOB]);
    rememberKnownPeers([ALICE, BOB]);
    const stored = JSON.parse(store[KNOWN_PEERS_KEY]) as string[];
    const aliceCount = stored.filter((v) => v === ALICE).length;
    const bobCount = stored.filter((v) => v === BOB).length;
    expect(aliceCount).toBe(1);
    expect(bobCount).toBe(1);
  });

  it('is a no-op on empty array', () => {
    rememberKnownPeers([]);
    expect(store[KNOWN_PEERS_KEY]).toBeUndefined();
  });

  it('filters empty string entries silently', () => {
    rememberKnownPeers([ALICE, '', BOB]);
    const stored = JSON.parse(store[KNOWN_PEERS_KEY]) as string[];
    expect(stored).not.toContain('');
    expect(stored).toContain(ALICE);
    expect(stored).toContain(BOB);
  });

  it('lowercases all entries before storing', () => {
    rememberKnownPeers([ALICE.toUpperCase(), BOB.toUpperCase()]);
    const stored = JSON.parse(store[KNOWN_PEERS_KEY]) as string[];
    expect(stored).toContain(ALICE.toLowerCase());
    expect(stored).toContain(BOB.toLowerCase());
    expect(stored).not.toContain(ALICE.toUpperCase());
  });

  it('callers filter own pubkey; own pubkey not stored when filtered before call', () => {
    // AC-EVER-2 compliance: caller filters before calling
    const peers = [ALICE, OWN, BOB].filter((p) => p !== OWN);
    rememberKnownPeers(peers);
    const result = loadKnownPeers();
    expect(result.has(OWN)).toBe(false);
    expect(result.has(ALICE)).toBe(true);
    expect(result.has(BOB)).toBe(true);
  });
});

// ─── isKnownPeer ─────────────────────────────────────────────────────────────

describe('isKnownPeer', () => {
  it('returns true for a stored peer (exact match)', () => {
    rememberKnownPeer(ALICE);
    expect(isKnownPeer(ALICE)).toBe(true);
  });

  it('returns true for a stored peer (case-insensitive)', () => {
    rememberKnownPeer(ALICE);
    expect(isKnownPeer(ALICE.toUpperCase())).toBe(true);
  });

  it('returns false for an unknown peer', () => {
    rememberKnownPeer(ALICE);
    expect(isKnownPeer(BOB)).toBe(false);
  });

  it('returns false on empty string', () => {
    expect(isKnownPeer('')).toBe(false);
  });

  it('returns false when localStorage is empty', () => {
    expect(isKnownPeer(ALICE)).toBe(false);
  });
});

// ─── knownPeersMigrationComplete + markKnownPeersMigrationComplete ────────────

describe('knownPeersMigrationComplete', () => {
  it('returns false before marking complete', () => {
    expect(knownPeersMigrationComplete()).toBe(false);
  });

  it('returns true after markKnownPeersMigrationComplete is called', () => {
    markKnownPeersMigrationComplete();
    expect(knownPeersMigrationComplete()).toBe(true);
  });

  it('markKnownPeersMigrationComplete writes the key to localStorage', () => {
    markKnownPeersMigrationComplete();
    expect(store[KNOWN_PEERS_MIGRATED_KEY]).not.toBeUndefined();
  });

  it('markKnownPeersMigrationComplete is idempotent', () => {
    markKnownPeersMigrationComplete();
    markKnownPeersMigrationComplete();
    expect(knownPeersMigrationComplete()).toBe(true);
  });
});

// ─── AC-SEC-12 integration: loadKnownPeers + isAllowedDmSender ───────────────

describe('AC-SEC-12 integration', () => {
  it('a knownPeer-only peer (not in groups) is reachable via loadKnownPeers result', () => {
    rememberKnownPeer(ALICE);
    const knownPeers = loadKnownPeers();
    expect(knownPeers.has(ALICE)).toBe(true);
  });

  it('loadKnownPeers never returns own pubkey if callers filter correctly', () => {
    // When callers filter own pubkey before calling rememberKnownPeers
    const allPubkeys = [ALICE, OWN, BOB];
    const filtered = allPubkeys.filter((p) => p.toLowerCase() !== OWN.toLowerCase());
    rememberKnownPeers(filtered);
    const result = loadKnownPeers();
    expect(result.has(OWN)).toBe(false);
  });
});

// ─── AC-EVER-5: never removes entries ────────────────────────────────────────

describe('AC-EVER-5: no removal operations', () => {
  it('after rememberKnownPeer, subsequent rememberKnownPeers calls preserve existing entries', () => {
    rememberKnownPeer(ALICE);
    // Simulate a new batch that doesn't include ALICE (e.g. after ALICE left)
    rememberKnownPeers([BOB]);
    const result = loadKnownPeers();
    expect(result.has(ALICE)).toBe(true); // ALICE still present — AC-EVER-5
    expect(result.has(BOB)).toBe(true);
  });
});

// ─── AC-MIGRATE-5: migration notice acknowledgement ──────────────────────────
//
// AC-MIGRATE-5 specifies: on first navigation after migration, a UI banner
// shows. A dismiss button sets lp_knownPeersMigrationNoticeAck_v1 so the
// banner does not re-show. isMigrationNoticeAcknowledged() and
// acknowledgeMigrationNotice() are the localStorage-layer primitives
// that back this contract.
//
// Property: once the user has dismissed the migration notice, any subsequent
// check always reports acknowledged — across calls, simulated reloads,
// and idempotent re-acknowledgements.

const MIGRATION_NOTICE_ACK_KEY = 'lp_knownPeersMigrationNoticeAck_v1';

describe('isMigrationNoticeAcknowledged + acknowledgeMigrationNotice (AC-MIGRATE-5)', () => {
  it('returns false before the user has dismissed the migration banner', () => {
    expect(isMigrationNoticeAcknowledged()).toBe(false);
  });

  it('returns true immediately after acknowledgeMigrationNotice is called', () => {
    acknowledgeMigrationNotice();
    expect(isMigrationNoticeAcknowledged()).toBe(true);
  });

  it('stays acknowledged across multiple subsequent checks (banner does not re-show)', () => {
    acknowledgeMigrationNotice();
    expect(isMigrationNoticeAcknowledged()).toBe(true);
    expect(isMigrationNoticeAcknowledged()).toBe(true);
    expect(isMigrationNoticeAcknowledged()).toBe(true);
  });

  it('acknowledgeMigrationNotice is idempotent — calling twice does not break acknowledged state', () => {
    acknowledgeMigrationNotice();
    acknowledgeMigrationNotice();
    expect(isMigrationNoticeAcknowledged()).toBe(true);
  });

  it('persists the acknowledgement key in localStorage so a page reload would see it', () => {
    acknowledgeMigrationNotice();
    // The raw store entry must be present so a fresh module load (simulated
    // page reload) reads acknowledged = true without an extra call.
    expect(store[MIGRATION_NOTICE_ACK_KEY]).not.toBeUndefined();
    expect(store[MIGRATION_NOTICE_ACK_KEY]).not.toBeNull();
  });

  it('clears to unacknowledged when localStorage is wiped (e.g. account reset)', () => {
    acknowledgeMigrationNotice();
    expect(isMigrationNoticeAcknowledged()).toBe(true);
    localStorageMock.clear();
    expect(isMigrationNoticeAcknowledged()).toBe(false);
  });
});
