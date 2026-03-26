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
import type { Group, MemberScore, MemberProfile, ScoreUpdate, UserProfile } from '@/src/types';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import {
  loadAllGroups,
  saveGroup as persistGroup,
  deleteGroup as removeGroupFromStorage,
  loadMemberScores,
  mergeMemberScore,
  clearMemberScores,
  loadMemberProfiles,
  mergeMemberProfile,
  clearMemberProfiles,
  updateMemberScoreNickname,
  IdbGroupStateBackend,
  IdbKeyPackageBackend,
  clearAllGroupData,
} from '@/src/lib/marmot/groupStorage';
import type { WelcomeReceivedCallback } from '@/src/lib/marmot/welcomeSubscription';
import { serialiseScoreUpdate, nextSequenceNumber, parseScorePayload, SCORE_RUMOR_KIND } from '@/src/lib/marmot/scoreSync';
import { serialiseProfileUpdate, parseProfilePayload, payloadToMemberProfile, PROFILE_RUMOR_KIND } from '@/src/lib/marmot/profileSync';
import { incrementUnread, initUnreadCounts, clearUnreadGroup } from '@/src/lib/unreadStore';
import { CHAT_MESSAGE_KIND } from '@/src/lib/marmot/chatPersistence';
import { useProfile } from '@/src/context/ProfileContext';
import { useBackup } from '@/src/context/BackupContext';

async function startWelcomeSubscription(
  pubkeyHex: string,
  marmotClient: MarmotClientType,
  ndk: import('@nostr-dev-kit/ndk').default,
  signer: import('applesauce-core').EventSigner,
  onGroupJoined: WelcomeReceivedCallback
): Promise<void> {
  const { subscribeToWelcomes } = await import('@/src/lib/marmot/welcomeSubscription');
  await subscribeToWelcomes(pubkeyHex, marmotClient, ndk, signer, onGroupJoined);
}
import { DEFAULT_RELAYS } from '@/src/types';
import { getEventHash } from 'applesauce-core/helpers/event';

/** Build a properly-hashed MIP-03 rumor for sendApplicationRumor. */
function buildRumor(kind: number, content: string, pubkey: string, tags: string[][] = []) {
  const rumor = {
    id: '',
    kind,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    content,
    tags,
  };
  rumor.id = getEventHash(rumor);
  return rumor;
}

// We import marmot types lazily to avoid SSR issues
type MarmotClientType = import('@internet-privacy/marmot-ts').MarmotClient;
type MarmotGroupType = import('@internet-privacy/marmot-ts').MarmotGroup;

type MarmotContextValue = {
  /** Whether marmot client has been initialized */
  ready: boolean;
  /** True when groups are unavailable (e.g. non-HTTPS context) */
  unsupported: boolean;
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
  /** Publish profile to all groups. Pass profileOverride to avoid stale-closure race. */
  publishProfileUpdate: (profileOverride?: UserProfile) => Promise<void>;
  /** Get member profiles for a given group */
  getMemberProfiles: (groupId: string) => Promise<MemberProfile[]>;
  /** Reload groups from storage */
  reloadGroups: () => Promise<void>;
  /** Clear all group data (for reset) */
  clearAll: () => Promise<void>;
  /** Get a MarmotGroup by ID (for chat, etc.) */
  getGroup: (groupId: string) => Promise<MarmotGroupType | null>;
  /** Access to the underlying MarmotClient (for advanced use) */
  getClient: () => MarmotClientType | null;
  /** Monotonically increasing counter bumped on each received profile message */
  profileVersion: number;
};

const MarmotContext = createContext<MarmotContextValue | null>(null);

