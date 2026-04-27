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
import { incrementUnread, initUnreadCounts, initJoinRequestCounts, clearUnreadGroup, incrementJoinRequest, decrementJoinRequest } from '@/src/lib/unreadStore';
import { CHAT_MESSAGE_KIND } from '@/src/lib/marmot/chatPersistence';
import { POLL_OPEN_KIND, POLL_VOTE_KIND, POLL_CLOSE_KIND, parsePollOpen, parsePollVote, parsePollClose } from '@/src/lib/marmot/pollSync';
import { savePoll, saveVote, getPoll, clearPollData } from '@/src/lib/marmot/pollPersistence';
import { clearGroupMedia } from '@/src/lib/marmot/mediaPersistence';
import type { Poll, PollVote } from '@/src/lib/marmot/pollPersistence';
import { useProfile } from '@/src/context/ProfileContext';
import { useBackup } from '@/src/context/BackupContext';

async function startWelcomeSubscription(
  pubkeyHex: string,
  marmotClient: MarmotClientType,
  ndk: import('@nostr-dev-kit/ndk').default,
  signer: import('applesauce-core').EventSigner,
  onGroupJoined: WelcomeReceivedCallback,
  onJoinRequestReceived?: import('@/src/lib/marmot/joinRequestHandler').JoinRequestReceivedCallback,
  groupMemberPubkeys?: (groupId: string) => string[],
): Promise<() => void> {
  const { subscribeToWelcomes } = await import('@/src/lib/marmot/welcomeSubscription');
  return subscribeToWelcomes(pubkeyHex, marmotClient, ndk, signer, onGroupJoined, onJoinRequestReceived, groupMemberPubkeys);
}
import { DEFAULT_RELAYS } from '@/src/types';
import { getEventHash } from 'applesauce-core/helpers/event';

/**
 * WORKAROUND: ts-mls forbids application messages when unappliedProposals
 * is non-empty. This catches the error, commits pending proposals, and
 * retries. Requires the sender to be an admin (commit() has an admin check).
 * For fire-and-forget callers, pass `softFail: true`.
 *
 * Root cause: admin promotion during invite can silently fail, leaving
 * members unable to commit. The real fix is to guarantee admin promotion
 * succeeds (retry / block invite until confirmed).
 */
