/**
 * Welcome subscription — subscribes to kind 1059 (NIP-59 gift-wrapped Welcome messages)
 * addressed to the local user's pubkey.
 *
 * On receiving a gift wrap, unwraps the NIP-59 envelope to extract the inner kind 444
 * Welcome rumor, then passes it to MarmotClient.joinGroupFromWelcome().
 * On success, persists the group to overlay storage and notifies the caller.
 *
 * Also handles kind 21059 (join request) rumors after unwrapping — dispatches to
 * the join request handler for nonce validation, dedup, and persistence.
 */

import type { Group } from '@/src/types';
import { DEFAULT_RELAYS, STORAGE_KEYS } from '@/src/types';
import { saveGroup } from './groupStorage';
import type { EventSigner } from 'applesauce-core';
import { getGroupMembers } from '@internet-privacy/marmot-ts';
import { EpochResolver } from './epochResolver';
import { handleJoinRequest, JOIN_REQUEST_KIND } from './joinRequestHandler';
import type { JoinRequestReceivedCallback } from './joinRequestHandler';
import {
  enqueuePendingInvitation,
  removePendingInvitation,
  countPendingInvitations,
  listPendingInvitations,
} from '@/src/lib/pendingInvitations';
import type { PendingInvitation } from '@/src/lib/pendingInvitations';
import { handlePairingAck } from '@/src/lib/pairing/pairingAck';
import { createLogger } from '@/src/lib/logger';

const logger = createLogger('welcomeSubscription');

