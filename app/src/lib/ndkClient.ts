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

export type FetchResult = {
  events: Set<import('@nostr-dev-kit/ndk').NDKEvent>;
  timedOut: boolean;
};

/**
 * Fetch events with a hard timeout that actually cancels the underlying
 * NDK subscription (via sub.stop()) so no dangling background work remains.
 * Deduplicates events by ID (matching NDK.fetchEvents behaviour) so callers
 * that pick "newest" or assume one event per ID get consistent results.
 * Returns { events, timedOut } so callers can distinguish a clean empty
 * result from an incomplete fetch.
 */
export function fetchEventsWithTimeout(
  ndk: NDK,
  filter: Parameters<NDK['fetchEvents']>[0],
  opts?: Parameters<NDK['fetchEvents']>[1],
  relaySet?: Parameters<NDK['fetchEvents']>[2],
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<FetchResult> {
  // Deduplicate by event ID — same logical event may arrive from multiple
  // relays. NDK.fetchEvents() uses deduplicationKey() internally; for
  // standard events that key is the event ID.
  const byId = new Map<string, import('@nostr-dev-kit/ndk').NDKEvent>();
  const sub = ndk.subscribe(filter, { closeOnEose: true, ...opts }, relaySet);

  return new Promise<FetchResult>((resolve) => {
    let settled = false;

    function settle(timedOut: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.stop();
      resolve({ events: new Set(byId.values()), timedOut });
    }

    const timer = setTimeout(() => settle(true), timeoutMs);

    sub.on('event', (event: import('@nostr-dev-kit/ndk').NDKEvent) => {
      const id = event.id;
      if (id && !byId.has(id)) {
        byId.set(id, event);
      }
    });

    sub.on('eose', () => settle(false));
  });
}

/** Reset the NDK singleton (for testing). */
export function _resetNdkSingleton(): void {
  ndkInstance = null;
}
