/**
 * Join request sender — builds a kind 21059 inner rumor and wraps it
 * in a NIP-59 gift wrap (kind 1059) for publishing to relays.
 *
 * This is the invitee-side counterpart to the admin-side gift-wrap
 * handler in welcomeSubscription.ts.
 */

import { wrapEvent } from 'nostr-tools/nip59';
import { getPublicKey } from 'nostr-tools/pure';
import { hexToBytes } from 'nostr-tools/utils';
import { DEFAULT_RELAYS } from '@/src/types';
import { saveOutboundJoinRequest } from './outboundJoinRequests';

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
  requesterName?: string;
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
      requesterName: params.requesterName,
    }),
  };
}

/**
 * Construct a NIP-59 gift wrap (kind 1059) around the join request rumor.
 *
 * Two-layer encryption via the audited nostr-tools/nip59 `wrapEvent` helper —
 * the same one directMessages.ts's `sealAndWrap` uses for the DM path
 * (AC-AUTH-0). `wrapEvent` internally:
 *   Layer 1 (Seal, kind 13): builds the rumor (recomputing its id and pubkey
 *     from the REAL requester key below), then signs the seal with a genuine
 *     schnorr signature over it (finalizeEvent) — the seal previously carried
 *     only an `id`, never a `sig`; this is the fix.
 *   Layer 2 (Gift Wrap, kind 1059): encrypts the seal with a fresh ephemeral
 *     key so the sender's identity is hidden from relay operators — only the
 *     admin can decrypt and learn who sent it.
 *
 * This MUST land together with welcomeSubscription.ts's enforcement of seal
 * verification — enforcing verification while this seal was still unsigned
 * would drop every join request (architecture.md's S3 internal coupling).
 */
export async function buildGiftWrap(
  rumor: Omit<JoinRequestRumor, 'id'>,
  requesterPrivateKeyHex: string,
  adminPubkeyHex: string,
): Promise<{ id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }> {
  const privKeyBytes = hexToBytes(requesterPrivateKeyHex);

  const wrap = wrapEvent(
    {
      kind: rumor.kind,
      content: rumor.content,
      tags: rumor.tags,
      created_at: rumor.created_at,
    },
    privKeyBytes,
    adminPubkeyHex,
  );

  return {
    id: wrap.id,
    pubkey: wrap.pubkey,
    created_at: wrap.created_at,
    kind: wrap.kind,
    tags: wrap.tags,
    content: wrap.content,
    sig: wrap.sig,
  };
}

/**
 * Build and publish a join request gift wrap to default relays.
 *
 * `requesterPubkeyHex` is used only to populate the (self-claimed, unsigned)
 * inner rumor's `pubkey` field via `buildJoinRequestRumor` — the seal and
 * gift-wrap layers `buildGiftWrap` produces derive their pubkey solely from
 * `requesterPrivateKeyHex` (see `buildGiftWrap`'s doc comment). If the two
 * ever disagreed, the rumor's self-claim would silently diverge from the
 * authenticated seal identity on this security-critical send path. Enforce
 * agreement up front rather than assume it: a caller passing a mismatched
 * pair is a bug, and this throws loudly instead of silently ignoring the
 * declared pubkey.
 */
export async function sendJoinRequest(params: {
  requesterPubkeyHex: string;
  adminPubkeyHex: string;
  nonce: string;
  groupName: string;
  requesterPrivateKeyHex: string;
  requesterName?: string;
}): Promise<void> {
  const derivedPubkeyHex = getPublicKey(hexToBytes(params.requesterPrivateKeyHex));
  if (derivedPubkeyHex !== params.requesterPubkeyHex) {
    throw new Error(
      'sendJoinRequest: requesterPubkeyHex does not match the pubkey derived from requesterPrivateKeyHex',
    );
  }

  const rumor = buildJoinRequestRumor({
    requesterPubkeyHex: params.requesterPubkeyHex,
    adminPubkeyHex: params.adminPubkeyHex,
    nonce: params.nonce,
    groupName: params.groupName,
    requesterName: params.requesterName,
  });

  const giftWrap = await buildGiftWrap(rumor, params.requesterPrivateKeyHex, params.adminPubkeyHex);

  // Publish to default relays via raw WebSocket (same pattern as NdkNetworkAdapter)
  const relays = [...DEFAULT_RELAYS];
  const results = await Promise.all(relays.map((relay) => rawPublish(relay, giftWrap)));
  const accepted = results.filter((r) => r.ok);
  if (accepted.length === 0) {
    const reasons = results.map((r) => `${r.from}: ${r.message ?? 'rejected'}`).join('; ');
    throw new Error(`All relays rejected the join request: ${reasons}`);
  }

  // AC-AUTO-1: persist an outbound record ONLY on a successful send (at least
  // one relay accepted, per the throw above). A failed send (thrown above)
  // never reaches this line, so no record is written for it. Correlated by
  // welcomeSubscription.ts's auto-accept against adminPubkeyHex — see
  // outboundJoinRequests.ts.
  await saveOutboundJoinRequest({
    nonce: params.nonce,
    adminPubkeyHex: params.adminPubkeyHex,
    groupName: params.groupName,
    sentAt: Date.now(),
  });
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
