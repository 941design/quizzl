import { npubToPubkeyHex } from '@/src/lib/nostrKeys';
import { getNextPublicMaintainerNpubs } from '@/src/lib/publicEnv';

/**
 * Default maintainer npub — used when NEXT_PUBLIC_MAINTAINER_NPUBS is unset.
 * Setting the env var overrides this list entirely.
 */
const DEFAULT_MAINTAINER_NPUB = 'npub16xxxg3zs8pjz0rdyg9c485um04866leaz4a9hy2s4zm7mgsxx3xs9r87e2';

/**
 * Decode a comma-separated list of npubs into hex pubkeys.
 * Fail-soft: undecodable entries are silently dropped.
 * Never throws.
 */
function decodeNpubs(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .reduce<string[]>((acc, npub) => {
      try {
        const hex = npubToPubkeyHex(npub);
        if (hex) acc.push(hex);
      } catch {
        // Silently drop undecodable entry
      }
      return acc;
    }, []);
}

function resolveMaintainerPubkeys(): string[] {
  const raw = getNextPublicMaintainerNpubs();
  // An explicitly-configured list governs entirely. When a deployer SETS the
  // env var but every entry is undecodable, the resulting list is empty and the
  // feature is DISABLED (AC-CONFIG-3) — we must NOT silently fall back to the
  // built-in default, which would route users' feedback to the default
  // maintainer on a deployer typo. The default applies ONLY when the env var is
  // unset/blank (AC-CONFIG-2).
  if (raw !== undefined && raw.trim() !== '') {
    return decodeNpubs(raw);
  }
  // Env var unset/blank → built-in default.
  const defaultHex = npubToPubkeyHex(DEFAULT_MAINTAINER_NPUB);
  return defaultHex ? [defaultHex] : [];
}

/** Decoded hex pubkeys of the maintainer(s). Falls back to the built-in default. */
export const MAINTAINER_PUBKEYS_HEX: string[] = resolveMaintainerPubkeys();

/**
 * The primary maintainer pubkey for outbound DMs.
 * Null when the list is empty, which disables the feedback feature.
 */
export const MAINTAINER_ACTIVE_PUBKEY_HEX: string | null = MAINTAINER_PUBKEYS_HEX[0] ?? null;

/** Display name shown in the feedback UI. */
export const MAINTAINER_DISPLAY_NAME = 'Nostling Team';

/** Returns true when the given hex pubkey belongs to a maintainer. Case-insensitive. */
export function isMaintainerPubkey(hex: string): boolean {
  const lower = hex.toLowerCase();
  return MAINTAINER_PUBKEYS_HEX.some((pk) => pk.toLowerCase() === lower);
}
