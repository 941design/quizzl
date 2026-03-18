/**
 * MarmotContext — wraps marmot-ts MarmotClient behind a stable adapter interface.
 *
 * Provides group CRUD operations, member score management, and score sync.
 * All marmot-ts calls are wrapped in try/catch — it's alpha software.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Group, MemberScore, ScoreUpdate } from '@/src/types';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import {
  loadAllGroups,
  saveGroup as persistGroup,
  deleteGroup as removeGroupFromStorage,
  loadMemberScores,
  mergeMemberScore,
  clearMemberScores,
  IdbGroupStateBackend,
  IdbKeyPackageBackend,
  clearAllGroupData,
} from '@/src/lib/marmot/groupStorage';
import type { WelcomeReceivedCallback } from '@/src/lib/marmot/welcomeSubscription';
import { serialiseScoreUpdate, nextSequenceNumber, parseScorePayload } from '@/src/lib/marmot/scoreSync';

async function startWelcomeSubscription(
  pubkeyHex: string,
  marmotClient: MarmotClientType,
  ndk: import('@nostr-dev-kit/ndk').default,
  onGroupJoined: WelcomeReceivedCallback
): Promise<void> {
  const { subscribeToWelcomes } = await import('@/src/lib/marmot/welcomeSubscription');
  await subscribeToWelcomes(pubkeyHex, marmotClient, ndk, onGroupJoined);
}
import { DEFAULT_RELAYS } from '@/src/types';

// We import marmot types lazily to avoid SSR issues
type MarmotClientType = import('@internet-privacy/marmot-ts').MarmotClient;
type MarmotGroupType = import('@internet-privacy/marmot-ts').MarmotGroup;

type MarmotContextValue = {
  /** Whether marmot client has been initialized */
  ready: boolean;
  /** All groups the user belongs to */
  groups: Group[];
  /** Get member scores for a given group */
  getMemberScores: (groupId: string) => Promise<MemberScore[]>;
  /** Create a new group */
  createGroup: (name: string) => Promise<Group | null>;
  /** Invite a user by npub to a group */
  inviteByNpub: (groupId: string, npub: string) => Promise<{ ok: boolean; error?: string }>;
  /** Leave a group */
  leaveGroup: (groupId: string) => Promise<boolean>;
  /** Publish a ScoreUpdate to all groups */
  publishScoreUpdate: (update: Omit<ScoreUpdate, 'sequenceNumber'>) => Promise<void>;
  /** Handle incoming score application message */
  onIncomingScore: (groupId: string, pubkeyHex: string, nickname: string, update: ScoreUpdate) => Promise<void>;
  /** Reload groups from storage */
  reloadGroups: () => Promise<void>;
  /** Clear all group data (for reset) */
  clearAll: () => Promise<void>;
  /** Access to the underlying MarmotClient (for advanced use) */
  getClient: () => MarmotClientType | null;
};

const MarmotContext = createContext<MarmotContextValue | null>(null);

