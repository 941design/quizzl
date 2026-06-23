/**
 * Unit tests for turnConfig.ts — Story S4.
 *
 * Tests:
 *   T1. getIceConfig() returns DEFAULT_STUN + iceTransportPolicy:'all' when no user config.
 *   T2. After setTurnServer(config), getIceConfig() includes the TURN server.
 *   T3. After setTurnServer(null), the TURN entry is removed.
 *   T4. After setIpPrivacyMode(true), getIceConfig().iceTransportPolicy === 'relay'.
 *   T5. getIpPrivacyMode() defaults to false.
 *   T6. Works when localStorage is undefined (SSR guard).
 *
 * Mocking strategy:
 *   localStorage is replaced per test with a simple Record-backed in-memory stub
 *   via vi.stubGlobal so each test starts from a clean slate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getIceConfig,
  setTurnServer,
  setIpPrivacyMode,
  getIpPrivacyMode,
} from '@/src/lib/calls/turnConfig';

// ── In-memory localStorage stub ───────────────────────────────────────────────

function makeLocalStorageStub(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  } as Storage;
}

// Expected default STUN URLs
const STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
];

function getIceServerUrls(config: ReturnType<typeof getIceConfig>): string[] {
  return config.iceServers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('turnConfig', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── T1: Defaults ──────────────────────────────────────────────────────────

  it('T1: getIceConfig() returns three DEFAULT_STUN servers and iceTransportPolicy "all" when unconfigured', () => {
    const config = getIceConfig();

    expect(config.iceTransportPolicy).toBe('all');
    const urls = getIceServerUrls(config);
    for (const expected of STUN_URLS) {
      expect(urls).toContain(expected);
    }
    // Exactly three servers when no TURN is configured
    expect(config.iceServers).toHaveLength(3);
  });

  // ── T2: TURN server saved ─────────────────────────────────────────────────

  it('T2: after setTurnServer(), getIceConfig() appends the TURN server to the list', () => {
    setTurnServer({
      url: 'turn:turn.example.com:3478',
      username: 'alice',
      credential: 's3cr3t',
    });

    const config = getIceConfig();

    // DEFAULT_STUN still present
    const urls = getIceServerUrls(config);
    for (const expected of STUN_URLS) {
      expect(urls).toContain(expected);
    }

    // TURN server appended
    expect(config.iceServers).toHaveLength(4);
    const turnEntry = config.iceServers.find((s) =>
      (Array.isArray(s.urls) ? s.urls[0] : s.urls) === 'turn:turn.example.com:3478',
    );
    expect(turnEntry).toBeDefined();
    expect(turnEntry?.username).toBe('alice');
    expect(turnEntry?.credential).toBe('s3cr3t');
  });

  it('T2: TURN server without credentials is accepted (url-only)', () => {
    setTurnServer({ url: 'turn:relay.example.com:443' });

    const config = getIceConfig();
    expect(config.iceServers).toHaveLength(4);
    const turnEntry = config.iceServers.find((s) =>
      (Array.isArray(s.urls) ? s.urls[0] : s.urls) === 'turn:relay.example.com:443',
    );
    expect(turnEntry).toBeDefined();
    expect(turnEntry?.username).toBeUndefined();
    expect(turnEntry?.credential).toBeUndefined();
  });

  // ── T3: TURN server cleared ───────────────────────────────────────────────

  it('T3: after setTurnServer(null), TURN entry is removed and only DEFAULT_STUN remain', () => {
    setTurnServer({ url: 'turn:turn.example.com:3478' });
    setTurnServer(null);

    const config = getIceConfig();
    expect(config.iceServers).toHaveLength(3);
    const urls = getIceServerUrls(config);
    expect(urls.some((u) => u.startsWith('turn:'))).toBe(false);
  });

  // ── T4: IP privacy mode ───────────────────────────────────────────────────

  it('T4: after setIpPrivacyMode(true), iceTransportPolicy is "relay"', () => {
    setIpPrivacyMode(true);
    expect(getIceConfig().iceTransportPolicy).toBe('relay');
  });

  it('T4: after setIpPrivacyMode(false), iceTransportPolicy is "all"', () => {
    setIpPrivacyMode(true);
    setIpPrivacyMode(false);
    expect(getIceConfig().iceTransportPolicy).toBe('all');
  });

  // ── T5: getIpPrivacyMode defaults ────────────────────────────────────────

  it('T5: getIpPrivacyMode() returns false when not yet configured', () => {
    expect(getIpPrivacyMode()).toBe(false);
  });

  it('T5: getIpPrivacyMode() reflects the saved value', () => {
    setIpPrivacyMode(true);
    expect(getIpPrivacyMode()).toBe(true);
  });

  // ── T6: SSR guard ─────────────────────────────────────────────────────────

  it('T6: getIceConfig() returns DEFAULT_STUN with policy "all" when localStorage is undefined', () => {
    vi.unstubAllGlobals();
    // Simulate SSR: remove localStorage from the global scope
    vi.stubGlobal('localStorage', undefined);

    const config = getIceConfig();
    expect(config.iceTransportPolicy).toBe('all');
    expect(config.iceServers).toHaveLength(3);
    const urls = getIceServerUrls(config);
    for (const expected of STUN_URLS) {
      expect(urls).toContain(expected);
    }
  });

  it('T6: setTurnServer() does not throw when localStorage is undefined', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', undefined);

    expect(() => setTurnServer({ url: 'turn:turn.example.com:3478' })).not.toThrow();
  });

  it('T6: getIpPrivacyMode() returns false when localStorage is undefined', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', undefined);

    expect(getIpPrivacyMode()).toBe(false);
  });
});
