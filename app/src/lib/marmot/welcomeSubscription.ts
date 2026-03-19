/**
 * Welcome subscription — subscribes to kind 1059 (NIP-59 gift-wrapped Welcome messages)
 * addressed to the local user's pubkey.
 *
 * On receiving a gift wrap, unwraps the NIP-59 envelope to extract the inner kind 444
 * Welcome rumor, then passes it to MarmotClient.joinGroupFromWelcome().
 * On success, persists the group to overlay storage and notifies the caller.
 */

import type { Group } from '@/src/types';
import { DEFAULT_RELAYS, STORAGE_KEYS } from '@/src/types';
import { saveGroup } from './groupStorage';
import type { EventSigner } from 'applesauce-core';
import { getGroupMembers } from '@internet-privacy/marmot-ts';

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

  // Track successfully processed gift wrap IDs in localStorage so that
  // Welcome events are not re-processed on page reload. Without this guard,
  // joinGroupFromWelcome would run again for the same Welcome (still on the
  // relay), overwriting the MLS state back to the Welcome epoch and making
  // any commits ingested since then (e.g. "add member C") undecryptable.
  const SEEN_KEY = STORAGE_KEYS.processedGiftWraps;

  sub.on('event', async (ndkEvent) => {
    const eventId = ndkEvent.id ?? '';
    if (!eventId) return;

    // Skip gift wraps already processed in this or a previous page session
    try {
      const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[];
      if (seen.includes(eventId)) return;
    } catch { /* ignore parse errors */ }

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

      // Mark as successfully processed BEFORE saving overlay data.
      // This prevents re-processing even if the page navigates away before
      // saveGroup completes — a re-join would overwrite MLS state.
      try {
        const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[];
        seen.push(eventId);
        localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
      } catch { /* ignore */ }

      // Build our overlay Group metadata
      const groupData = mlsGroup.groupData;
      const groupName = groupData?.name ?? 'Unnamed Group';
      const groupRelays = mlsGroup.relays ?? [...DEFAULT_RELAYS];

      const group: Group = {
        id: mlsGroup.idStr,
        name: groupName,
        createdAt: Date.now(),
        memberPubkeys: getGroupMembers(mlsGroup.state),
        relays: groupRelays,
      };

      await saveGroup(group);

      // NOTE: selfUpdate and sendApplicationRumor are intentionally NOT done
      // here. They advance the local MLS epoch, causing subsequent commits
      // from other members to become undecryptable.

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
  onApplicationMessage: (payload: string, senderPubkey: string) => void,
  onMembersChanged?: (members: string[]) => void,
  onHistorySynced?: () => void,
): Promise<() => void> {
  // marmot-ts tags kind 445 events with #h using the Nostr group ID
  // (MarmotGroupData.nostrGroupId), NOT the MLS group context ID (idStr).
  const nostrGroupIdBytes = mlsGroup.groupData?.nostrGroupId;
  const nostrGroupIdHex = nostrGroupIdBytes
    ? Array.from(nostrGroupIdBytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    : groupId; // fallback

  const filter = {
    kinds: [445 as import('@nostr-dev-kit/ndk').NDKKind],
    '#h': [nostrGroupIdHex],
  };

  // Track processed event IDs to avoid double-processing between fetch and subscription
  const processedIds = new Set<string>();

  async function ingestNdkEvent(ndkEvent: import('@nostr-dev-kit/ndk').NDKEvent) {
    const eventId = ndkEvent.id ?? '';
    if (!eventId || processedIds.has(eventId)) return;
    processedIds.add(eventId);

    try {
      const nostrEvent = {
        id: eventId,
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
          const appMsg = result.result.message;
          if (appMsg) {
            const rawText = new TextDecoder().decode(appMsg);
            // sendApplicationRumor wraps the payload in a Nostr rumor:
            //   {"kind":1,"content":"<actual payload>","pubkey":"<real sender>",...}
            // The kind 445 event pubkey may be ephemeral (MLS protocol key),
            // so extract the real sender pubkey and content from the rumor.
            let content = rawText;
            let senderPubkey = nostrEvent.pubkey;
            try {
              const rumor = JSON.parse(rawText) as { content?: string; pubkey?: string };
              if (typeof rumor.content === 'string') content = rumor.content;
              if (typeof rumor.pubkey === 'string' && rumor.pubkey) senderPubkey = rumor.pubkey;
            } catch { /* not a rumor wrapper — use raw text */ }
            onApplicationMessage(content, senderPubkey);
          }
        }
      }

      // After ingesting any event (commit, proposal, application message),
      // check if the member list changed. This handles the case where a
      // commit adding a new member is ingested — the MLS state is updated
      // but no applicationMessage callback fires.
      if (onMembersChanged) {
        const currentMembers = getGroupMembers(mlsGroup.state);
        onMembersChanged(currentMembers);
      }
    } catch (err) {
      console.debug('[welcomeSubscription] Could not ingest group message:', err);
    }
  }

  // Fetch and ingest all existing kind 445 events (historical sync).
  // This ensures commits published before subscription started are processed.
  let historicalCount = 0;
  let historicalIngested = 0;
  try {
    const { fetchEventsWithTimeout } = await import('@/src/lib/ndkClient');
    const existingEvents = await fetchEventsWithTimeout(ndk, filter);
    // Sort by created_at to process in chronological order
    const sorted = Array.from(existingEvents).sort(
      (a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)
    );
    historicalCount = sorted.length;
    for (const ev of sorted) {
      const before = processedIds.size;
      await ingestNdkEvent(ev);
      if (processedIds.size > before) historicalIngested++;
    }
  } catch (err) {
    console.debug('[welcomeSubscription] Historical fetch failed:', err);
  }
  console.info(`[welcomeSubscription] Historical sync: ${historicalIngested}/${historicalCount} events ingested for group ${groupId.slice(0, 16)}`);

  // Historical events have been ingested — local epoch is now up-to-date.
  // Safe to publish profile or other application messages without diverging.
  if (onHistorySynced) {
    try {
      onHistorySynced();
    } catch (err) {
      console.debug('[welcomeSubscription] onHistorySynced callback failed:', err);
    }
  }

  // NOTE: selfUpdate is intentionally NOT called here — it advances the
  // local MLS epoch, creating a divergent branch. sendApplicationRumor
  // (for profile publish) is safe after historical sync because the local
  // epoch is up-to-date. The onHistorySynced callback handles this.

  // Live subscription for future events
  const sub = ndk.subscribe(filter, { closeOnEose: false });
  sub.on('event', (ndkEvent) => void ingestNdkEvent(ndkEvent));

  return () => {
    sub.stop();
  };
}
