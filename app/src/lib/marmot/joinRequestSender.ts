/**
 * Join request sender — builds a kind 21059 inner rumor and wraps it
 * in a NIP-59 gift wrap (kind 1059) for publishing to relays.
 *
 * This is the invitee-side counterpart to the admin-side gift-wrap
 * handler in welcomeSubscription.ts.
 */

import type { EventSigner } from 'applesauce-core';
import { DEFAULT_RELAYS } from '@/src/types';

export const JOIN_REQUEST_RUMOR_KIND = 21059;

export interface JoinRequestRumor {
  id: string;
  kind: typeof JOIN_REQUEST_RUMOR_KIND;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * Build the inner join-request rumor (kind 21059).
 * This rumor is never published in cleartext — it's always wrapped in NIP-59.
 */
export function buildJoinRequestRumor(params: {
  requesterPubkeyHex: string;
  adminPubkeyHex: string;
  nonce: string;
  groupName: string;
}): Omit<JoinRequestRumor, 'id'> {
  return {
    kind: JOIN_REQUEST_RUMOR_KIND,
    pubkey: params.requesterPubkeyHex,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', params.adminPubkeyHex]],
    content: JSON.stringify({
      type: 'join_request',
      nonce: params.nonce,
      name: params.groupName,
    }),
  };
}

/**
 * Construct a NIP-59 gift wrap (kind 1059) around the join request rumor.
 *
 * Two-layer encryption:
 *   Layer 1 (Seal, kind 13): rumor encrypted with sender's real key → admin's pubkey
 *   Layer 2 (Gift Wrap, kind 1059): seal encrypted with ephemeral key → admin's pubkey
 *
 * The gift wrap uses a random ephemeral key so the sender's identity is hidden
 * from relay operators — only the admin can decrypt and learn who sent it.
 */
export async function buildGiftWrap(
  rumor: Omit<JoinRequestRumor, 'id'>,
  signer: EventSigner,
  adminPubkeyHex: string,
): Promise<{ id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }> {
  const { getEventHash } = await import('applesauce-core/helpers/event');
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const nip44 = await import('nostr-tools/nip44');

  // Add id to rumor
  const rumorWithId = { ...rumor, id: '' };
  rumorWithId.id = getEventHash(rumorWithId);

  // Layer 1: Seal (kind 13) — encrypt rumor with sender's real key
  const rumorJson = JSON.stringify(rumorWithId);
  const sealContent = await signer.nip44!.encrypt(adminPubkeyHex, rumorJson);
  const senderPubkey = await signer.getPublicKey();

  const sealDraft = {
    kind: 13,
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: sealContent,
  };
  const sealWithId = { ...sealDraft, id: '' };
  sealWithId.id = getEventHash(sealWithId);

  // Layer 2: Gift Wrap (kind 1059) — encrypt seal with ephemeral key
  const ephemeralPrivBytes = new Uint8Array(32);
  crypto.getRandomValues(ephemeralPrivBytes);
  const ephemeralPubkey = getPublicKey(ephemeralPrivBytes);

  const sealJson = JSON.stringify(sealWithId);
  const conversationKey = nip44.v2.utils.getConversationKey(ephemeralPrivBytes, adminPubkeyHex);
  const giftWrapContent = nip44.v2.encrypt(sealJson, conversationKey);

  const giftWrapEvent = finalizeEvent(
    {
      kind: 1059,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', adminPubkeyHex]],
      content: giftWrapContent,
    },
    ephemeralPrivBytes,
  );

  return {
    id: giftWrapEvent.id,
    pubkey: giftWrapEvent.pubkey,
    created_at: giftWrapEvent.created_at,
    kind: giftWrapEvent.kind,
    tags: giftWrapEvent.tags,
    content: giftWrapEvent.content,
    sig: giftWrapEvent.sig,
  };
}

/**
 * Build and publish a join request gift wrap to default relays.
 */
export async function sendJoinRequest(params: {
  requesterPubkeyHex: string;
  adminPubkeyHex: string;
  nonce: string;
  groupName: string;
  signer: EventSigner;
}): Promise<void> {
  const rumor = buildJoinRequestRumor({
    requesterPubkeyHex: params.requesterPubkeyHex,
    adminPubkeyHex: params.adminPubkeyHex,
    nonce: params.nonce,
    groupName: params.groupName,
  });

  const giftWrap = await buildGiftWrap(rumor, params.signer, params.adminPubkeyHex);

  // Publish to default relays via raw WebSocket (same pattern as NdkNetworkAdapter)
  const relays = [...DEFAULT_RELAYS];
  await Promise.all(relays.map((relay) => rawPublish(relay, giftWrap)));
}

function rawPublish(
  relayUrl: string,
  event: { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string },
  timeoutMs = 10_000,
): Promise<{ from: string; ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(relayUrl);
      const timer = setTimeout(() => {
        ws.close();
        resolve({ from: relayUrl, ok: false, message: 'timeout' });
      }, timeoutMs);

      ws.onopen = () => {
        ws.send(JSON.stringify(['EVENT', event]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data[0] === 'OK' && data[1] === event.id) {
            clearTimeout(timer);
            ws.close();
            resolve({ from: relayUrl, ok: data[2] === true, message: data[3] });
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onerror = () => {
        clearTimeout(timer);
        ws.close();
        resolve({ from: relayUrl, ok: false, message: 'websocket error' });
      };
    } catch (err) {
      resolve({
        from: relayUrl,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