export type WelcomeReceivedCallback = (group: Group) => void | Promise<void>;

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
  onGroupJoined: WelcomeReceivedCallback,
  onJoinRequestReceived?: JoinRequestReceivedCallback,
  groupMemberPubkeys?: (groupId: string) => string[],
  ownPrivateKeyHex?: string,
  onPairingAckReceived?: (result: { senderPubkeyHex: string }) => void,
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

    // Pairing-ack dispatch (S3, additive). Uses directMessages.ts's STRICT
    // unwrapAndOpen internally (AC-SEC-2) — a completely separate unwrap
    // path from unwrapGiftWrap below. Only attempted when the caller passed
    // an ownPrivateKeyHex; existing call sites that omit the new trailing
    // params are unaffected. Any error here is swallowed and falls through
    // to the existing Welcome/join-request path unchanged, so a pairing-ack
    // processing bug can never break the pre-existing flow.
    if (ownPrivateKeyHex) {
      try {
        const pairingResult = await handlePairingAck(
          {
            id: ndkEvent.id,
            pubkey: ndkEvent.pubkey ?? '',
            content: ndkEvent.content ?? '',
            created_at: ndkEvent.created_at,
            kind: ndkEvent.kind,
            tags: ndkEvent.tags,
          },
          ownPrivateKeyHex,
        );
        if (pairingResult.status !== 'unwrap-failed' && pairingResult.status !== 'wrong-kind') {
          // This WAS a pairing-ack (of some outcome) — mark processed and
          // stop here; it must never fall through to unwrapGiftWrap/Welcome
          // dispatch below.
          try {
            const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[];
            if (!seen.includes(eventId)) {
              seen.push(eventId);
              localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
            }
          } catch { /* ignore */ }
          if (pairingResult.status === 'admitted' || pairingResult.status === 'already-admitted') {
            onPairingAckReceived?.({ senderPubkeyHex: pairingResult.senderPubkeyHex });
          }
          return;
        }
        // 'unwrap-failed' or 'wrong-kind' — might still be a real Welcome/
        // join-request; fall through to the existing dispatch below.
      } catch (err) {
        console.debug('[welcomeSubscription] pairing-ack dispatch failed, falling through:', err);
      }
    }

    try {
      // Unwrap NIP-59: gift wrap → seal → rumor (kind 444)
      const welcomeRumor = await unwrapGiftWrap(
        { pubkey: ndkEvent.pubkey ?? '', content: ndkEvent.content ?? '' },
        signer,
      );

      // Dispatch kind 21059 join requests to the handler
      if (welcomeRumor.kind === JOIN_REQUEST_KIND) {
        if (onJoinRequestReceived && groupMemberPubkeys) {
          const request = await handleJoinRequest(
            welcomeRumor,
            eventId,
            groupMemberPubkeys,
          );
          if (request) {
            // Mark as processed so we don't re-handle on reload
            try {
              const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[];
              seen.push(eventId);
              localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
            } catch { /* ignore */ }
            onJoinRequestReceived(request);
          }
        }
        return;
      }

      if (welcomeRumor.kind !== 444) {
        console.debug('[welcomeSubscription] Unwrapped event is not kind 444, got:', welcomeRumor.kind);
        return;
      }

      // AC-INVITE-1: DO NOT call joinGroupFromWelcome here. Instead, enqueue the
      // invitation so the user can explicitly accept or decline it (S2).
      //
      // The seal pubkey is the sender's real key (proven authorship after NIP-59
      // decryption). We need it now because the two-layer decryption in
      // unwrapGiftWrap reads the seal pubkey internally — re-derive it from the
      // gift wrap event so we don't have to re-parse the seal after the fact.
      // The unwrapGiftWrap function returns the rumor (inner layer); the seal
      // pubkey is not directly returned. We obtain it by re-reading from the
      // gift wrap. The NIP-59 convention is:
      //   gift wrap pubkey = ephemeral  (already consumed by decrypt)
      //   seal pubkey = real sender     (ndkEvent.pubkey is the gift wrap pubkey,
      //                                  NOT the seal — we need to store the seal
      //                                  pubkey which is in the rumor's pubkey field
      //                                  since the rumor is authored by the sender).
      // The rumor's own pubkey IS the inviter's real key (the sender signed it).
      const inviterPubkeyHex = welcomeRumor.pubkey || '';

      const invitation: PendingInvitation = {
        id: welcomeRumor.id || eventId,
        inviterPubkeyHex,
        receivedAt: Date.now(),
        welcomeEventJson: JSON.stringify(welcomeRumor),
      };

      enqueuePendingInvitation(invitation);

      // Mark the gift wrap eventId as processed NOW so that relay resends and
      // page-reload re-subscriptions don't re-enqueue the same Welcome. The
      // invitation remains in the pending queue for the user to accept/decline.
      // On accept, the eventId will be re-added (idempotent).
      try {
        const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[];
        if (!seen.includes(eventId)) {
          seen.push(eventId);
          localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
        }
      } catch { /* ignore */ }

      logger.info('dm:walled-garden-invite-pending', {
        inviter: inviterPubkeyHex.slice(0, 8),
        queueSize: countPendingInvitations(),
      });
    } catch (err) {
      // Expected: not every kind 1059 is a Welcome for us. The p-tag filter
      // matches any gift wrap addressed to us (e.g. DMs). Decryption will fail
      // for non-Welcome content — that's fine (AC-INVITE-2: invalid Welcomes
      // are dropped silently here).
      console.debug('[welcomeSubscription] Could not process gift wrap event:', err);
    }
  });

  return () => {
    sub.stop();
  };
}

// Module-level, per-group seen-id dedup. Each subscribeToGroupMessages call used
// to start with a FRESH local Set, so when two instances overlap (a rapid
// re-subscribe on groups state change before the old instance's teardown runs)
// the same kind-445 event id could be ingested by both. Sharing the set per
// group makes dedup cross-instance. Bounded LRU (insertion-ordered Set, evict
// oldest past the cap), mirroring applicationRumorDispatcher. Deliberately NEVER
// cleared on unsubscribe — a fresh instance must see the prior instance's
// processed ids. Re-adding a seen id is a harmless no-op, and an evicted-then-
// reseen id costs at most a redundant resolver.ingestEvent, which mlsGroup.ingest
// already treats idempotently by MLS epoch ordering.
const GROUP_SEEN_IDS_CAP = 1000;
const seenIdsByGroup = new Map<string, Set<string>>();

function getGroupSeenIds(groupKey: string): Set<string> {
  let set = seenIdsByGroup.get(groupKey);
  if (!set) {
    set = new Set<string>();
    seenIdsByGroup.set(groupKey, set);
  }
  return set;
}