export function MarmotProvider({ children }: { children: React.ReactNode }) {
  const { privateKeyHex, pubkeyHex, hydrated: identityHydrated } = useNostrIdentity();
  const { profile: localProfile } = useProfile();
  const { markDirty: markBackupDirty } = useBackup();
  const [ready, setReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const clientRef = useRef<MarmotClientType | null>(null);
  // Track group message subscription cleanup functions keyed by groupId
  const groupSubsRef = useRef<Map<string, () => void>>(new Map());
  // Track groups where profile has been published (to avoid re-publishing)
  const profilePublishedRef = useRef<Set<string>>(new Set());
  // Ref for localProfile to avoid stale closures in subscription callbacks
  const localProfileRef = useRef(localProfile);
  // Bumped on every incoming profile message so UI can re-read from IDB
  const [profileVersion, setProfileVersion] = useState(0);
  // Track discoverability status
  const [discoverable, setDiscoverable] = useState(false);

  // Keep localProfileRef in sync so subscription callbacks always use the latest profile
  useEffect(() => {
    localProfileRef.current = localProfile;
  }, [localProfile]);

  // Load groups from storage on mount
  const reloadGroups = useCallback(async () => {
    const loaded = await loadAllGroups();
    setGroups(loaded);
  }, []);

  // Check and update discoverability status based on available key packages
  const updateDiscoverability = useCallback(async (client: MarmotClientType) => {
    try {
      const packages = await client.keyPackages.list();
      const hasDiscoverable = packages.some(
        (p) => !p.used && p.published && p.published.length > 0
      );
      setDiscoverable(hasDiscoverable);
    } catch (err) {
      console.debug('[Marmot] updateDiscoverability failed:', err);
    }
  }, []);

  // Initialize MarmotClient once identity is ready
  useEffect(() => {
    if (!identityHydrated || !privateKeyHex || !pubkeyHex) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;

    async function init() {
      try {
        // ts-mls / @hpke require crypto.subtle which is only available in
        // secure contexts (HTTPS or localhost). Bail early with a clear
        // message instead of letting the library throw a raw TypeError.
        if (!globalThis.isSecureContext) {
          console.warn(
            '[Marmot] Not a secure context (HTTPS required). ' +
            'Groups are unavailable. Skipping MLS init.',
          );
          setUnsupported(true);
          setReady(true);
          return;
        }

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
          signer,
          (joinedGroup) => {
            // A new group was joined from a Welcome — reload groups.
            // NOTE: profile update is NOT done here because sendApplicationRumor
            // advances the MLS key schedule, which would make pending historical
            // commits (e.g. "add member C") undecryptable. Profile updates are
            // deferred to subscribeToGroupMessages's onHistorySynced callback.
            void reloadGroups();
            markBackupDirty(true);
            console.info('[Marmot] Joined group from Welcome:', joinedGroup.name);
          }
        );

        // Listen for group join events to rotate consumed key packages
        client.on('groupJoined', async () => {
          if (!cancelled) {
            try {
              const packages = await client.keyPackages.list();
              for (const pkg of packages.filter((p) => p.used)) {
                await client.keyPackages.rotate(pkg.keyPackageRef, { relays: [...DEFAULT_RELAYS] });
              }
              // Re-evaluate discoverability after rotation
              await updateDiscoverability(client);
            } catch (err) {
              console.debug('[Marmot] Key package rotation failed:', err);
            }
          }
        });

        // --- Background: key package readiness, relay list publish & cleanup ---
        (async () => {
          try {
            const existingPackages = await client.keyPackages.list();
            const hasUsable = existingPackages.some(
              (p) => !p.used && p.published && p.published.length > 0,
            );

            if (!hasUsable && DEFAULT_RELAYS.length > 0) {
              await client.keyPackages.create({ relays: [...DEFAULT_RELAYS] });
            }

            // Delete stale kind 443 events from relays whose private keys are
            // no longer in local IndexedDB (e.g. after clearing browser data).
            // With kind 30443, each client gets its own addressable slot, so
            // cross-app conflicts are avoided. But old kind 443 events from
            // previous sessions must still be cleaned up.
            if (DEFAULT_RELAYS.length > 0 && ndk) {
              try {
                const remoteKPs = await network.request([...DEFAULT_RELAYS], [
                  { kinds: [443 as any], authors: [pubkeyHex!] } as any,
                ]);
                const localList = await client.keyPackages.list();
                const localPublishedIds = new Set(
                  localList.flatMap((kp) => kp.published.map((e) => e.id)),
                );
                const staleIds = remoteKPs
                  .map((e) => e.id as string)
                  .filter((id) => !localPublishedIds.has(id));

                if (staleIds.length > 0) {
                  console.debug('[Marmot] deleting', staleIds.length, 'stale kind 443 KP events from relays');
                  const deleteEvent = {
                    kind: 5,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                      ...staleIds.map((id) => ['e', id]),
                      ['k', '443'],
                    ],
                    content: '',
                    pubkey: pubkeyHex!,
                  };
                  const signed = await signer.signEvent(deleteEvent as any);
                  const { NDKEvent, NDKRelaySet } = await import('@nostr-dev-kit/ndk');
                  const ndkEvent = new NDKEvent(ndk, signed as any);
                  const relaySet = NDKRelaySet.fromRelayUrls(DEFAULT_RELAYS, ndk);
                  await ndkEvent.publish(relaySet).catch(() => {});
                }
              } catch {
                // Non-fatal: stale KP cleanup is best-effort
              }
            }

            // Publish kind 30051 relay list for key package discovery (addressable with d tag)
            if (DEFAULT_RELAYS.length > 0 && ndk) {
              try {
                const { NDKEvent, NDKRelaySet } = await import('@nostr-dev-kit/ndk');
                const existing30051 = await network.request([...DEFAULT_RELAYS], [
                  { kinds: [30051 as any], authors: [pubkeyHex!], limit: 1 } as any,
                ]);

                if (existing30051.length === 0) {
                  // Create kind 30051 event with d tag for addressable relay list
                  const unsigned = {
                    kind: 30051,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                      ['d', 'marmot'],
                      ...DEFAULT_RELAYS.map((url) => ['relay', url]),
                    ],
                    content: '',
                    pubkey: pubkeyHex!,
                  };
                  const signed = await signer.signEvent(unsigned as any);
                  const ndkEvent = new NDKEvent(ndk, signed);
                  const relaySet = NDKRelaySet.fromRelayUrls(DEFAULT_RELAYS, ndk);
                  await ndkEvent.publish(relaySet).catch(() => {
                    // Non-fatal: invite flow degrades gracefully
                  });
                }
              } catch {
                // Non-fatal: relay list publish is best-effort
              }
            }

            if (!cancelled) {
              // Re-evaluate after background work completes
              await updateDiscoverability(client);
            }
          } catch {
            // Non-fatal: discoverability degrades gracefully
          }
        })();

        setReady(true);
      } catch (err) {
        console.error('[Marmot] Initialization failed:', err);
        // Still mark ready so UI doesn't hang
        setReady(true);
      }
    }

    void init();
    return () => { cancelled = true; };
  }, [identityHydrated, privateKeyHex, pubkeyHex, reloadGroups, updateDiscoverability]);

  // Subscribe to group messages for each group (for incoming score updates)
  useEffect(() => {
    if (!ready || groups.length === 0) return;
    const client = clientRef.current;
    if (!client || typeof window === 'undefined') return;

    const subsMap = groupSubsRef.current;

    async function subscribeNewGroups() {
      // Initialise unread counts from persisted messages on first run
      if (pubkeyHex) {
        void initUnreadCounts(groups.map((g) => g.id), pubkeyHex);
      }

      const { subscribeToGroupMessages } = await import('@/src/lib/marmot/welcomeSubscription');
      const { getNdk } = await import('@/src/lib/ndkClient');
      const ndk = getNdk();
      if (!ndk) return;

      for (const group of groups) {
        if (subsMap.has(group.id)) continue; // Already subscribed
        try {
          const mlsGroup = await client!.getGroup(group.id).catch(() => null);
          if (!mlsGroup) continue;

          // Immediately sync member list from MLS state (authoritative source).
          // The MLS ratchet tree tracks all members — even commits processed in
          // a previous session are reflected here. This ensures the overlay store
          // is up-to-date without needing to re-ingest historical events (which
          // is impossible after the MLS key schedule advances due to forward secrecy).
          const { getGroupMembers } = await import('@internet-privacy/marmot-ts');
          const mlsMembers = getGroupMembers(mlsGroup.state);
          const stored = groups.find((g) => g.id === group.id);
          if (stored && mlsMembers.length !== stored.memberPubkeys.length) {
            await persistGroup({ ...stored, memberPubkeys: mlsMembers });
            await reloadGroups();
          }

          const { SCORE_RUMOR_KIND, parseScorePayload } = await import('@/src/lib/marmot/scoreSync');
          const { PROFILE_RUMOR_KIND, parseProfilePayload, payloadToMemberProfile } = await import('@/src/lib/marmot/profileSync');

          // BUG FIX: track member count at subscription time so onMembersChanged
          // can detect when new members join and republish the local profile.
          // Bug report: bug-reports/profile-propagation-new-members.md
          // Date: 2026-03-24
          let prevMemberCount = mlsMembers.length;

          const unsub = await subscribeToGroupMessages(
            group.id,
            group.relays,
            mlsGroup,
            ndk,
            (rumor) => {
              const senderPubkey = rumor.pubkey;
              if (senderPubkey === pubkeyHex) return; // skip own messages

              if (rumor.kind === SCORE_RUMOR_KIND) {
                const update = parseScorePayload(rumor.content);
                if (update) {
                  void mergeMemberScore(group.id, senderPubkey, senderPubkey.slice(0, 8), update).catch(
                    (err: unknown) => console.warn('[Marmot] mergeMemberScore failed:', err)
                  );
                }
              } else if (rumor.kind === PROFILE_RUMOR_KIND) {
                const profilePayload = parseProfilePayload(rumor.content);
                if (profilePayload) {
                  const memberProfile = payloadToMemberProfile(senderPubkey, profilePayload);
                  // Write to IDB first, THEN bump profileVersion so GroupDetailView
                  // re-reads after the write has landed (avoids stale-read race).
                  void mergeMemberProfile(group.id, memberProfile).then(() => {
                    setProfileVersion((v) => v + 1);
                  }).catch(
                    (err: unknown) => console.warn('[Marmot] mergeMemberProfile failed:', err)
                  );
                  void updateMemberScoreNickname(group.id, senderPubkey, profilePayload.nickname).catch(
                    (err: unknown) => console.warn('[Marmot] updateMemberScoreNickname failed:', err)
                  );
                  // Cache in global contact cache for cross-group availability
                  void import('@/src/lib/contactCache').then(({ writeContactEntry }) => {
                    writeContactEntry(senderPubkey, {
                      nickname: memberProfile.nickname,
                      avatar: memberProfile.avatar,
                      updatedAt: memberProfile.updatedAt,
                    });
                  });
                }
              } else if (rumor.kind === CHAT_MESSAGE_KIND) {
                incrementUnread(group.id);
              }
            },
            // Refresh memberPubkeys from MLS state after ingesting any event
            // (commits, proposals, etc. — not just application messages)
            async (currentMembers) => {
              const stored = groups.find((g) => g.id === group.id);
              if (stored && currentMembers.length !== stored.memberPubkeys.length) {
                await persistGroup({ ...stored, memberPubkeys: currentMembers });
                await reloadGroups();
              }
              // BUG FIX: when new members join (count increases), republish local
              // profile so they receive current profile data without relying on
              // historical messages alone. Do not gate on profilePublishedRef —
              // this must fire on every join regardless of prior publish.
              // Uses localProfileRef to avoid stale-closure race when the user
              // changes their nickname between subscription creation and member join.
              // Bug report: bug-reports/profile-propagation-new-members.md
              if (currentMembers.length > prevMemberCount) {
                const payload = serialiseProfileUpdate(localProfileRef.current);
                const rumor = buildRumor(PROFILE_RUMOR_KIND, payload, pubkeyHex ?? '');
                void mlsGroup.sendApplicationRumor(rumor as any).catch((err: unknown) => {
                  console.warn(`[Marmot] onMembersChanged profile republish for ${group.id} failed:`, err);
                });
              }
              prevMemberCount = currentMembers.length;
            },
            // Publish profile after historical sync completes (epoch is up-to-date).
            // Uses localProfileRef to avoid stale-closure race.
            () => {
              if (profilePublishedRef.current.has(group.id)) return;
              profilePublishedRef.current.add(group.id);
              const currentProfile = localProfileRef.current;
              const payload = serialiseProfileUpdate(currentProfile);
              console.info(`[Marmot] onHistorySynced: publishing profile for group ${group.id}, nickname="${currentProfile.nickname}"`);
              const rumor = buildRumor(PROFILE_RUMOR_KIND, payload, pubkeyHex ?? '');
              void mlsGroup.sendApplicationRumor(rumor as any).then(() => {
                console.info(`[Marmot] onHistorySynced: profile published successfully for group ${group.id}`);
              }).catch((err: unknown) => {
                console.warn(`[Marmot] onHistorySynced profile publish for ${group.id} failed:`, err);
              });
            },
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
          const { nextSequenceNumber: nextSeq, serialiseScoreUpdate: serialise, SCORE_RUMOR_KIND: scoreKind } = await import('@/src/lib/marmot/scoreSync');
          const fullUpdate = { ...item.update, sequenceNumber: nextSeq() };
          const payload = serialise(fullUpdate);
          for (const group of groups) {
            const mlsGroup = await client.getGroup(group.id).catch(() => null);
            if (!mlsGroup) continue;
            const rumor = buildRumor(scoreKind, payload, pubkeyHex ?? '');
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

  // Profile updates are published automatically via the onHistorySynced callback
  // (once per group, after historical events are ingested and the local epoch is
  // up-to-date). They can also be published explicitly via publishProfileUpdate.

  const getMemberScores = useCallback(async (groupId: string): Promise<MemberScore[]> => {
    return loadMemberScores(groupId);
  }, []);

  const createGroup = useCallback(async (name: string): Promise<Group | null> => {
    const client = clientRef.current;
    if (!client || !pubkeyHex) return null;

    try {
      const mlsGroup = await client.createGroup(name, { relays: [...DEFAULT_RELAYS] });
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
      markBackupDirty(true);

      // Publish profile to the new group
      try {
        const payload = serialiseProfileUpdate(localProfile);
        const rumor = buildRumor(PROFILE_RUMOR_KIND, payload, pubkeyHex);
        await mlsGroup.sendApplicationRumor(rumor as any);
      } catch (err) {
        console.warn('[Marmot] publishProfileUpdate on createGroup failed:', err);
      }

      return group;
    } catch (err) {
      console.error('[Marmot] createGroup failed:', err);
      return null;
    }
  }, [pubkeyHex, reloadGroups, localProfile, markBackupDirty]);

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

        const { fetchEventsWithTimeout } = await import('@/src/lib/ndkClient');
        const { events: kpEvents, timedOut } = await fetchEventsWithTimeout(
          ndk,
          // 443 is Marmot KeyPackage kind — cast to NDKKind
          { kinds: [443 as import('@nostr-dev-kit/ndk').NDKKind], authors: [inviteePubkey], limit: 5 },
        );

        const kpArray = Array.from(kpEvents);
        if (kpArray.length === 0) {
          return { ok: false, error: timedOut ? 'timeout' : 'no_key_package' };
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

        const inviteResult = await mlsGroup.inviteByKeyPackageEvent(nostrEvent);

        // Promote the new member to admin so they can also invite others.
        // This commits a GroupContextExtensions proposal updating adminPubkeys.
        try {
          const currentAdmins = mlsGroup.groupData?.adminPubkeys ?? [];
          if (!currentAdmins.some(pk => pk.toLowerCase() === inviteePubkey.toLowerCase())) {
            const { Proposals } = await import('@internet-privacy/marmot-ts');
            await mlsGroup.commit({
              extraProposals: [
                Proposals.proposeUpdateMetadata({
                  adminPubkeys: [...currentAdmins, inviteePubkey],
                }),
              ],
            });
          }
        } catch (adminErr) {
          console.warn('[Marmot] promote-to-admin commit failed (non-fatal):', adminErr);
        }

        // Refresh member list from MLS group state (authoritative source)
        const stored = groups.find((g) => g.id === groupId);
        if (stored) {
          const { getGroupMembers } = await import('@internet-privacy/marmot-ts');
          const updated: Group = {
            ...stored,
            memberPubkeys: getGroupMembers(mlsGroup.state),
          };
          await persistGroup(updated);
          await reloadGroups();
        }

        markBackupDirty(true);
        return { ok: true };
      } catch (err) {
        console.error('[Marmot] inviteByNpub failed:', err);
        return { ok: false, error: 'generic' };
      }
    },
    [groups, reloadGroups, markBackupDirty]
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
    await clearMemberProfiles(groupId);
    // Clear chat messages
    const { clearMessages } = await import('@/src/lib/marmot/chatPersistence');
    await clearMessages(groupId);
    clearUnreadGroup(groupId);
    await reloadGroups();
    markBackupDirty(true);
    return true;
  }, [reloadGroups, markBackupDirty]);

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

          const rumor = buildRumor(SCORE_RUMOR_KIND, payload, pubkeyHex ?? '');
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

  const getMemberProfiles = useCallback(async (groupId: string): Promise<MemberProfile[]> => {
    return loadMemberProfiles(groupId);
  }, []);

  const publishProfileUpdate = useCallback(async (profileOverride?: UserProfile): Promise<void> => {
    const client = clientRef.current;
    if (!client || groups.length === 0 || !pubkeyHex) return;

    const payload = serialiseProfileUpdate(profileOverride ?? localProfile);

    for (const group of groups) {
      try {
        const mlsGroup = await client.getGroup(group.id).catch(() => null);
        if (!mlsGroup) continue;

        const rumor = buildRumor(PROFILE_RUMOR_KIND, payload, pubkeyHex);
        await mlsGroup.sendApplicationRumor(rumor as any);
      } catch (err) {
        console.warn(`[Marmot] publishProfileUpdate to group ${group.id} failed:`, err);
      }
    }
    console.info('[Marmot] publishProfileUpdate sent to', groups.length, 'group(s)');
  }, [groups, pubkeyHex, localProfile]);

  const clearAll = useCallback(async () => {
    await clearAllGroupData();
    setGroups([]);
    clientRef.current = null;
    profilePublishedRef.current.clear();
  }, []);

  const getGroup = useCallback(async (groupId: string): Promise<MarmotGroupType | null> => {
    const client = clientRef.current;
    if (!client) return null;
    try {
      return await client.getGroup(groupId) ?? null;
    } catch {
      return null;
    }
  }, []);

  const getClient = useCallback((): MarmotClientType | null => {
    return clientRef.current;
  }, []);

  const value = useMemo<MarmotContextValue>(
    () => ({
      ready,
      unsupported,
      groups,
      getMemberScores,
      createGroup,
      inviteByNpub,
      leaveGroup,
      publishScoreUpdate,
      onIncomingScore,
      publishProfileUpdate,
      getMemberProfiles,
      reloadGroups,
      clearAll,
      getGroup,
      getClient,
      profileVersion,
    }),
    [
      ready,
      unsupported,
      groups,
      getMemberScores,
      createGroup,
      inviteByNpub,
      leaveGroup,
      publishScoreUpdate,
      onIncomingScore,
      publishProfileUpdate,
      getMemberProfiles,
      reloadGroups,
      clearAll,
      getGroup,
      getClient,
      profileVersion,
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
  unsupported: false,
  groups: [],
  getMemberScores: NOOP_ARRAY as () => Promise<MemberScore[]>,
  createGroup: NOOP_NULL as () => Promise<null>,
  inviteByNpub: async () => ({ ok: false, error: 'not_ready' }),
  leaveGroup: NOOP_BOOL,
  publishScoreUpdate: NOOP_ASYNC,
  onIncomingScore: NOOP_ASYNC,
  publishProfileUpdate: NOOP_ASYNC,
  getMemberProfiles: NOOP_ARRAY as () => Promise<MemberProfile[]>,
  reloadGroups: NOOP_ASYNC,
  clearAll: NOOP_ASYNC,
  getGroup: NOOP_NULL as () => Promise<null>,
  getClient: () => null,
  profileVersion: 0,
};

export function useMarmot(): MarmotContextValue {
  const context = useContext(MarmotContext);
  // Return safe defaults when called outside provider (e.g., during dynamic load)
  return context ?? DEFAULT_MARMOT;
}
