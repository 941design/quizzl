/**
 * Welcome subscription — subscribes to kind 1059 (NIP-59 gift-wrapped Welcome messages)
 * addressed to the local user's pubkey.
 *
 * On receiving a gift wrap, unwraps the NIP-59 envelope to extract the inner kind 444
 * Welcome rumor, then passes it to MarmotClient.joinGroupFromWelcome().
 * On success, persists the group to overlay storage and notifies the caller.
 */

import type { Group } from '@/src/types';
import { DEFAULT_RELAYS } from '@/src/types';
import { saveGroup } from './groupStorage';
import type { EventSigner } from 'applesauce-core';

export type WelcomeReceivedCallback = (group: Group) => void;

/**
 * Unwrap a NIP-59 gift wrap event to extract the inner rumor.
 *
 * Gift wrap (kind 1059) → decrypt → Seal (kind 13) → decrypt → Rumor (kind 444)
 */
export async function unwrapGiftWrap(
  giftWrapEvent: { pubkey: string; content: string },
  signer: EventSigner,
): Promise<{ id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }> {
  if (!signer.nip44?.decrypt) {
    throw new Error('Signer does not support NIP-44 decryption');
  }

  // Two-layer NIP-59 decryption. Each layer uses a different counterparty key:
  //   Layer 1: gift wrap pubkey is a random ephemeral key (prevents sender identification)
  //   Layer 2: seal pubkey is the sender's real key (proves authorship to recipient)
  // nip44.decrypt(theirPubkey, ciphertext) derives a shared secret from our
  // privkey + their pubkey, so each layer decrypts against a different shared secret.
  const sealJson = await signer.nip44.decrypt(giftWrapEvent.pubkey, giftWrapEvent.content);
  const seal = JSON.parse(sealJson);

  const rumorJson = await signer.nip44.decrypt(seal.pubkey, seal.content);
  const rumor = JSON.parse(rumorJson);

  return {
    id: rumor.id ?? '',
    pubkey: rumor.pubkey ?? '',
    created_at: rumor.created_at ?? 0,
    kind: rumor.kind ?? 0,
    tags: rumor.tags ?? [],
    content: rumor.content ?? '',
    sig: rumor.sig ?? '',
  };
}

/**
 * Start subscribing to kind 1059 events for the given pubkey.
 * Returns an unsubscribe function.
 */
export async function subscribeToWelcomes(
  pubkeyHex: string,
  marmotClient: import('@internet-privacy/marmot-ts').MarmotClient,
  ndk: import('@nostr-dev-kit/ndk').default,
  signer: EventSigner,
  onGroupJoined: WelcomeReceivedCallback
): Promise<() => void> {
  // Subscribe to kind 1059, NOT kind 444. marmot-ts wraps the kind 444 Welcome
  // rumor in a NIP-59 gift wrap (kind 1059) before publishing. The inner rumor
  // is only accessible after two layers of NIP-44 decryption (see unwrapGiftWrap).
  const sub = ndk.subscribe(
    {
      kinds: [1059 as import('@nostr-dev-kit/ndk').NDKKind],
      '#p': [pubkeyHex],
    },
    { closeOnEose: false }
  );

  sub.on('event', async (ndkEvent) => {
    try {
      // Unwrap NIP-59: gift wrap → seal → rumor (kind 444)
      const welcomeRumor = await unwrapGiftWrap(
        { pubkey: ndkEvent.pubkey ?? '', content: ndkEvent.content ?? '' },
        signer,
      );

      if (welcomeRumor.kind !== 444) {
        console.debug('[welcomeSubscription] Unwrapped event is not kind 444, got:', welcomeRumor.kind);
        return;
      }

      // Attempt to join from Welcome
      const { group: mlsGroup } = await marmotClient.joinGroupFromWelcome({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        welcomeRumor: welcomeRumor as any,
      });

      // Build our overlay Group metadata
      const groupData = mlsGroup.groupData;
      const groupName = groupData?.name ?? 'Unnamed Group';
      const groupRelays = mlsGroup.relays ?? [...DEFAULT_RELAYS];

      const group: Group = {
        id: mlsGroup.idStr,
        name: groupName,
        createdAt: Date.now(),
        memberPubkeys: [pubkeyHex], // We know we're a member; other members fetched via epoch
        relays: groupRelays,
      };

      await saveGroup(group);

      // Rotate leaf key (self-update) for forward secrecy per MIP-02
      void mlsGroup.selfUpdate().catch((err) => {
        console.warn('[welcomeSubscription] selfUpdate failed:', err);
      });

      onGroupJoined(group);
    } catch (err) {
      // Expected: not every kind 1059 is a Welcome for us. The p-tag filter
      // matches any gift wrap addressed to us (e.g. DMs). Decryption or
      // joinGroupFromWelcome will fail for non-Welcome content — that's fine.
      console.debug('[welcomeSubscription] Could not join from event:', err);
    }
  });

  return () => {
    sub.stop();
  };
}

/**
 * Subscribe to kind 445 (encrypted group messages) for a specific group.
 * Returns an unsubscribe function.
 */
export async function subscribeToGroupMessages(
  groupId: string,
  relays: string[],
  mlsGroup: import('@internet-privacy/marmot-ts').MarmotGroup,
  ndk: import('@nostr-dev-kit/ndk').default,
  onApplicationMessage: (payload: string, senderPubkey: string) => void
): Promise<() => void> {
  const sub = ndk.subscribe(
    {
      kinds: [445 as import('@nostr-dev-kit/ndk').NDKKind],
      '#e': [groupId], // Group message events reference the group id
    },
    { closeOnEose: false }
  );

  sub.on('event', async (ndkEvent) => {
    try {
      const nostrEvent = {
        id: ndkEvent.id ?? '',
        pubkey: ndkEvent.pubkey ?? '',
        created_at: ndkEvent.created_at ?? 0,
        kind: ndkEvent.kind ?? 0,
        tags: ndkEvent.tags ?? [],
        content: ndkEvent.content ?? '',
        sig: ndkEvent.sig ?? '',
      };

      const resultsGen = mlsGroup.ingest([nostrEvent]);
      for await (const result of resultsGen) {
        if (result.kind === 'processed' && result.result.kind === 'applicationMessage') {
          // Application message bytes are in result.result.message
          const appMsg = result.result.message;
          if (appMsg) {
            const text = new TextDecoder().decode(appMsg);
            onApplicationMessage(text, nostrEvent.pubkey);
          }
        }
      }
    } catch (err) {
      console.debug('[welcomeSubscription] Could not ingest group message:', err);
    }
  });

  return () => {
    sub.stop();
  };
}