export function MarmotProvider({ children }: { children: React.ReactNode }) {
  const { privateKeyHex, pubkeyHex, hydrated: identityHydrated } = useNostrIdentity();
  const [ready, setReady] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const clientRef = useRef<MarmotClientType | null>(null);
  // Track group message subscription cleanup functions keyed by groupId
  const groupSubsRef = useRef<Map<string, () => void>>(new Map());

  // Load groups from storage on mount
  const reloadGroups = useCallback(async () => {
    const loaded = await loadAllGroups();
    setGroups(loaded);
  }, []);

  // Initialize MarmotClient once identity is ready
  useEffect(() => {
    if (!identityHydrated || !privateKeyHex || !pubkeyHex) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;

    async function init() {
      try {
        const { MarmotClient, KeyPackageStore, KeyValueGroupStateBackend } =
          await import('@internet-privacy/marmot-ts');
        const { connectNdk } = await import('@/src/lib/ndkClient');
        const { NdkNetworkAdapter } = await import('@/src/lib/marmot/NdkNetworkAdapter');
        const { createPrivateKeySigner } = await import('@/src/lib/marmot/signerAdapter');
        const { publishKeyPackages } = await import('@/src/lib/keyPackages');

        const ndk = await connectNdk(privateKeyHex!);
        const signer = createPrivateKeySigner(privateKeyHex!);

        const groupStateBackend = new KeyValueGroupStateBackend(new IdbGroupStateBackend());
        const keyPackageBackend = new IdbKeyPackageBackend();
        const keyPkgStore = new KeyPackageStore(keyPackageBackend);
        const network = new NdkNetworkAdapter(ndk);

        const client = new MarmotClient({
          signer,
          groupStateBackend,
          keyPackageStore: keyPkgStore,
          network,
        });

        if (cancelled) return;
        clientRef.current = client;

        // Load existing groups from MLS state store
        try {
          await client.loadAllGroups();
        } catch (err) {
          console.warn('[Marmot] loadAllGroups failed:', err);
        }

        // Publish KeyPackages if none exist
        try {
          const count = await keyPkgStore.count();
          if (count === 0) {
            await publishKeyPackages(client.keyPackages, 5, [...DEFAULT_RELAYS]);
          }
        } catch (err) {
          console.warn('[Marmot] KeyPackage publish failed:', err);
        }

        // Load group metadata from our overlay store
        await reloadGroups();

        // Start Welcome subscription (listen for incoming invitations)
        void startWelcomeSubscription(
          pubkeyHex!,
          client,
          ndk,
          (joinedGroup) => {
            // A new group was joined from a Welcome — reload groups
            void reloadGroups();
            console.info('[Marmot] Joined group from Welcome:', joinedGroup.name);
          }
        );

        setReady(true);
      } catch (err) {
        console.error('[Marmot] Initialization failed:', err);
        // Still mark ready so UI doesn't hang
        setReady(true);
      }
    }

    void init();
    return () => { cancelled = true; };
  }, [identityHydrated, privateKeyHex, pubkeyHex, reloadGroups]);

  // Subscribe to group messages for each group (for incoming score updates)
  useEffect(() => {
    if (!ready || groups.length === 0) return;
    const client = clientRef.current;
    if (!client || typeof window === 'undefined') return;

    const subsMap = groupSubsRef.current;

    async function subscribeNewGroups() {
      const { subscribeToGroupMessages } = await import('@/src/lib/marmot/welcomeSubscription');
      const { getNdk } = await import('@/src/lib/ndkClient');
      const ndk = getNdk();
      if (!ndk) return;

      for (const group of groups) {
        if (subsMap.has(group.id)) continue; // Already subscribed
        try {
          const mlsGroup = await client!.getGroup(group.id).catch(() => null);
          if (!mlsGroup) continue;

          const { parseScorePayload } = await import('@/src/lib/marmot/scoreSync');

          const unsub = await subscribeToGroupMessages(
            group.id,
            group.relays,
            mlsGroup,
            ndk,
            (payload, senderPubkey) => {
              const update = parseScorePayload(payload);
              if (update && senderPubkey !== pubkeyHex) {
                // Merge into local score cache (use truncated pubkey as fallback nickname)
                void mergeMemberScore(group.id, senderPubkey, senderPubkey.slice(0, 8), update).catch(
                  (err: unknown) => console.warn('[Marmot] mergeMemberScore failed:', err)
                );
              }
            }
          );
          subsMap.set(group.id, unsub);
        } catch (err) {
          console.warn(`[Marmot] subscribeToGroupMessages for ${group.id} failed:`, err);
        }
      }
    }

    void subscribeNewGroups();

    // Cleanup subscriptions for groups that no longer exist
    return () => {
      for (const [groupId, unsub] of Array.from(subsMap.entries())) {
        if (!groups.find((g) => g.id === groupId)) {
          unsub();
          subsMap.delete(groupId);
        }
      }
    };
  }, [ready, groups, pubkeyHex]);

  // Drain sync queue when coming back online
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return;

    async function drainQueue() {
      const { dequeueAll } = await import('@/src/lib/marmot/syncQueue');
      const queued = dequeueAll();
      if (queued.length === 0) return;
      console.info(`[Marmot] Draining ${queued.length} queued score updates`);
      // Re-publish each queued item (publishScoreUpdate will re-queue on failure)
      // We access the ref directly to avoid stale closure over publishScoreUpdate
      const client = clientRef.current;
      if (!client || groups.length === 0) return;
      for (const item of queued) {
        try {
          const { nextSequenceNumber: nextSeq, serialiseScoreUpdate: serialise } = await import('@/src/lib/marmot/scoreSync');
          const fullUpdate = { ...item.update, sequenceNumber: nextSeq() };
          const payload = serialise(fullUpdate);
          for (const group of groups) {
            const mlsGroup = await client.getGroup(group.id).catch(() => null);
            if (!mlsGroup) continue;
            const rumor = {
              kind: 1,
              content: payload,
              tags: [['t', 'quizzl-score']],
              created_at: Math.floor(Date.now() / 1000),
              pubkey: pubkeyHex ?? '',
              id: '',
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await mlsGroup.sendApplicationRumor(rumor as any).catch(() => {});
          }
        } catch {
          // Non-fatal — item was already dequeued
        }
      }
    }

    window.addEventListener('online', () => void drainQueue());
    return () => {
      window.removeEventListener('online', () => void drainQueue());
    };
  }, [ready, groups, pubkeyHex]);

  const getMemberScores = useCallback(async (groupId: string): Promise<MemberScore[]> => {
    return loadMemberScores(groupId);
  }, []);

  const createGroup = useCallback(async (name: string): Promise<Group | null> => {
    const client = clientRef.current;
    if (!client || !pubkeyHex) return null;

    try {
      const mlsGroup = await client.createGroup(name);
      const groupId = mlsGroup.idStr;

      const group: Group = {
        id: groupId,
        name,
        createdAt: Date.now(),
        memberPubkeys: [pubkeyHex],
        relays: [...DEFAULT_RELAYS],
      };

      await persistGroup(group);
      await reloadGroups();
      return group;
    } catch (err) {
      console.error('[Marmot] createGroup failed:', err);
      return null;
    }
  }, [pubkeyHex, reloadGroups]);

  const inviteByNpub = useCallback(
    async (groupId: string, npub: string): Promise<{ ok: boolean; error?: string }> => {
      const client = clientRef.current;
      if (!client) return { ok: false, error: 'Not initialized' };

      try {
        const { normaliseNpubPayload } = await import('@/src/lib/qr');
        const { npubToPubkeyHex } = await import('@/src/lib/nostrKeys');
        const normalisedNpub = normaliseNpubPayload(npub);
        const inviteePubkey = normalisedNpub ? npubToPubkeyHex(normalisedNpub) : null;
        if (!inviteePubkey || !normalisedNpub) {
          return { ok: false, error: 'invalid_npub' };
        }

        // Fetch the invitee's KeyPackage from relays
        const { getNdk } = await import('@/src/lib/ndkClient');
        const ndk = getNdk();
        if (!ndk) return { ok: false, error: 'offline' };

        const kpEvents = await ndk.fetchEvents(
          // 443 is Marmot KeyPackage kind — cast to NDKKind
          { kinds: [443 as import('@nostr-dev-kit/ndk').NDKKind], authors: [inviteePubkey], limit: 5 },
          {},
          undefined
        );

        const kpArray = Array.from(kpEvents);
        if (kpArray.length === 0) {
          return { ok: false, error: 'no_key_package' };
        }

        const mlsGroup = await client.getGroup(groupId);
        if (!mlsGroup) return { ok: false, error: 'group_not_found' };

        // Use the most recent KeyPackage event
        const kpEvent = kpArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
        const nostrEvent = {
          id: kpEvent.id ?? '',
          pubkey: kpEvent.pubkey ?? '',
          created_at: kpEvent.created_at ?? 0,
          kind: kpEvent.kind ?? 0,
          tags: kpEvent.tags ?? [],
          content: kpEvent.content ?? '',
          sig: kpEvent.sig ?? '',
        };

        await mlsGroup.inviteByKeyPackageEvent(nostrEvent);

        // Update our overlay group metadata with new member
        const stored = groups.find((g) => g.id === groupId);
        if (stored && !stored.memberPubkeys.includes(inviteePubkey)) {
          const updated: Group = {
            ...stored,
            memberPubkeys: [...stored.memberPubkeys, inviteePubkey],
          };
          await persistGroup(updated);
          await reloadGroups();
        }

        return { ok: true };
      } catch (err) {
        console.error('[Marmot] inviteByNpub failed:', err);
        return { ok: false, error: 'generic' };
      }
    },
    [groups, reloadGroups]
  );

  const leaveGroup = useCallback(async (groupId: string): Promise<boolean> => {
    const client = clientRef.current;
    try {
      if (client) {
        const mlsGroup = await client.getGroup(groupId).catch(() => null);
        if (mlsGroup) {
          await mlsGroup.leave().catch((err) => {
            console.warn('[Marmot] leave() failed:', err);
          });
        }
      }
    } catch (err) {
      console.warn('[Marmot] leaveGroup MLS op failed:', err);
    }

    // Always remove from local storage
    await removeGroupFromStorage(groupId);
    await clearMemberScores(groupId);
    await reloadGroups();
    return true;
  }, [reloadGroups]);

  const publishScoreUpdate = useCallback(
    async (update: Omit<ScoreUpdate, 'sequenceNumber'>): Promise<void> => {
      const client = clientRef.current;
      if (!client || groups.length === 0) {
        // Queue for later if offline or not yet ready
        const { enqueue } = await import('@/src/lib/marmot/syncQueue');
        enqueue(update);
        return;
      }

      const fullUpdate: ScoreUpdate = { ...update, sequenceNumber: nextSequenceNumber() };
      const payload = serialiseScoreUpdate(fullUpdate);

      let anyFailed = false;

      // Publish to all groups (fire and forget)
      for (const group of groups) {
        try {
          const mlsGroup = await client.getGroup(group.id).catch(() => null);
          if (!mlsGroup) continue;

          // Build a Rumor (UnsignedEvent with id field) for the application message
          const rumor = {
            kind: 1,
            content: payload,
            tags: [['t', 'quizzl-score']],
            created_at: Math.floor(Date.now() / 1000),
            pubkey: pubkeyHex ?? '',
            id: '',  // marmot-ts will compute or ignore this for application messages
          };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await mlsGroup.sendApplicationRumor(rumor as any);
        } catch (err) {
          console.warn(`[Marmot] publishScoreUpdate to group ${group.id} failed:`, err);
          anyFailed = true;
        }
      }

      // Queue the update for retry if any group publish failed
      if (anyFailed) {
        const { enqueue } = await import('@/src/lib/marmot/syncQueue');
        enqueue(update);
      }
    },
    [groups, pubkeyHex]
  );

  const onIncomingScore = useCallback(
    async (
      groupId: string,
      pubkeyHex: string,
      nickname: string,
      update: ScoreUpdate
    ): Promise<void> => {
      await mergeMemberScore(groupId, pubkeyHex, nickname, update);
    },
    []
  );

  const clearAll = useCallback(async () => {
    await clearAllGroupData();
    setGroups([]);
    clientRef.current = null;
  }, []);

  const getClient = useCallback((): MarmotClientType | null => {
    return clientRef.current;
  }, []);

  const value = useMemo<MarmotContextValue>(
    () => ({
      ready,
      groups,
      getMemberScores,
      createGroup,
      inviteByNpub,
      leaveGroup,
      publishScoreUpdate,
      onIncomingScore,
      reloadGroups,
      clearAll,
      getClient,
    }),
    [
      ready,
      groups,
      getMemberScores,
      createGroup,
      inviteByNpub,
      leaveGroup,
      publishScoreUpdate,
      onIncomingScore,
      reloadGroups,
      clearAll,
      getClient,
    ]
  );

  return <MarmotContext.Provider value={value}>{children}</MarmotContext.Provider>;
}

const NOOP_ASYNC = async () => {};
const NOOP_BOOL = async () => false;
const NOOP_NULL = async () => null;
const NOOP_ARRAY = async () => [];

const DEFAULT_MARMOT: MarmotContextValue = {
  ready: false,
  groups: [],
  getMemberScores: NOOP_ARRAY as () => Promise<MemberScore[]>,
  createGroup: NOOP_NULL as () => Promise<null>,
  inviteByNpub: async () => ({ ok: false, error: 'not_ready' }),
  leaveGroup: NOOP_BOOL,
  publishScoreUpdate: NOOP_ASYNC,
  onIncomingScore: NOOP_ASYNC,
  reloadGroups: NOOP_ASYNC,
  clearAll: NOOP_ASYNC,
  getClient: () => null,
};

export function useMarmot(): MarmotContextValue {
  const context = useContext(MarmotContext);
  // Return safe defaults when called outside provider (e.g., during dynamic load)
  return context ?? DEFAULT_MARMOT;
}
