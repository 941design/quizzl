/**
 * Adapts a raw private key hex string to an applesauce-core EventSigner
 * interface, which is what MarmotClient expects.
 *
 * We implement this using nostr-tools schnorr signing directly, avoiding
 * the NDKPrivateKeySigner interface mismatch.
 */

import type { EventSigner } from 'applesauce-core';

export function createPrivateKeySigner(privateKeyHex: string): EventSigner {
  let _pubkeyHex: string | null = null;

  return {
    getPublicKey: async (): Promise<string> => {
      if (!_pubkeyHex) {
        const { getPublicKey } = await import('nostr-tools/pure');
        const privBytes = hexToBytes(privateKeyHex);
        _pubkeyHex = getPublicKey(privBytes);
      }
      return _pubkeyHex;
    },

    signEvent: async (draft) => {
      const { finalizeEvent } = await import('nostr-tools/pure');
      const privBytes = hexToBytes(privateKeyHex);

      // finalizeEvent expects: { kind, created_at, tags, content } and adds id, pubkey, sig
      const signed = finalizeEvent(
        {
          kind: draft.kind ?? 1,
          created_at: draft.created_at ?? Math.floor(Date.now() / 1000),
          tags: draft.tags ?? [],
          content: draft.content ?? '',
        },
        privBytes
      );

      return signed;
    },
  };
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}
