/**
 * Global incoming-DM watcher that drives the notification bell.
 *
 * Subscribes to all kind-4 events targeting the local pubkey. For each new
 * event from a non-self sender that postdates the peer's last-read timestamp,
 * it increments the unread direct-message count and remembers the contact.
 *
 * The subscription runs even when no contact chat is open — that's the whole
 * point: a DM should ring the bell whether or not the user has the thread
 * mounted. ContactChat keeps its own subscription for live message rendering;
 * the unread store dedups via lastRead timestamp + in-memory seen-id set.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { DIRECT_MESSAGE_KIND } from '@/src/lib/directMessages';
import {
  getDirectMessageLastReadAt,
  incrementDirectMessage,
} from '@/src/lib/unreadStore';
import { rememberContact } from '@/src/lib/contacts';

export type IncomingDmEvent = {
  id?: string;
  pubkey?: string;
  created_at?: number;
};

export function subscribeDirectMessageNotifications(params: {
  ndk: NDK;
  ownPubkeyHex: string;
}): () => void {
  const { ndk, ownPubkeyHex } = params;
  const ownLower = ownPubkeyHex.toLowerCase();
  const seen = new Set<string>();

  const sub = ndk.subscribe({
    kinds: [DIRECT_MESSAGE_KIND],
    '#p': [ownPubkeyHex],
  });

  const handler = (event: IncomingDmEvent) => {
    const peer = (event.pubkey ?? '').toLowerCase();
    if (!peer || peer === ownLower) return;
    if (event.id && seen.has(event.id)) return;
    if (event.id) seen.add(event.id);
    const createdMs = (event.created_at ?? 0) * 1000;
    if (createdMs <= getDirectMessageLastReadAt(peer)) return;
    rememberContact(peer);
    incrementDirectMessage(peer);
  };

  sub.on?.('event', handler);
  return () => {
    try {
      sub.stop?.();
    } catch {
      // non-fatal
    }
  };
}