function markGroupSeen(set: Set<string>, id: string): void {
  set.add(id);
  if (set.size > GROUP_SEEN_IDS_CAP) {
    const evictCount = set.size - GROUP_SEEN_IDS_CAP;
    const iter = set.values();
    for (let i = 0; i < evictCount; i++) {
      const oldest = iter.next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
  }
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

  // Track processed event IDs to avoid double-processing between fetch and the
  // live subscription, AND across overlapping subscription instances for the same
  // group (shared module-level set keyed by groupId — see getGroupSeenIds).
  const processedIds = getGroupSeenIds(groupId);

  // EpochResolver wraps mlsGroup.ingest() with fork resolution, rollback,
  // and future-epoch buffering. Application messages are dispatched by the
  // unified dispatcher (applicationRumorDispatcher) via the MarmotGroup
  // 'applicationMessage' event; the resolver's onApplicationMessage callback
  // is a no-op here — EpochResolver still requires the field to maintain its
  // internal interface contract.
  const resolver = new EpochResolver(
    mlsGroup,
    { onMembersChanged },
  );

  // Returns true when this call newly ingested the event (i.e. it was not a
  // duplicate). Used by the historical-sync loop to count net-new ingests
  // accurately even though processedIds is now shared across instances.
  async function ingestNdkEvent(ndkEvent: import('@nostr-dev-kit/ndk').NDKEvent): Promise<boolean> {
    const eventId = ndkEvent.id ?? '';
    if (!eventId || processedIds.has(eventId)) return false;
    // Mark seen BEFORE ingest so an overlapping subscription instance does not
    // double-ingest this event while it is in flight. If the resolver reports it
    // was only buffered (future-epoch/unreadable), un-mark it below.
    markGroupSeen(processedIds, eventId);

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

      const { buffered } = await resolver.ingestEvent(nostrEvent);
      if (buffered) {
        // The event could not be applied yet and sits in the resolver's
        // future-epoch buffer. If this subscription instance is torn down before
        // the enabling commit/message arrives, dispose() drops the buffer — and
        // a permanently-seen id would stop a fresh instance's historical refetch
        // from re-ingesting it, silently losing the rumor. Un-marking lets the
        // refetch retry. Re-ingesting an already-applied event is idempotent
        // (mlsGroup.ingest dedups by MLS epoch ordering), so this is safe.
        processedIds.delete(eventId);
      }
    } catch (err) {
      console.debug('[welcomeSubscription] Could not ingest group message:', err);
    }
    return true;
  }

  // Build a relay set scoped to this group's relays so that traffic and
  // group activity are not leaked to the full default relay pool.
  const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
  const relaySet = relays.length > 0
    ? NDKRelaySet.fromRelayUrls(relays, ndk)
    : undefined;

  // Anchor for the Phase-2 live sub's `since` filter. Captured BEFORE Phase-1
  // begins so the relay replays any event published between Phase-1 EOSE and
  // Phase-2 WebSocket REQ registration — without it, events landing in that
  // gap are silently dropped. `processedIds` dedups the resulting overlap.
  //
  // The `CLOCK_SKEW_MARGIN_SEC` backdate exists because relays filter `since`
  // against the event's signed `created_at`, not the relay's receipt time. 30s
  // is the chosen window because it covers (a) sub-second JS scheduling jitter
  // that produced the reported 33–60% flake, (b) modest NTP drift between
  // publisher and subscriber clocks, and (c) brief mobile sleep/resume or
  // pre-signed-event lag. `processedIds` absorbs the wider replay window at
  // zero correctness cost — every duplicate is dropped before dispatch.
  const CLOCK_SKEW_MARGIN_SEC = 30;
  const fetchStartedAt = Math.floor(Date.now() / 1000) - CLOCK_SKEW_MARGIN_SEC;

  // Fetch and ingest all existing kind 445 events (historical sync).
  // This ensures commits published before subscription started are processed.
  let historicalCount = 0;
  let historicalIngested = 0;
  let historySyncComplete = false;
  try {
    const { fetchEventsWithTimeout } = await import('@/src/lib/ndkClient');
    const { events: existingEvents, timedOut } = await fetchEventsWithTimeout(ndk, filter, {}, relaySet);
    if (timedOut) {
      console.warn(`[welcomeSubscription] Historical fetch timed out for group ${groupId.slice(0, 16)} — skipping onHistorySynced to avoid epoch divergence`);
    } else {
      historySyncComplete = true;
    }
    // Sort by created_at to process in chronological order
    const sorted = Array.from(existingEvents).sort(
      (a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)
    );
    historicalCount = sorted.length;
    for (const ev of sorted) {
      if (await ingestNdkEvent(ev)) historicalIngested++;
    }
  } catch (err) {
    console.debug('[welcomeSubscription] Historical fetch failed:', err);
  }
  console.info(`[welcomeSubscription] Historical sync: ${historicalIngested}/${historicalCount} events ingested for group ${groupId.slice(0, 16)}${historySyncComplete ? '' : ' (incomplete)'}`);

  // Only fire onHistorySynced when we know ALL historical events were received
  // (EOSE from relays). On timeout the local epoch may lag behind — publishing
  // an application rumor now would risk the MLS epoch divergence the surrounding
  // comment warns about.
  if (onHistorySynced && historySyncComplete) {
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

  // Live subscription for future events, scoped to the group's relays.
  // `since: fetchStartedAt` closes the EOSE→REQ gap (see fetchStartedAt above).
  const liveFilter = { ...filter, since: fetchStartedAt };
  const sub = ndk.subscribe(liveFilter, { closeOnEose: false }, relaySet);
  sub.on('event', (ndkEvent) => void ingestNdkEvent(ndkEvent));

  return () => {
    resolver.dispose();
    sub.stop();
  };
}

/**
 * Accept a pending invitation: parse the stored welcomeEventJson, call
 * joinGroupFromWelcome, persist the group, and remove the entry from the queue.
 *
 * On MLS failure: removes from queue, throws a user-visible error, logs WARN.
 *
 * AC-INVITE-5, AC-OBS-3
 */
export async function acceptPendingInvitation(
  id: string,
  marmotClient: import('@internet-privacy/marmot-ts').MarmotClient,
  onGroupJoined: WelcomeReceivedCallback,
): Promise<void> {
  const list = listPendingInvitations();
  const entry = list.find((inv) => inv.id === id);
  if (!entry) {
    // Already removed (race: double-click or stale state)
    return;
  }

  let parsedWelcome: unknown;
  try {
    parsedWelcome = JSON.parse(entry.welcomeEventJson);
  } catch {
    removePendingInvitation(id);
    logger.warn('dm:walled-garden-invite-stale', { id: id.slice(0, 8), reason: 'json-parse-failed' });
    throw new Error('This invitation is no longer valid');
  }

  let joinedGroup: Group | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { group: mlsGroup } = await marmotClient.joinGroupFromWelcome({ welcomeRumor: parsedWelcome as any });

    // Build overlay Group metadata
    const groupData = mlsGroup.groupData;
    const groupName = groupData?.name ?? 'Unnamed Group';
    const groupRelays = mlsGroup.relays ?? [...DEFAULT_RELAYS];

    joinedGroup = {
      id: mlsGroup.idStr,
      name: groupName,
      createdAt: Date.now(),
      memberPubkeys: getGroupMembers(mlsGroup.state),
      relays: groupRelays,
    };

    await saveGroup(joinedGroup);
    removePendingInvitation(id);
    logger.info('dm:walled-garden-invite-accept', { id: id.slice(0, 8) });
  } catch (err) {
    // MLS failure: remove from queue so the user isn't stuck, log WARN, rethrow
    removePendingInvitation(id);
    logger.warn('dm:walled-garden-invite-stale', {
      id: id.slice(0, 8),
      reason: err instanceof Error ? err.message : 'unknown',
    });
    throw new Error('This invitation is no longer valid');
  }

  // Fire the caller's group-joined callback OUTSIDE the try-catch so that a
  // callback failure (e.g. reloadGroups IDB error) does not produce a
  // misleading "invitation invalid" error — the join already succeeded.
  if (joinedGroup) {
    try {
      await (onGroupJoined(joinedGroup) ?? Promise.resolve());
    } catch (err) {
      logger.warn('dm:walled-garden-invite-accept-callback-failed', { id: id.slice(0, 8) });
    }
  }
}

/**
 * Decline a pending invitation: remove from queue, no network call.
 *
 * AC-INVITE-6, AC-OBS-3
 */
export async function declinePendingInvitation(id: string): Promise<void> {
  removePendingInvitation(id);
  logger.info('dm:walled-garden-invite-decline', { id: id.slice(0, 8) });
}
