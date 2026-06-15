/**
 * Adapts a raw private key hex string to an applesauce-core EventSigner
 * interface, which is what MarmotClient expects.
 *
 * We implement this using nostr-tools schnorr signing directly, avoiding
 * the NDKPrivateKeySigner interface mismatch.
 */

import type { EventSigner } from 'applesauce-core';
import type { NDKNip46Signer, NDKNip07Signer, NDKUser } from '@nostr-dev-kit/ndk';

/**
 * Module-level ref for an externally-provided EventSigner override.
 * Set by NostrIdentityContext after a successful NIP-46 (or NIP-07) bunker
 * connection. MarmotContext reads this in its init() to use the remote signer
 * instead of createPrivateKeySigner. Avoids a circular import between
 * NostrIdentityContext and MarmotContext.
 */
export const activeEventSignerOverride: { current: EventSigner | null } = { current: null };

export function createPrivateKeySigner(privateKeyHex: string): EventSigner {
  let _pubkeyHex: string | null = null;
  const privBytes = hexToBytes(privateKeyHex);

  return {
    getPublicKey: async (): Promise<string> => {
      if (!_pubkeyHex) {
        const { getPublicKey } = await import('nostr-tools/pure');
        _pubkeyHex = getPublicKey(privBytes);
      }
      return _pubkeyHex;
    },

    signEvent: async (draft) => {
      const { finalizeEvent } = await import('nostr-tools/pure');

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

    nip44: {
      encrypt: async (pubkey: string, plaintext: string): Promise<string> => {
        const nip44 = await import('nostr-tools/nip44');
        const conversationKey = nip44.v2.utils.getConversationKey(privBytes, pubkey);
        return nip44.v2.encrypt(plaintext, conversationKey);
      },
      decrypt: async (pubkey: string, ciphertext: string): Promise<string> => {
        const nip44 = await import('nostr-tools/nip44');
        const conversationKey = nip44.v2.utils.getConversationKey(privBytes, pubkey);
        return nip44.v2.decrypt(ciphertext, conversationKey);
      },
    },
  };
}

/**
 * Adapts an NDKNip46Signer to the applesauce-core EventSigner interface.
 *
 * NDK 3.0.3 API notes (verified against dist/index.d.ts):
 * - blockUntilReady() returns Promise<NDKUser>, where user.pubkey is the hex pubkey
 * - sign(event: NostrEvent) returns Promise<string> — just the sig, NOT a full event
 * - encrypt(recipient: NDKUser, value: string, scheme?) and decrypt(sender: NDKUser, ...)
 *   take NDKUser objects, NOT hex strings
 * - rawEvent is needed to get the full NostrEvent with id/pubkey computed
 */
export function createNip46EventSigner(ndkSigner: NDKNip46Signer): EventSigner {
  return {
    async getPublicKey(): Promise<string> {
      const user: NDKUser = await ndkSigner.blockUntilReady();
      return user.pubkey;
    },

    async signEvent(draft) {
      // We need to compute the event id and pubkey before signing.
      // Use nostr-tools getEventHash to compute the event id, then send to remote.
      const { getEventHash } = await import('nostr-tools/pure');

      const pubkey = await ndkSigner.getPublicKey();
      const template = {
        kind: draft.kind ?? 1,
        created_at: draft.created_at ?? Math.floor(Date.now() / 1000),
        tags: draft.tags ?? [],
        content: draft.content ?? '',
        pubkey,
      };

      // Compute the event id using nostr-tools
      const id = getEventHash(template as Parameters<typeof getEventHash>[0]);

      const eventForSigning = { ...template, id };

      // NDKNip46Signer.sign() takes a NostrEvent and returns just the sig string
      const sig = await ndkSigner.sign(eventForSigning as import('@nostr-dev-kit/ndk').NostrEvent);

      return { ...eventForSigning, sig } as import('nostr-tools').Event;
    },

    nip44: {
      async encrypt(pubkeyHex: string, plaintext: string): Promise<string> {
        const { NDKUser } = await import('@nostr-dev-kit/ndk');
        const recipient = new NDKUser({ pubkey: pubkeyHex });
        return ndkSigner.encrypt(recipient, plaintext, 'nip44');
      },
      async decrypt(pubkeyHex: string, ciphertext: string): Promise<string> {
        const { NDKUser } = await import('@nostr-dev-kit/ndk');
        const sender = new NDKUser({ pubkey: pubkeyHex });
        return ndkSigner.decrypt(sender, ciphertext, 'nip44');
      },
    },
  };
}

/**
 * Adapts an NDKNip07Signer to the applesauce-core EventSigner interface.
 *
 * NDK 3.0.3 API notes (verified against dist/index.d.ts):
 * - blockUntilReady() returns Promise<NDKUser>, where user.pubkey is the hex pubkey
 * - sign(event: NostrEvent) returns Promise<string> — just the sig, NOT a full event
 * - encrypt(recipient: NDKUser, value: string, scheme?) and decrypt(sender: NDKUser, ...)
 *   take NDKUser objects, NOT hex strings
 *
 * The NIP-44 guard (window.nostr.nip44 check) is performed before creating this signer
 * in connectNip07(); this adapter assumes the extension supports NIP-44.
 */
export function createNip07EventSigner(ndkSigner: NDKNip07Signer): EventSigner {
  return {
    async getPublicKey(): Promise<string> {
      // blockUntilReady() resolves once the extension is ready and sets the pubkey
      const user: NDKUser = await ndkSigner.blockUntilReady();
      return user.pubkey;
    },

    async signEvent(draft) {
      // Same pattern as createNip46EventSigner: compute id with getEventHash,
      // then sign and return full event.
      const { getEventHash } = await import('nostr-tools/pure');

      // .pubkey getter is available synchronously after blockUntilReady() has been called
      const pubkey = ndkSigner.pubkey;
      const template = {
        kind: draft.kind ?? 1,
        created_at: draft.created_at ?? Math.floor(Date.now() / 1000),
        tags: draft.tags ?? [],
        content: draft.content ?? '',
        pubkey,
      };

      const id = getEventHash(template as Parameters<typeof getEventHash>[0]);
      const eventForSigning = { ...template, id };

      // NDKNip07Signer.sign() takes a NostrEvent and returns just the sig string
      const sig = await ndkSigner.sign(eventForSigning as import('@nostr-dev-kit/ndk').NostrEvent);

      return { ...eventForSigning, sig } as import('nostr-tools').Event;
    },

    nip44: {
      async encrypt(pubkeyHex: string, plaintext: string): Promise<string> {
        const { NDKUser } = await import('@nostr-dev-kit/ndk');
        const recipient = new NDKUser({ pubkey: pubkeyHex });
        return ndkSigner.encrypt(recipient, plaintext, 'nip44');
      },
      async decrypt(pubkeyHex: string, ciphertext: string): Promise<string> {
        const { NDKUser } = await import('@nostr-dev-kit/ndk');
        const sender = new NDKUser({ pubkey: pubkeyHex });
        return ndkSigner.decrypt(sender, ciphertext, 'nip44');
      },
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
