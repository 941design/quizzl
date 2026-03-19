/**
 * Singleton NDK instance for Nostr relay connections.
 * Initialized lazily — safe to import in SSR but only connects on client.
 */

import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { DEFAULT_RELAYS } from '@/src/types';

let ndkInstance: NDK | null = null;

/**
 * Get or create the global NDK singleton.
 * Pass a privateKeyHex to use a specific signer.
 * Returns null on server (SSR safety).
 */
export function getNdk(privateKeyHex?: string): NDK | null {
  if (typeof window === 'undefined') return null;

  if (!ndkInstance) {
    const signer = privateKeyHex
      ? new NDKPrivateKeySigner(privateKeyHex)
      : undefined;

    ndkInstance = new NDK({
      explicitRelayUrls: [...DEFAULT_RELAYS],
      signer,
    });
  } else if (privateKeyHex && !ndkInstance.signer) {
    ndkInstance.signer = new NDKPrivateKeySigner(privateKeyHex);
  }

  return ndkInstance;
}

/**
 * Connect the NDK singleton to relays. Safe to call multiple times.
 */
export async function connectNdk(privateKeyHex: string): Promise<NDK> {
  const ndk = getNdk(privateKeyHex)!;
  if (!ndk.signer) {
    ndk.signer = new NDKPrivateKeySigner(privateKeyHex);
  }
  await ndk.connect(2500);
  return ndk;
}

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Wrapper around ndk.fetchEvents that aborts after a timeout.
 * Prevents the UI from stalling when a relay is unreachable.
 */
export async function fetchEventsWithTimeout(
  ndk: NDK,
  filter: Parameters<NDK['fetchEvents']>[0],
  opts?: Parameters<NDK['fetchEvents']>[1],
  relaySet?: Parameters<NDK['fetchEvents']>[2],
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Set<import('@nostr-dev-kit/ndk').NDKEvent>> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<Set<import('@nostr-dev-kit/ndk').NDKEvent>>((resolve) => {
    timer = setTimeout(() => resolve(new Set()), timeoutMs);
  });
  try {
    return await Promise.race([ndk.fetchEvents(filter, opts, relaySet), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Reset the NDK singleton (for testing). */
export function _resetNdkSingleton(): void {
  ndkInstance = null;
}
