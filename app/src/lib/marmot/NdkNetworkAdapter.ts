/**
 * NdkNetworkAdapter — implements NostrNetworkInterface using NDK.
 *
 * This adapter bridges the marmot-ts network interface with the NDK relay pool.
 * It handles event publishing, single requests (fetch), and subscriptions.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
import type {
  NostrNetworkInterface,
  PublishResponse,
  Subscribable,
  Observer,
  Unsubscribable,
} from '@internet-privacy/marmot-ts';
import type { NostrEvent } from 'applesauce-core/helpers/event';
import type { Filter } from 'applesauce-core/helpers/filter';

// applesauce Filter -> NDK Filter shape is compatible, cast directly
function toNdkFilter(filter: Filter | Filter[]): NDKFilter {
  // NDK accepts a single filter object; merge array into one if needed
  if (Array.isArray(filter)) {
    return Object.assign({}, ...filter) as NDKFilter;
  }
  return filter as unknown as NDKFilter;
}

function toNostrEvent(ndkEvent: NDKEvent): NostrEvent {
  return {
    id: ndkEvent.id ?? '',
    pubkey: ndkEvent.pubkey ?? '',
    created_at: ndkEvent.created_at ?? 0,
    kind: ndkEvent.kind ?? 0,
    tags: ndkEvent.tags ?? [],
    content: ndkEvent.content ?? '',
    sig: ndkEvent.sig ?? '',
  };
}

export class NdkNetworkAdapter implements NostrNetworkInterface {
  constructor(private readonly ndk: NDK) {}

  async publish(
    relays: string[],
    event: NostrEvent
  ): Promise<Record<string, PublishResponse>> {
    const ndkEvent = new NDKEvent(this.ndk, {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    });

    const result: Record<string, PublishResponse> = {};

    try {
      const relaySet = await import('@nostr-dev-kit/ndk').then(({ NDKRelaySet }) =>
        NDKRelaySet.fromRelayUrls(relays, this.ndk)
      );
      const publishResult = await ndkEvent.publishReplaceable
        ? ndkEvent.publishReplaceable(relaySet)
        : ndkEvent.publish(relaySet);

      // NDK publish returns a Set of NDKRelays
      if (publishResult instanceof Set) {
        const publishedRelayUrls = Array.from(publishResult).map((r: { url: string }) => r.url);
        for (const relay of relays) {
          const succeeded = publishedRelayUrls.some(
            (url) => url === relay || url === relay.replace(/\/$/, '')
          );
          result[relay] = { from: relay, ok: succeeded };
        }
      } else {
        for (const relay of relays) {
          result[relay] = { from: relay, ok: true };
        }
      }
    } catch (err) {
      for (const relay of relays) {
        result[relay] = {
          from: relay,
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return result;
  }

  async request(
    relays: string[],
    filters: Filter | Filter[]
  ): Promise<NostrEvent[]> {
    const ndkFilter = toNdkFilter(filters);
    const events = await this.ndk.fetchEvents(ndkFilter, {}, undefined);
    return Array.from(events).map(toNostrEvent);
  }

  subscription(
    relays: string[],
    filters: Filter | Filter[]
  ): Subscribable<NostrEvent> {
    const ndkFilter = toNdkFilter(filters);

    return {
      subscribe: (observer: Partial<Observer<NostrEvent>>): Unsubscribable => {
        const sub: NDKSubscription = this.ndk.subscribe(ndkFilter, {
          closeOnEose: false,
        });

        sub.on('event', (ndkEvent: NDKEvent) => {
          observer.next?.(toNostrEvent(ndkEvent));
        });

        sub.on('eose', () => {
          // Don't complete — we want to keep listening
        });

        return {
          unsubscribe: () => {
            sub.stop();
          },
        };
      },
    };
  }

  async getUserInboxRelays(pubkey: string): Promise<string[]> {
    // Fetch kind 10051 (relay list for KeyPackage discovery)
    try {
      const events = await this.ndk.fetchEvents(
        // 10051 is the KeyPackage relay list kind — cast to NDKKind
        { kinds: [10051 as import('@nostr-dev-kit/ndk').NDKKind], authors: [pubkey], limit: 1 },
        {},
        undefined
      );
      const event = Array.from(events)[0];
      if (!event) return [];

      return event.tags
        .filter((t) => t[0] === 'relay' && typeof t[1] === 'string')
        .map((t) => t[1]);
    } catch {
      return [];
    }
  }
}
