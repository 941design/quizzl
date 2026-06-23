/**
 * ICE / TURN configuration for WebRTC peer connections (Story S4).
 *
 * Persists user TURN server settings and the IP-privacy toggle in localStorage
 * under the key `lp_turnConfig_v1`. Pure library code — no React, no context
 * imports.
 *
 * getIceConfig() is the primary export consumed by PeerSession. It always
 * includes the DEFAULT_STUN servers, appends a user-supplied TURN server when
 * present, and sets iceTransportPolicy to 'relay' when IP privacy mode is on.
 */

// ── Storage key ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'lp_turnConfig_v1';

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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the RTCConfiguration ice parameters for a new peer connection.
 *
 * Always includes DEFAULT_STUN. Appends the user's TURN server when configured.
 * Returns iceTransportPolicy 'relay' when IP privacy mode is enabled, 'all'
 * otherwise.
 */
export function getIceConfig(): IceConfig {
  const stored = readStored();

  const iceServers: RTCIceServer[] = [...DEFAULT_STUN];

  if (stored.turn) {
    const turnServer: RTCIceServer = { urls: stored.turn.url };
    if (stored.turn.username !== undefined) turnServer.username = stored.turn.username;
    if (stored.turn.credential !== undefined) turnServer.credential = stored.turn.credential;
    iceServers.push(turnServer);
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