const MAX_RETRIES = 3;
async function sendRumorSafe(
  group: MarmotGroupType,
  rumor: Parameters<MarmotGroupType['sendApplicationRumor']>[0],
  opts?: { softFail?: boolean },
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await group.sendApplicationRumor(rumor);
      return;
    } catch (err) {
      const isUnapplied = err instanceof Error && err.message.includes('unapplied proposals');
      if (!isUnapplied || attempt === MAX_RETRIES) {
        if (opts?.softFail) return;
        throw err;
      }
      console.warn(`[sendRumorSafe] unapplied proposals (attempt ${attempt + 1}/${MAX_RETRIES + 1}), committing…`);
      try {
        await group.commit();
      } catch (commitErr) {
        if (opts?.softFail) return;
        throw commitErr;
      }
    }
  }
}

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
  inviteByNpub: (groupId: string, npub: string) => Promise<{ ok: boolean; error?: string; warning?: string }>;
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
  /** Monotonically increasing counter bumped on each received chat message */
  chatVersion: number;
  /** Monotonically increasing counter bumped when group metadata (e.g. adminPubkeys) may change */
  groupDataVersion: number;
  /** Monotonically increasing counter bumped on each received poll message */
  pollVersion: number;
  /** Pending join requests per group (loaded on demand) */
  pendingRequests: Record<string, import('@/src/lib/marmot/joinRequestStorage').PendingJoinRequest[]>;
  /** Load pending join requests for a group from IDB into state */
  loadPendingRequestsForGroup: (groupId: string) => Promise<void>;
  /** Approve a join request: invite by npub, remove request, decrement bell */
  approveJoinRequest: (request: import('@/src/lib/marmot/joinRequestStorage').PendingJoinRequest) => Promise<{ ok: boolean; error?: string }>;
  /** Deny a join request: remove request, decrement bell */
  denyJoinRequest: (request: import('@/src/lib/marmot/joinRequestStorage').PendingJoinRequest) => Promise<void>;
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
  // Track welcome subscription cleanup so it can be stopped on remount/identity change
  const welcomeSubRef = useRef<(() => void) | null>(null);
  // Track group message subscription cleanup functions keyed by groupId
  const groupSubsRef = useRef<Map<string, () => void>>(new Map());
  // Track groups where profile has been published (to avoid re-publishing)
  const profilePublishedRef = useRef<Set<string>>(new Set());
  // Ref for localProfile to avoid stale closures in subscription callbacks
  const localProfileRef = useRef(localProfile);
  // Ref for groups to avoid stale closures in welcome subscription callbacks
  const groupsRef = useRef(groups);
  // Bumped on every incoming profile message so UI can re-read from IDB
  const [profileVersion, setProfileVersion] = useState(0);
  // Bumped on every incoming chat message so ChatStoreContext can re-read from IDB
  const [chatVersion, setChatVersion] = useState(0);
  // Bumped when group metadata (e.g. adminPubkeys) may have changed via MLS commit
  const [groupDataVersion, setGroupDataVersion] = useState(0);
  // Pending join requests per group (loaded on demand from IDB)
  const [pendingRequests, setPendingRequests] = useState<Record<string, import('@/src/lib/marmot/joinRequestStorage').PendingJoinRequest[]>>({});
  // Bumped on every incoming poll message so PollStoreContext can re-read from IDB
  const [pollVersion, setPollVersion] = useState(0);
  // Track discoverability status
  const [discoverable, setDiscoverable] = useState(false);

  // Keep localProfileRef in sync so subscription callbacks always use the latest profile
  useEffect(() => {
    localProfileRef.current = localProfile;
  }, [localProfile]);

  // Keep groupsRef in sync so welcome subscription callbacks see current membership
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

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

        const { MarmotClient, GroupMediaStore } =
          await import('@internet-privacy/marmot-ts');
        const { connectNdk } = await import('@/src/lib/ndkClient');
        const { NdkNetworkAdapter } = await import('@/src/lib/marmot/NdkNetworkAdapter');
        const { createPrivateKeySigner } = await import('@/src/lib/marmot/signerAdapter');
        const { publishKeyPackages } = await import('@/src/lib/keyPackages');
        const { createStore: idbCreateStore } = await import('idb-keyval');
        const { IdbKeyValueStoreBackend } = await import('@/src/lib/marmot/idbKeyValueStoreBackend');

        const ndk = await connectNdk(privateKeyHex!);
        const signer = createPrivateKeySigner(privateKeyHex!);

        const groupStateStore = new IdbGroupStateBackend();
        const keyPackageStore = new IdbKeyPackageBackend();
        const network = new NdkNetworkAdapter(ndk);

        const mediaBlobStore = idbCreateStore('quizzl-media-blobs', 'blobs');
        const mediaFactory = () => new GroupMediaStore(new IdbKeyValueStoreBackend(mediaBlobStore));

        const client = new MarmotClient({
          signer,
          // marmot-ts 0.5.x: backends are passed directly (KeyValueGroupStateBackend
          // and KeyPackageStore wrappers were removed/inlined).
          groupStateStore,
          keyPackageStore,
          network,
          mediaFactory,
          // Default `d` slot for kind 30443 key package events. All key packages
          // from this client share a single addressable slot so relays replace
          // the previous one on rotation.
          clientId: 'quizzl',
        });

        if (cancelled) return;
        clientRef.current = client;

        // Load existing groups from MLS state store
        try {
          await client.groups.loadAll();
        } catch (err) {
          console.warn('[Marmot] groups.loadAll failed:', err);
        }

        // Publish KeyPackages if none exist
        try {
          const count = await client.keyPackages.count();
          if (count === 0) {
            await publishKeyPackages(client.keyPackages, 5, [...DEFAULT_RELAYS]);
          }
        } catch (err) {
          console.warn('[Marmot] KeyPackage publish failed:', err);
        }

        // Load group metadata from our overlay store
        await reloadGroups();

        // Start Welcome subscription (listen for incoming invitations)
        // Stop any previous welcome subscription before starting a new one
        welcomeSubRef.current?.();
        welcomeSubRef.current = null;
        startWelcomeSubscription(
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
          },
          (request) => {
            // A join request was received and persisted — increment bell counter.
            incrementJoinRequest(request.groupId);
            console.info('[Marmot] Join request received from:', request.pubkeyHex, 'for group:', request.groupId);
          },
          (groupId) => {
            // Look up current group member pubkeys for dedup/membership check.
            // Uses groupsRef to always read the latest groups state.
            const group = groupsRef.current.find((g) => g.id === groupId);
            return group?.memberPubkeys ?? [];
          },
        ).then((unsub) => {
          if (cancelled) {
            unsub();
          } else {
            welcomeSubRef.current = unsub;
          }
        }).catch((err) => {
          console.warn('[Marmot] Welcome subscription failed:', err);
        });

        // Listen for group join events to rotate consumed key packages.
        // marmot-ts 0.5.x: events live on client.groups; 'groupJoined' → 'joined'.
        client.groups.on('joined', async () => {
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

            // Delete stale key-package events from relays whose private keys
            // are no longer in local IndexedDB (e.g. after clearing browser
            // data). Covers both legacy kind 443 events and kind 30443
            // addressable events from previous sessions.
            if (DEFAULT_RELAYS.length > 0 && ndk) {
              try {
                const remoteKPs = await network.request([...DEFAULT_RELAYS], [
                  { kinds: [443 as any, 30443 as any], authors: [pubkeyHex!] } as any,
                ]);
                const localList = await client.keyPackages.list();
                const localPublishedIds = new Set(
                  localList.flatMap((kp) => (kp.published ?? []).map((e) => e.id)),
                );
                const staleEvents = remoteKPs.filter(
                  (e) => !localPublishedIds.has(e.id as string),
                );

                if (staleEvents.length > 0) {
                  const staleKinds = Array.from(new Set(staleEvents.map((e) => e.kind))).map(String);
                  console.debug('[Marmot] deleting', staleEvents.length, 'stale KP events from relays (kinds:', staleKinds.join(','), ')');
                  const deleteEvent = {
                    kind: 5,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                      ...staleEvents.map((e) => ['e', e.id as string]),
                      ...staleKinds.map((k) => ['k', k]),
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
    return () => {
      cancelled = true;
      welcomeSubRef.current?.();
      welcomeSubRef.current = null;
    };
  }, [identityHydrated, privateKeyHex, pubkeyHex, reloadGroups, updateDiscoverability]);

  // Subscribe to group messages for each group (for incoming score updates)
  useEffect(() => {
    if (!ready || groups.length === 0) return;
    const client = clientRef.current;
    if (!client || typeof window === 'undefined') return;

    const subsMap = groupSubsRef.current;

    async function subscribeNewGroups() {
      // Initialise unread counts from persisted messages on first run
      const gids = groups.map((g) => g.id);
      if (pubkeyHex) {
        void initUnreadCounts(gids, pubkeyHex);
      }
      void initJoinRequestCounts(gids);

      const { subscribeToGroupMessages } = await import('@/src/lib/marmot/welcomeSubscription');
      const { getNdk } = await import('@/src/lib/ndkClient');
      const ndk = getNdk();
      if (!ndk) return;

      for (const group of groups) {
        if (subsMap.has(group.id)) continue; // Already subscribed
        try {
          const mlsGroup = await client!.groups.get(group.id).catch(() => null);
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
                void (async () => {
                  const { appendMessage } = await import('@/src/lib/marmot/chatPersistence');
                  const { parseImageMessageContent, extractAttachmentsByRole } = await import('@/src/lib/media/imageMessage');
                  const parsed = parseImageMessageContent(rumor.content);
                  // Preserve the role classification from the original imeta
                  // tags so the bubble/lightbox don't have to guess full vs
                  // thumb from filename or array index downstream.
                  const attachments = (parsed?.type === 'image' && rumor.tags?.length)
                    ? extractAttachmentsByRole(rumor.tags)
                    : null;
                  const hasAttachment = attachments && (attachments.full || attachments.thumb);
                  const msg = {
                    id: rumor.id,
                    content: rumor.content,
                    senderPubkey: rumor.pubkey,
                    groupId: group.id,
                    createdAt: rumor.created_at * 1000,
                    ...(hasAttachment ? { attachments } : {}),
                  };
                  void appendMessage(group.id, msg).then(() => {
                    setChatVersion((v) => v + 1);
                  }).catch((err: unknown) => console.warn('[Marmot] chat appendMessage failed:', err));
                })();
                incrementUnread(group.id);
              } else if (rumor.kind === POLL_OPEN_KIND) {
                const payload = parsePollOpen(rumor.content);
                if (payload) {
                  const poll: Poll = {
                    id: payload.id,
                    groupId: group.id,
                    title: payload.title,
                    description: payload.description,
                    options: payload.options,
                    pollType: payload.pollType,
                    creatorPubkey: payload.creatorPubkey,
                    createdAt: rumor.created_at * 1000,
                    closed: false,
                  };
                  void savePoll(poll).then(() => {
                    setPollVersion((v) => v + 1);
                  }).catch((err: unknown) => console.warn('[Marmot] savePoll failed:', err));
                }
              } else if (rumor.kind === POLL_VOTE_KIND) {
                const payload = parsePollVote(rumor.content);
                if (payload) {
                  // Ignore votes for closed polls
                  void getPoll(group.id, payload.pollId).then((existingPoll) => {
                    if (existingPoll?.closed) return;
                    const vote: PollVote = {
                      id: `${payload.pollId}:${senderPubkey}`,
                      pollId: payload.pollId,
                      voterPubkey: senderPubkey,
                      responses: payload.responses,
                      votedAt: rumor.created_at * 1000,
                    };
                    return saveVote(vote).then(() => {
                      setPollVersion((v) => v + 1);
                    });
                  }).catch((err: unknown) => console.warn('[Marmot] saveVote failed:', err));
                }
              } else if (rumor.kind === POLL_CLOSE_KIND) {
                const payload = parsePollClose(rumor.content);
                if (payload) {
                  // Only the poll creator can close
                  void getPoll(group.id, payload.pollId).then((existingPoll) => {
                    if (!existingPoll) return;
                    if (existingPoll.creatorPubkey !== senderPubkey) return;
                    const updated: Poll = {
                      ...existingPoll,
                      closed: true,
                      results: payload.results,
                      totalVoters: payload.totalVoters,
                    };
                    return savePoll(updated).then(() => {
                      setPollVersion((v) => v + 1);
                    });
                  }).catch((err: unknown) => console.warn('[Marmot] poll close failed:', err));
                }
              }
            },
            // Refresh memberPubkeys from MLS state after ingesting any event
            // (commits, proposals, etc. — not just application messages)
            async (currentMembers) => {
              // Always bump groupDataVersion so consumers (e.g. isAdmin) re-read
              // group metadata after any MLS commit, even when member count is unchanged.
              setGroupDataVersion((v) => v + 1);
              const stored = groups.find((g) => g.id === group.id);
              if (stored && currentMembers.length !== stored.memberPubkeys.length) {
                await persistGroup({ ...stored, memberPubkeys: currentMembers });
                await reloadGroups();
              }
              // WORKAROUND: auto-commit unapplied proposals (e.g. leave
              // proposals) so all members can send application messages.
              // Only works when the local user is admin. Fails silently
              // if admin promotion was lost — see sendRumorSafe comment.
              if (Object.keys(mlsGroup.unappliedProposals).length > 0) {
                void mlsGroup.commit().catch((err: unknown) => {
                  console.debug('[Marmot] auto-commit unapplied proposals failed:', err);
                });
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
                void sendRumorSafe(mlsGroup, rumor as any, { softFail: true }).catch((err: unknown) => {
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
              void sendRumorSafe(mlsGroup, rumor as any, { softFail: true }).then(() => {
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

    // Cleanup: unsubscribe ALL tracked group subscriptions on unmount or
    // dependency change. The next effect run will re-subscribe as needed.
    // Previously only groups that disappeared were cleaned up, leaving
    // duplicate subscriptions alive across re-renders.
    return () => {
      for (const [groupId, unsub] of Array.from(subsMap.entries())) {
        unsub();
        subsMap.delete(groupId);
      }
      profilePublishedRef.current.clear();
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
            const mlsGroup = await client.groups.get(group.id).catch(() => null);
            if (!mlsGroup) continue;
            const rumor = buildRumor(scoreKind, payload, pubkeyHex ?? '');
            await sendRumorSafe(mlsGroup, rumor as any, { softFail: true });
          }
        } catch {
          // Non-fatal — item was already dequeued
        }
      }
    }

    const handler = () => void drainQueue();
    window.addEventListener('online', handler);
    return () => {
      window.removeEventListener('online', handler);
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
      const mlsGroup = await client.groups.create(name, { relays: [...DEFAULT_RELAYS] });
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
        await sendRumorSafe(mlsGroup, rumor as any);
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
    async (groupId: string, npub: string): Promise<{ ok: boolean; error?: string; warning?: string }> => {
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
          // marmot-ts 0.5.x peers publish kind 30443 (addressable). Older
          // peers may still have kind 443 events on relays — accept both.
          {
            kinds: [
              443 as import('@nostr-dev-kit/ndk').NDKKind,
              30443 as import('@nostr-dev-kit/ndk').NDKKind,
            ],
            authors: [inviteePubkey],
            limit: 5,
          },
        );

        const kpArray = Array.from(kpEvents);
        if (kpArray.length === 0) {
          return { ok: false, error: timedOut ? 'timeout' : 'no_key_package' };
        }

        const mlsGroup = await client.groups.get(groupId).catch(() => null);
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
        let adminPromotionFailed = false;
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
          console.warn('[Marmot] promote-to-admin commit failed:', adminErr);
          adminPromotionFailed = true;
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

        // Ensure the inviter also re-sends its current profile immediately
        // after the invite commit lands. Relying only on onMembersChanged is
        // insufficient here because the local overlay can refresh member count
        // before the subscription callback observes the join, which prevents
        // the inviter from sending its "welcome" profile to the new member.
        try {
          const payload = serialiseProfileUpdate(localProfileRef.current);
          const rumor = buildRumor(PROFILE_RUMOR_KIND, payload, pubkeyHex ?? '');
          await sendRumorSafe(mlsGroup, rumor as any);
        } catch (profileErr) {
          console.warn('[Marmot] inviter profile publish after invite failed:', profileErr);
        }

        markBackupDirty(true);
        return adminPromotionFailed
          ? { ok: true, warning: 'admin_promotion_failed' }
          : { ok: true };
      } catch (err) {
        console.error('[Marmot] inviteByNpub failed:', err);
        return { ok: false, error: 'generic' };
      }
    },
    [groups, reloadGroups, markBackupDirty, pubkeyHex]
  );

  // Soft-leave: purge local state only. No MLS Remove proposal is sent,
  // so the group is never blocked by an unapplied proposal that needs an
  // admin commit. The member simply disappears from the local UI.
  // See specs/out-of-band-leave.md for the planned protocol-level solution.
  const leaveGroup = useCallback(async (groupId: string): Promise<boolean> => {
    // Always remove from local storage — no MLS leave() call.
    await removeGroupFromStorage(groupId);
    await clearMemberScores(groupId);
    await clearMemberProfiles(groupId);
    // Clear chat messages
    const { clearMessages } = await import('@/src/lib/marmot/chatPersistence');
    await clearMessages(groupId);
    // Clear poll data
    await clearPollData(groupId);
    await clearGroupMedia(groupId);
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
          const mlsGroup = await client.groups.get(group.id).catch(() => null);
          if (!mlsGroup) continue;

          const rumor = buildRumor(SCORE_RUMOR_KIND, payload, pubkeyHex ?? '');
          await sendRumorSafe(mlsGroup, rumor as any);
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
        const mlsGroup = await client.groups.get(group.id).catch(() => null);
        if (!mlsGroup) continue;

        const rumor = buildRumor(PROFILE_RUMOR_KIND, payload, pubkeyHex);
        await sendRumorSafe(mlsGroup, rumor as any);
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
      return await client.groups.get(groupId) ?? null;
    } catch {
      return null;
    }
  }, []);

  const getClient = useCallback((): MarmotClientType | null => {
    return clientRef.current;
  }, []);

  const loadPendingRequestsForGroup = useCallback(async (groupId: string): Promise<void> => {
    const { loadPendingJoinRequests } = await import('@/src/lib/marmot/joinRequestStorage');
    const requests = await loadPendingJoinRequests(groupId);
    setPendingRequests((prev) => ({ ...prev, [groupId]: requests }));
  }, []);

  const approveJoinRequest = useCallback(
    async (request: import('@/src/lib/marmot/joinRequestStorage').PendingJoinRequest): Promise<{ ok: boolean; error?: string }> => {
      const { pubkeyToNpub } = await import('@/src/lib/nostrKeys');
      const npub = pubkeyToNpub(request.pubkeyHex);
      const result = await inviteByNpub(request.groupId, npub);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      // Remove the request from IDB and update local state
      const { deletePendingJoinRequest } = await import('@/src/lib/marmot/joinRequestStorage');
      await deletePendingJoinRequest(request.eventId);
      decrementJoinRequest(request.groupId);
      // Update local pending requests state
      setPendingRequests((prev) => {
        const current = prev[request.groupId] ?? [];
        return { ...prev, [request.groupId]: current.filter((r) => r.eventId !== request.eventId) };
      });
      return { ok: true };
    },
    [inviteByNpub],
  );

  const denyJoinRequest = useCallback(
    async (request: import('@/src/lib/marmot/joinRequestStorage').PendingJoinRequest): Promise<void> => {
      const { deletePendingJoinRequest } = await import('@/src/lib/marmot/joinRequestStorage');
      await deletePendingJoinRequest(request.eventId);
      decrementJoinRequest(request.groupId);
      // Update local pending requests state
      setPendingRequests((prev) => {
        const current = prev[request.groupId] ?? [];
        return { ...prev, [request.groupId]: current.filter((r) => r.eventId !== request.eventId) };
      });
    },
    [],
  );

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
      chatVersion,
      groupDataVersion,
      pollVersion,
      pendingRequests,
      loadPendingRequestsForGroup,
      approveJoinRequest,
      denyJoinRequest,
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
      chatVersion,
      groupDataVersion,
      pollVersion,
      pendingRequests,
      loadPendingRequestsForGroup,
      approveJoinRequest,
      denyJoinRequest,
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
  chatVersion: 0,
  groupDataVersion: 0,
  pollVersion: 0,
  pendingRequests: {},
  loadPendingRequestsForGroup: NOOP_ASYNC,
  approveJoinRequest: async () => ({ ok: false, error: 'not_ready' }),
  denyJoinRequest: NOOP_ASYNC,
};

export function useMarmot(): MarmotContextValue {
  const context = useContext(MarmotContext);
  // Return safe defaults when called outside provider (e.g., during dynamic load)
  return context ?? DEFAULT_MARMOT;
}
