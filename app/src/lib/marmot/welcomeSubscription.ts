/**
 * Welcome subscription — subscribes to kind 444 (NIP-59 gift-wrapped Welcome messages)
 * addressed to the local user's pubkey.
 *
 * On receiving a Welcome, attempts to join the group via MarmotClient.joinGroupFromWelcome().
 * On success, persists the group to overlay storage and notifies the caller.
 */

import type { Group } from '@/src/types';
import { DEFAULT_RELAYS } from '@/src/types';
import { saveGroup } from './groupStorage';

export type WelcomeReceivedCallback = (group: Group) => void;

/**
 * Start subscribing to kind 444 events for the given pubkey.
 * Returns an unsubscribe function.
 */
export async function subscribeToWelcomes(
  pubkeyHex: string,
  marmotClient: import('@internet-privacy/marmot-ts').MarmotClient,
  ndk: import('@nostr-dev-kit/ndk').default,
  onGroupJoined: WelcomeReceivedCallback
): Promise<() => void> {
  // kind 444 = NIP-59 gift wrap — filter by the recipient's pubkey in the p-tag
  const sub = ndk.subscribe(
    {
      kinds: [444 as import('@nostr-dev-kit/ndk').NDKKind],
      '#p': [pubkeyHex],
    },
    { closeOnEose: false }
  );

  sub.on('event', async (ndkEvent) => {
    try {
      const welcomeRumor = {
        id: ndkEvent.id ?? '',
        pubkey: ndkEvent.pubkey ?? '',
        created_at: ndkEvent.created_at ?? 0,
        kind: ndkEvent.kind ?? 0,
        tags: ndkEvent.tags ?? [],
        content: ndkEvent.content ?? '',
        sig: ndkEvent.sig ?? '',
      };

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
      // Not every kind 444 is a Welcome for us — silently skip
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
