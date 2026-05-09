/**
 * Global incoming-DM watcher that drives the notification bell.
 *
 * Subscribes to all kind-4 events (NIP-04 legacy DMs) AND kind-1059 events
 * (NIP-17 gift-wrapped DMs) targeting the local pubkey. For each new event
 * from a non-self sender that postdates the peer's last-read timestamp, it
 * increments the unread direct-message count and remembers the contact.
 *
 * The subscription runs even when no contact chat is open — that's the whole
 * point: a DM should ring the bell whether or not the user has the thread
 * mounted. ContactChat keeps its own subscription for live message rendering;
 * the unread store dedups via lastRead timestamp + in-memory seen-id sets.
 *
 * Dedup keys per path (D7):
 *   kind-4   → event id  (outer event = the DM itself)
 *   kind-1059 → inner rumor id (outer id changes per relay redelivery;
 *              rumor id is stable across redeliveries)
 */

import type NDK from '@nostr-dev-kit/ndk';
import {
  CHAT_MESSAGE_KIND,
  DIRECT_MESSAGE_KIND,
  GIFT_WRAP_KIND,
  shouldIngestRumor,
  unwrapAndOpen,
  type UnsignedRumor,
} from '@/src/lib/directMessages';
import { createLogger } from '@/src/lib/logger';
import {
  getDirectMessageLastReadAt,
  incrementDirectMessage,
} from '@/src/lib/unreadStore';
import { rememberContact } from '@/src/lib/contacts';

const logger = createLogger('dm');

export type IncomingDmEvent = {
  id?: string;
  pubkey?: string;
  created_at?: number;
};

/**
 * Subscribe to inbound DMs (kind-4 NIP-04 and kind-1059 NIP-17 gift wraps)
 * and bump the notification bell for each new message from a non-self sender.
 *
 * @param params.ndk        NDK instance for relay subscriptions.
 * @param params.ownPubkeyHex  The local user's hex pubkey.
 * @param params.privateKeyHex The local user's hex private key. Required to
 *                             unwrap NIP-17 gift wraps. Obtained from
 *                             `useNostrIdentity()` in the watcher component.
 */
export function subscribeDirectMessageNotifications(params: {
  ndk: NDK;
  ownPubkeyHex: string;
  privateKeyHex: string;
}): () => void {
  const { ndk, ownPubkeyHex, privateKeyHex } = params;
  const ownLower = ownPubkeyHex.toLowerCase();

  // kind-4 dedup key: event id (the outer event is the DM itself)
  const seenMessageIds = new Set<string>();

  // kind-1059 dedup key: inner rumor id (outer id changes per relay redelivery)
  const seenRumorIds = new Set<string>();

  // ── kind-4 handler ──────────────────────────────────────────────────────────
  const kind4Sub = ndk.subscribe({
    kinds: [DIRECT_MESSAGE_KIND],
    '#p': [ownPubkeyHex],
  });

  const kind4Handler = (event: IncomingDmEvent) => {
    const peer = (event.pubkey ?? '').toLowerCase();
    if (!peer || peer === ownLower) return;
    if (event.id && seenMessageIds.has(event.id)) return;
    if (event.id) seenMessageIds.add(event.id);
    const createdMs = (event.created_at ?? 0) * 1000;
    if (createdMs <= getDirectMessageLastReadAt(peer)) return;
    rememberContact(peer);
    incrementDirectMessage(peer);
  };

  kind4Sub.on?.('event', kind4Handler);

  // ── kind-1059 handler ────────────────────────────────────────────────────────
  const kind1059Sub = ndk.subscribe({
    kinds: [GIFT_WRAP_KIND],
    '#p': [ownPubkeyHex],
  });

  // NDKEvent is the actual event type emitted by ndk.subscribe()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kind1059Handler = async (event: any) => {
    try {
      const rumor = await unwrapAndOpen(event as import('@nostr-dev-kit/ndk').NDKEvent, privateKeyHex);

      if (!shouldIngestRumor(rumor, '')) {
        logger.info('dm:rumor-rejected', { rumorId: rumor.id, reason: 'shouldIngestRumor-false' });
        return;
      }

      // Only kind-14 (NIP-17 chat messages) bump the bell.
      // kind-7 reactions, kind-444 welcomes, kind-21059 join requests — silently skip.
      if (rumor.kind !== CHAT_MESSAGE_KIND) return;

      if (rumor.pubkey === ownPubkeyHex) return;

      const createdMs = rumor.created_at * 1000;
      if (createdMs <= getDirectMessageLastReadAt(rumor.pubkey)) return;

      if (seenRumorIds.has(rumor.id)) return;
      seenRumorIds.add(rumor.id);

      rememberContact(rumor.pubkey);
      incrementDirectMessage(rumor.pubkey);
    } catch {
      // Foreign key, not addressed to us, malformed — silently skip per D3.
      logger.info('dm:unwrap-failed', { eventId: (event as any).id ?? 'unknown', reason: 'unwrap-threw' });
    }
  };

  kind1059Sub.on?.('event', kind1059Handler);

  // ── cleanup ──────────────────────────────────────────────────────────────────
  return () => {
    try {
      kind4Sub.stop?.();
    } catch {
      // non-fatal
    }
    try {
      kind1059Sub.stop?.();
    } catch {
      // non-fatal
    }
  };
}
