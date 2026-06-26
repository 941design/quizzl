/**
 * Unit tests for turnConfig.ts — Story S4.
 *
 * Tests:
 *   T1. getIceConfig() returns DEFAULT_STUN + OpenRelay TURN default + iceTransportPolicy:'all' when no user config.
 *   T2. After setTurnServer(config), getIceConfig() includes the user TURN server (replacing the OpenRelay default).
 *   T3. After setTurnServer(null), the user TURN entry is removed and the OpenRelay default is restored.
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

// Expected default OpenRelay TURN URLs (shipped when the user has no override)
const OPENRELAY_TURN_URLS = [
  'turn:openrelay.metered.ca:80',
  'turn:openrelay.metered.ca:443',
  'turn:openrelay.metered.ca:443?transport=tcp',
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

  it('T1: getIceConfig() returns DEFAULT_STUN + OpenRelay TURN default and iceTransportPolicy "all" when unconfigured', () => {
    const config = getIceConfig();

    expect(config.iceTransportPolicy).toBe('all');
    const urls = getIceServerUrls(config);
    for (const expected of STUN_URLS) {
      expect(urls).toContain(expected);
    }
    // OpenRelay TURN default must be present so calls connect out-of-the-box.
    for (const expected of OPENRELAY_TURN_URLS) {
      expect(urls).toContain(expected);
    }
    // Three STUN entries + one OpenRelay TURN entry.
    expect(config.iceServers).toHaveLength(4);
    const turnEntry = config.iceServers.find((s) =>
      (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith('turn:openrelay')),
    );
    expect(turnEntry?.username).toBe('openrelayproject');
    expect(turnEntry?.credential).toBe('openrelayproject');
  });

  // ── T2: TURN server saved ─────────────────────────────────────────────────

  it('T2: after setTurnServer(), getIceConfig() uses the user TURN server in place of the OpenRelay default', () => {
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

    // User TURN server present; OpenRelay default replaced (not appended).
    expect(config.iceServers).toHaveLength(4);
    expect(urls.some((u) => u.startsWith('turn:openrelay'))).toBe(false);
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

  it('T3: after setTurnServer(null), the user TURN entry is removed and the OpenRelay default is restored', () => {
    setTurnServer({ url: 'turn:turn.example.com:3478' });
    setTurnServer(null);

    const config = getIceConfig();
    expect(config.iceServers).toHaveLength(4);
    const urls = getIceServerUrls(config);
    // User TURN gone, OpenRelay default back.
    expect(urls.some((u) => u === 'turn:turn.example.com:3478')).toBe(false);
    for (const expected of OPENRELAY_TURN_URLS) {
      expect(urls).toContain(expected);
    }
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

  // ── T7: Test ICE override ─────────────────────────────────────────────────

  it('T7: a valid lp_callIceOverride_v1 short-circuits the STUN/TURN defaults', () => {
    localStorage.setItem(
      'lp_callIceOverride_v1',
      JSON.stringify({ iceServers: [], iceTransportPolicy: 'all' }),
    );

    const config = getIceConfig();
    // Override returned verbatim — no STUN, no OpenRelay TURN.
    expect(config.iceServers).toHaveLength(0);
    expect(config.iceTransportPolicy).toBe('all');
  });

  it('T7: the override wins even when a user TURN server and IP-privacy are set', () => {
    setTurnServer({ url: 'turn:turn.example.com:3478' });
    setIpPrivacyMode(true);
    localStorage.setItem(
      'lp_callIceOverride_v1',
      JSON.stringify({ iceServers: [{ urls: 'stun:override.example:3478' }], iceTransportPolicy: 'relay' }),
    );

    const config = getIceConfig();
    expect(getIceServerUrls(config)).toEqual(['stun:override.example:3478']);
    expect(config.iceTransportPolicy).toBe('relay');
  });

  it('T7: a malformed override is ignored and the defaults apply', () => {
    localStorage.setItem('lp_callIceOverride_v1', '{ not valid json');

    const config = getIceConfig();
    // Falls through to the normal default (3 STUN + 1 OpenRelay TURN).
    expect(config.iceServers).toHaveLength(4);
    const urls = getIceServerUrls(config);
    for (const expected of OPENRELAY_TURN_URLS) {
      expect(urls).toContain(expected);
    }
  });

  // ── T6: SSR guard ─────────────────────────────────────────────────────────

  it('T6: getIceConfig() returns DEFAULT_STUN + OpenRelay TURN default with policy "all" when localStorage is undefined', () => {
    vi.unstubAllGlobals();
    // Simulate SSR: remove localStorage from the global scope
    vi.stubGlobal('localStorage', undefined);

    const config = getIceConfig();
    expect(config.iceTransportPolicy).toBe('all');
    expect(config.iceServers).toHaveLength(4);
    const urls = getIceServerUrls(config);
    for (const expected of STUN_URLS) {
      expect(urls).toContain(expected);
    }
    for (const expected of OPENRELAY_TURN_URLS) {
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
