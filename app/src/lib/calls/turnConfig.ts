/**
 * ICE / TURN configuration for WebRTC peer connections (Story S4).
 *
 * Persists user TURN server settings and the IP-privacy toggle in localStorage
 * under the key `lp_turnConfig_v1`. Pure library code — no React, no context
 * imports.
 *
 * getIceConfig() is the primary export consumed by PeerSession. It always
 * includes the DEFAULT_STUN servers, adds a TURN relay (the user-supplied one
 * when present, otherwise the shipped OpenRelay default), and sets
 * iceTransportPolicy to 'relay' when IP privacy mode is on.
 *
 * Interop note: a TURN relay is a de-facto requirement for connectivity — any
 * call where one peer is behind a symmetric NAT/firewall can never form a
 * candidate pair without one. Amethyst (the AC-WebRTC reference client) ships
 * the same public OpenRelay defaults, so shipping them here is what makes calls
 * connect out-of-the-box and interoperate with Amethyst. A user-configured TURN
 * server *replaces* the OpenRelay default (matching Amethyst), letting operators
 * point at their own relay without an app update.
 */

// ── Storage key ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'lp_turnConfig_v1';

/**
 * Test-only ICE override. When `lp_callIceOverride_v1` holds a JSON IceConfig,
 * getIceConfig() returns it verbatim, bypassing all STUN/TURN defaults.
 *
 * E2e tests inject `{ "iceServers": [], "iceTransportPolicy": "all" }` so two
 * browser contexts on the same machine form a connection from loopback host
 * candidates alone — deterministic, with no dependency on public STUN/TURN
 * (which is non-deterministic in CI and unreachable offline). This matches
 * AC-FLOW-1's "loopback ICE, no external TURN required" mandate. The key is
 * never set in production.
 */
const ICE_OVERRIDE_KEY = 'lp_callIceOverride_v1';

// ── Public types ──────────────────────────────────────────────────────────────

export interface TurnServerConfig {
  url: string;
  username?: string;
  credential?: string;
}

export interface IceConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
}

// ── Stored shape ──────────────────────────────────────────────────────────────

interface StoredConfig {
  turn: TurnServerConfig | null;
  ipPrivacy: boolean;
}

// ── Default STUN servers (always present) ─────────────────────────────────────

const DEFAULT_STUN: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// ── Default TURN relay (always present unless the user overrides it) ───────────
// Public OpenRelay community service operated by Metered (not by this project),
// matching the AC-WebRTC reference client (Amethyst). Shared credentials are
// intentional and public — they only grant relay access, not account identity.
const DEFAULT_TURN: RTCIceServer[] = [
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

// ── localStorage helpers (SSR-safe) ──────────────────────────────────────────

function readStored(): StoredConfig {
  if (typeof localStorage === 'undefined') {
    return { turn: null, ipPrivacy: false };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { turn: null, ipPrivacy: false };
    return JSON.parse(raw) as StoredConfig;
  } catch {
    return { turn: null, ipPrivacy: false };
  }
}

function writeStored(config: StoredConfig): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/**
 * Read the test-only ICE override (see ICE_OVERRIDE_KEY). Returns null when the
 * key is absent or malformed, so production always falls through to the normal
 * STUN/TURN config.
 */
function readIceOverride(): IceConfig | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ICE_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<IceConfig>;
    if (!parsed || !Array.isArray(parsed.iceServers)) return null;
    return {
      iceServers: parsed.iceServers,
      iceTransportPolicy: parsed.iceTransportPolicy === 'relay' ? 'relay' : 'all',
    };
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the RTCConfiguration ice parameters for a new peer connection.
 *
 * Always includes DEFAULT_STUN. Adds a TURN relay: the user's configured server
 * when present (which replaces the default), otherwise the shipped OpenRelay
 * default. Returns iceTransportPolicy 'relay' when IP privacy mode is enabled,
 * 'all' otherwise.
 */
export function getIceConfig(): IceConfig {
  // Test override short-circuits the STUN/TURN defaults for deterministic
  // loopback connections in e2e/CI (see ICE_OVERRIDE_KEY).
  const override = readIceOverride();
  if (override) return override;

  const stored = readStored();

  const iceServers: RTCIceServer[] = [...DEFAULT_STUN];

  if (stored.turn) {
    // User-configured TURN replaces the OpenRelay default.
    const turnServer: RTCIceServer = { urls: stored.turn.url };
    if (stored.turn.username !== undefined) turnServer.username = stored.turn.username;
    if (stored.turn.credential !== undefined) turnServer.credential = stored.turn.credential;
    iceServers.push(turnServer);
  } else {
    // No user override — ship the OpenRelay default so calls connect out-of-the-box.
    iceServers.push(...DEFAULT_TURN);
  }

  return {
    iceServers,
    iceTransportPolicy: stored.ipPrivacy ? 'relay' : 'all',
  };
}

/**
 * Save (or clear) the user's TURN server configuration.
 * Passing null removes the TURN entry while preserving the IP privacy setting.
 */
export function setTurnServer(config: TurnServerConfig | null): void {
  const stored = readStored();
  stored.turn = config;
  writeStored(stored);
}

/**
 * Enable or disable IP privacy mode.
 * When enabled, getIceConfig() returns iceTransportPolicy: 'relay', forcing all
 * media to route through TURN servers so the peer never sees the local IP.
 */
export function setIpPrivacyMode(enabled: boolean): void {
  const stored = readStored();
  stored.ipPrivacy = enabled;
  writeStored(stored);
}

/**
 * Read the current IP privacy setting. Defaults to false when not yet configured.
 */
export function getIpPrivacyMode(): boolean {
  return readStored().ipPrivacy;
}
