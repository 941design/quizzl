/**
 * Tests for relay.ts — isValidRelayUrl, getEffectiveRelays, saveRelays
 *
 * Property families used:
 * - Family C (output contracts): valid URLs always start with wss:// or ws://;
 *   isValidRelayUrl rejects anything that fails the structural invariant.
 * - Parameterized examples cover the boundary cases for validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isValidRelayUrl, getEffectiveRelays, saveRelays } from '@/src/lib/relay';
import { DEFAULT_RELAYS, STORAGE_KEYS } from '@/src/types';

// ── localStorage mock ──────────────────────────────────────────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// ── isValidRelayUrl ───────────────────────────────────────────────────────────

describe('isValidRelayUrl', () => {
  describe('valid URLs', () => {
    it.each([
      ['wss://relay.damus.io'],
      ['wss://relay.nostr.band'],
      ['ws://localhost:7777'],
      ['wss://relay.example.com/path'],
      ['ws://127.0.0.1:8080'],
    ])('accepts %s', (url) => {
      expect(isValidRelayUrl(url)).toBe(true);
    });
  });

  describe('invalid URLs', () => {
    it.each([
      ['', 'empty string'],
      ['https://relay.example.com', 'https scheme'],
      ['http://relay.example.com', 'http scheme'],
      ['relay.example.com', 'no scheme'],
      ['wss://', 'no hostname'],
      ['wss://', 'just scheme with slash'],
      ['not-a-url', 'random string'],
      ['   ', 'whitespace only'],
    ])('rejects %s (%s)', (url) => {
      expect(isValidRelayUrl(url)).toBe(false);
    });
  });

  // Property: every URL that isValidRelayUrl returns true for starts with wss:// or ws://
  it('structural invariant: all accepted URLs have wss:// or ws:// prefix', () => {
    const candidates = [
      'wss://a.b',
      'ws://a.b',
      'wss://relay.nostr.band',
      'ws://localhost:7777',
      'https://not-a-relay.com',
      '',
      'ftp://something',
      'wss://',
    ];
    for (const url of candidates) {
      if (isValidRelayUrl(url)) {
        expect(url.startsWith('wss://') || url.startsWith('ws://')).toBe(true);
      }
    }
  });
});

// ── getEffectiveRelays ────────────────────────────────────────────────────────

describe('getEffectiveRelays', () => {
  beforeEach(() => localStorageMock.clear());

  it('returns DEFAULT_RELAYS when nothing stored', () => {
    expect(getEffectiveRelays()).toEqual(DEFAULT_RELAYS);
  });

  it('returns stored relay list when valid JSON array is present', () => {
    const custom = ['wss://relay.a.com', 'wss://relay.b.com'];
    localStorageMock.setItem(STORAGE_KEYS.relays, JSON.stringify(custom));
    expect(getEffectiveRelays()).toEqual(custom);
  });

  it('falls back to DEFAULT_RELAYS when stored value is an empty array', () => {
    localStorageMock.setItem(STORAGE_KEYS.relays, JSON.stringify([]));
    expect(getEffectiveRelays()).toEqual(DEFAULT_RELAYS);
  });

  it('falls back to DEFAULT_RELAYS when stored value is not an array', () => {
    localStorageMock.setItem(STORAGE_KEYS.relays, '"not-an-array"');
    expect(getEffectiveRelays()).toEqual(DEFAULT_RELAYS);
  });

  it('falls back to DEFAULT_RELAYS when stored value is malformed JSON', () => {
    localStorageMock.setItem(STORAGE_KEYS.relays, '{bad json}');
    expect(getEffectiveRelays()).toEqual(DEFAULT_RELAYS);
  });

  // Property: result is always a non-empty array
  it('always returns a non-empty array regardless of storage state', () => {
    const scenarios = [
      () => {},                                                                // nothing stored
      () => localStorageMock.setItem(STORAGE_KEYS.relays, '[]'),              // empty array
      () => localStorageMock.setItem(STORAGE_KEYS.relays, 'garbage'),         // garbage
      () => localStorageMock.setItem(STORAGE_KEYS.relays, JSON.stringify(['wss://r.com'])), // valid
    ];
    for (const setup of scenarios) {
      localStorageMock.clear();
      setup();
      const result = getEffectiveRelays();
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

// ── saveRelays ────────────────────────────────────────────────────────────────

describe('saveRelays', () => {
  beforeEach(() => localStorageMock.clear());

  it('round-trips through getEffectiveRelays', () => {
    const relays = ['wss://a.com', 'wss://b.com'];
    saveRelays(relays);
    expect(getEffectiveRelays()).toEqual(relays);
  });

  // Property: save → get is an identity round-trip for any non-empty array
  it('save→get round-trip holds for arbitrary relay lists', () => {
    const lists = [
      ['wss://relay.damus.io'],
      ['ws://localhost', 'wss://relay.nostr.band'],
      ['wss://a', 'wss://b', 'wss://c'],
    ];
    for (const list of lists) {
      saveRelays(list);
      expect(getEffectiveRelays()).toEqual(list);
    }
  });
});
