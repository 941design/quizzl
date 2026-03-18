import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generatePrivateKeyHex,
  derivePublicKeyHex,
  pubkeyToNpub,
  privkeyToNsec,
  npubToPubkeyHex,
  truncateNpub,
  loadStoredIdentity,
  saveStoredIdentity,
  clearStoredIdentity,
} from '@/src/lib/nostrKeys';

// ---------------------------------------------------------------------------
// localStorage mock
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

// crypto.getRandomValues mock for Node
Object.defineProperty(globalThis, 'crypto', {
  value: {
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
  },
  writable: true,
});

beforeEach(() => {
  localStorageMock.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generatePrivateKeyHex', () => {
  it('generates a 64-character hex string', () => {
    const key = generatePrivateKeyHex();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates different keys on each call', () => {
    const key1 = generatePrivateKeyHex();
    const key2 = generatePrivateKeyHex();
    expect(key1).not.toBe(key2);
  });
});

describe('derivePublicKeyHex', () => {
  it('derives a 64-character hex public key from a private key', async () => {
    const privateKeyHex = generatePrivateKeyHex();
    const pubkeyHex = await derivePublicKeyHex(privateKeyHex);
    expect(pubkeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces deterministic output for the same private key', async () => {
    const privateKeyHex = generatePrivateKeyHex();
    const pub1 = await derivePublicKeyHex(privateKeyHex);
    const pub2 = await derivePublicKeyHex(privateKeyHex);
    expect(pub1).toBe(pub2);
  });
});

describe('pubkeyToNpub / npubToPubkeyHex round-trip', () => {
  it('encodes and decodes a pubkey correctly', async () => {
    const privateKeyHex = generatePrivateKeyHex();
    const pubkeyHex = await derivePublicKeyHex(privateKeyHex);
    const npub = pubkeyToNpub(pubkeyHex);

    expect(npub).toMatch(/^npub1/);

    const decoded = npubToPubkeyHex(npub);
    expect(decoded).toBe(pubkeyHex);
  });

  it('returns null for invalid npub', () => {
    expect(npubToPubkeyHex('not-an-npub')).toBeNull();
    expect(npubToPubkeyHex('nsec1something')).toBeNull();
    expect(npubToPubkeyHex('')).toBeNull();
  });
});

describe('truncateNpub', () => {
  it('truncates a long npub with ellipsis', () => {
    const longNpub = 'npub1' + 'a'.repeat(60);
    const truncated = truncateNpub(longNpub, 8);
    expect(truncated).toContain('...');
    expect(truncated.length).toBeLessThan(longNpub.length);
  });

  it('does not truncate a short npub', () => {
    const shortNpub = 'npub1abc123';
    const result = truncateNpub(shortNpub, 8);
    expect(result).toBe(shortNpub);
  });
});

describe('loadStoredIdentity / saveStoredIdentity / clearStoredIdentity', () => {
  it('returns null when nothing is stored', () => {
    expect(loadStoredIdentity()).toBeNull();
  });

  it('saves and loads an identity', () => {
    const identity = {
      privateKeyHex: 'a'.repeat(64),
      pubkeyHex: 'b'.repeat(64),
    };
    saveStoredIdentity(identity);
    const loaded = loadStoredIdentity();
    expect(loaded).toEqual(identity);
  });

  it('returns null for malformed stored data', () => {
    localStorageMock.setItem('lp_nostrIdentity_v1', '{"invalid": true}');
    expect(loadStoredIdentity()).toBeNull();
  });

  it('clears the identity', () => {
    const identity = {
      privateKeyHex: 'a'.repeat(64),
      pubkeyHex: 'b'.repeat(64),
    };
    saveStoredIdentity(identity);
    clearStoredIdentity();
    expect(loadStoredIdentity()).toBeNull();
  });
});
