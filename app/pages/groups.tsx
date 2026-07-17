import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Flex,
  Heading,
  Text,
  VStack,
  HStack,
  Button,
  Input,
  Divider,
  Badge,
  Alert,
  AlertIcon,
  AlertDescription,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import NextLink from 'next/link';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useProfile } from '@/src/context/ProfileContext';
import { readContactCache } from '@/src/lib/contactCache';
import GroupCard from '@/src/components/groups/GroupCard';
import CreateGroupModal from '@/src/components/groups/CreateGroupModal';
import BackupReminderBanner from '@/src/components/groups/BackupReminderBanner';
import OfflineBanner from '@/src/components/groups/OfflineBanner';
import MemberList from '@/src/components/groups/MemberList';
import InviteMemberModal from '@/src/components/groups/InviteMemberModal';
import GenerateInviteLinkModal from '@/src/components/groups/GenerateInviteLinkModal';
import ManageInviteLinksModal from '@/src/components/groups/ManageInviteLinksModal';
import JoinRequestCard from '@/src/components/groups/JoinRequestCard';
import PendingRequestsSection from '@/src/components/groups/PendingRequestsSection';
import PendingInvitations from '@/src/components/groups/PendingInvitations';
import LeaveGroupButton from '@/src/components/groups/LeaveGroupButton';
import GroupChat from '@/src/components/groups/GroupChat';
// Voice/video calls are gated behind the CALLS_ENABLED feature toggle.
import { GroupCallToolbar } from '@/src/components/calls/CallToolbar';
import { CALLS_ENABLED } from '@/src/config/features';
import { ChatStoreProvider, useChatStore } from '@/src/context/ChatStoreContext';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { PollStoreProvider } from '@/src/context/PollStoreContext';
import PollPanel from '@/src/components/groups/PollPanel';
import CreatePollModal from '@/src/components/groups/CreatePollModal';
import { markAsRead } from '@/src/lib/unreadStore';
import type { Group, MemberProfile } from '@/src/types';

/* ---------- Detail view (shown when ?id=xxx is present) ---------- */

type MarmotGroupType = import('@internet-privacy/marmot-ts').MarmotGroup;

/** Captures sendMessage from ChatStore into a ref so GroupDetailView can use it. */
function ChatSendMessageCapture({ sendMessageRef }: { sendMessageRef: React.MutableRefObject<((c: string) => Promise<void>) | null> }) {
  const { sendMessage } = useChatStore();
  sendMessageRef.current = sendMessage;
  return null;
}

function GroupDetailView({ id }: { id: string }) {
  const copy = useCopy();
  const { groups, ready, getMemberProfiles, getGroup: getMarmotGroup, profileVersion, chatVersion, groupDataVersion, pollVersion, reactionsVersion, cancelPendingInvitation, requestProfilesIfStale, grantAdmin, renameGroup, getPendingRemovals } = useMarmot();
  const { pubkeyHex, privateKeyHex } = useNostrIdentity();
  const signer = useMemo(
    () => (privateKeyHex ? createPrivateKeySigner(privateKeyHex) : null),
    [privateKeyHex],
  );
  const { profile: ownProfile } = useProfile();
  const toast = useToast();
  const inviteDisclosure = useDisclosure();
  const inviteLinkDisclosure = useDisclosure();
  const manageLinksDisclosure = useDisclosure();
  const pollDisclosure = useDisclosure();
  const [pollPanelOpen, setPollPanelOpen] = useState(true);
  const [group, setGroup] = useState<Group | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [profileMap, setProfileMap] = useState<Record<string, MemberProfile>>({});
  const [confirmedPubkeys, setConfirmedPubkeys] = useState<Set<string>>(new Set());
  const [mlsGroup, setMlsGroup] = useState<MarmotGroupType | null>(null);
  // Ref to capture sendMessage from inside ChatStoreProvider without prop drilling
  const sendAnnouncementRef = useRef<((content: string) => Promise<void>) | null>(null);
  // Guards requestProfilesIfStale so it fires only once per group entry (on mount /
  // group-ID change), not on every profileVersion / groupDataVersion tick.
  const requestedOnEntryForRef = useRef<string | null>(null);

  const onCancelInvite = useCallback(async (pubkey: string) => {
    if (!group) return;
    const result = await cancelPendingInvitation(
      group.id,
      pubkey,
      sendAnnouncementRef.current ?? undefined,
    );
    if (result.ok && result.raceDetected) {
      toast({
        title: copy.groups.cancelInviteRaceNotice,
        status: 'info',
        duration: 4000,
        isClosable: true,
      });
    } else if (result.ok && result.announcementError) {
      toast({
        title: copy.groups.cancelInviteAnnouncementWarning,
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
    } else if (result.ok) {
      toast({
        title: copy.groups.cancelInviteSuccess,
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } else {
      toast({
        title: copy.groups.cancelInviteError,
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    }
  }, [group, cancelPendingInvitation, toast, copy.groups]);

  const handleMakeAdmin = useCallback(async (pubkey: string) => {
    if (!group) return;
    try {
      const result = await grantAdmin(group.id, pubkey);
      if (result.ok) {
        toast({
          title: copy.groups.makeAdminSuccess,
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
      } else {
        // All non-ok results (closed codes + exhausted-retry raw messages) map to makeAdminError.
        toast({
          title: copy.groups.makeAdminError,
          status: 'error',
          duration: 4000,
          isClosable: true,
        });
      }
    } catch {
      toast({
        title: copy.groups.makeAdminError,
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    }
  }, [group, grantAdmin, toast, copy.groups]);

  // Inline group-rename (admin-only). The pencil swaps the heading for an input;
  // saving commits the new name to shared MLS metadata, then posts an in-chat
  // notice via the same sendMessage-backed closure used for other announcements.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);

  const startRename = useCallback(() => {
    if (!group) return;
    setNameDraft(group.name);
    setEditingName(true);
  }, [group]);

  const cancelRename = useCallback(() => {
    setEditingName(false);
  }, []);

  const handleRename = useCallback(async () => {
    if (!group) return;
    const trimmed = nameDraft.trim();
    // No-op: empty or unchanged relative to the displayed name — just close.
    if (!trimmed || trimmed === group.name) {
      setEditingName(false);
      return;
    }
    setRenaming(true);
    try {
      const result = await renameGroup(group.id, trimmed);
      if (result.ok) {
        setEditingName(false);
        if (result.changed) {
          // Fire-and-forget in-chat notice (optimistically appended for the
          // actor by sendMessage; remote members render it on receipt).
          void sendAnnouncementRef.current?.(
            JSON.stringify({ type: 'group_renamed', name: trimmed }),
          );
        }
        toast({
          title: copy.groups.renameGroupSuccess,
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
      } else {
        toast({
          title: copy.groups.renameGroupError,
          status: 'error',
          duration: 4000,
          isClosable: true,
        });
      }
    } catch {
      toast({
        title: copy.groups.renameGroupError,
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setRenaming(false);
    }
  }, [group, nameDraft, renameGroup, toast, copy.groups]);

  useEffect(() => {
    if (!ready) return;
    const found = groups.find((g) => g.id === id);
    if (found) {
      setGroup(found);
      if (requestedOnEntryForRef.current !== id) {
        requestedOnEntryForRef.current = id;
        void requestProfilesIfStale(id);
      }
      markAsRead(id);
      void getMarmotGroup(id).then(setMlsGroup).catch(() => {});
      void getMemberProfiles(id).then((profiles) => {
        const map: Record<string, MemberProfile> = {};
        // Track members who have sent a profile in this group (confirmed membership).
        // Members added to the MLS tree but not yet joined (no profile) show as pending.
        const confirmed = new Set<string>();
        for (const p of profiles) {
          map[p.pubkeyHex] = p;
          confirmed.add(p.pubkeyHex);
        }

        // Fill gaps from the global contact cache (known from other groups)
        // Note: contact cache entries do NOT confirm membership in this group
        const contactCache = readContactCache();
        for (const pk of found.memberPubkeys) {
          if (!map[pk] && contactCache[pk]?.nickname) {
            map[pk] = {
              pubkeyHex: pk,
              nickname: contactCache[pk].nickname,
              avatar: contactCache[pk].avatar,
              updatedAt: contactCache[pk].updatedAt,
            };
          }
        }

        // Always overlay own profile from ProfileContext (never depends on MLS)
        if (pubkeyHex) {
          confirmed.add(pubkeyHex);
          if (ownProfile.nickname) {
            map[pubkeyHex] = {
              pubkeyHex,
              nickname: ownProfile.nickname,
              avatar: ownProfile.avatar,
              updatedAt: new Date().toISOString(),
            };
          }
        }

        setProfileMap(map);
        setConfirmedPubkeys(confirmed);
      }).catch(() => {});
    } else {
      setNotFound(true);
    }
  }, [ready, groups, id, getMemberProfiles, pubkeyHex, ownProfile, profileVersion, groupDataVersion, requestProfilesIfStale]);

  if (!ready) {
    return (
      <Box data-testid="group-detail-loading" py={8} textAlign="center">
        <Text color="textMuted">{copy.groups.loading}</Text>
      </Box>
    );
  }

  if (notFound && !group) {
    return (
      <Box data-testid="group-detail-not-found">
        <Alert status="warning" borderRadius="md">
          <AlertIcon />
          <AlertDescription>
            {copy.groups.groupNotFound}{' '}
            <NextLink href="/groups" passHref legacyBehavior>
              <Button as="a" variant="link" size="sm">
                {copy.groups.backToGroups}
              </Button>
            </NextLink>
          </AlertDescription>
        </Alert>
      </Box>
    );
  }

  if (!group) return null;

  const memberCount = group.memberPubkeys.length;
  // adminPubkeys is the single source of truth for both isAdmin and all child components.
  const adminPubkeys = mlsGroup?.groupData?.adminPubkeys ?? [];
  const isAdmin = !!(
    pubkeyHex &&
    adminPubkeys.some(
      (pk: string) => pk.toLowerCase() === pubkeyHex.toLowerCase(),
    )
  );
  // Pending removals: synchronous read; refreshes on each render (groupDataVersion drives re-renders via the effect above).
  const pendingRemovalPubkeys = getPendingRemovals(group.id);

  return (
    <>
      <Head>
        <title>{`${group.name} - ${copy.groups.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="group-detail-page">
        <HStack mb={4} justify="space-between" flexWrap="wrap" gap={3}>
          <Box>
            <NextLink href="/groups" passHref legacyBehavior>
              <Button as="a" variant="ghost" size="sm" mb={2}>
                ← {copy.groups.navLabel}
              </Button>
            </NextLink>
            {editingName ? (
              <HStack spacing={2} align="center">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                  maxLength={64}
                  size="lg"
                  autoFocus
                  bg="surfaceBg"
                  maxW="360px"
                  aria-label={copy.groups.createGroupNameLabel}
                  data-testid="rename-group-input"
                />
                <Button
                  size="sm"
                  onClick={() => void handleRename()}
                  isLoading={renaming}
                  isDisabled={!nameDraft.trim() || nameDraft.trim() === group.name}
                  aria-label={copy.groups.renameGroupSave}
                  data-testid="rename-group-save"
                >
                  ✓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelRename}
                  isDisabled={renaming}
                  aria-label={copy.groups.renameGroupCancel}
                  data-testid="rename-group-cancel"
                >
                  ✕
                </Button>
              </HStack>
            ) : (
              <HStack spacing={1} align="center">
                <Heading as="h1" size="xl">
                  {group.name}
                </Heading>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={startRename}
                    aria-label={copy.groups.renameGroupButton}
                    data-testid="rename-group-btn"
                  >
                    ✎
                  </Button>
                )}
              </HStack>
            )}
            <HStack mt={1} spacing={2}>
              <Badge colorScheme="brand" variant="subtle">
                {copy.groups.memberCount(memberCount)}
              </Badge>
              {memberCount >= 45 && (
                <Text fontSize="xs" color="textMuted">
                  {copy.groups.softLimitWarning}
                </Text>
              )}
            </HStack>
          </Box>
          <HStack spacing={2} flexWrap="wrap">
            <Button
              size="sm"
              onClick={inviteDisclosure.onOpen}
              isDisabled={!isAdmin}
              data-testid="invite-member-btn"
            >
              {copy.groups.inviteMember}
            </Button>
            <Button
              size="sm"
              onClick={inviteLinkDisclosure.onOpen}
              isDisabled={!isAdmin}
              data-testid="invite-link-btn"
            >
              {copy.groups.inviteLinkButton}
            </Button>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={manageLinksDisclosure.onOpen}
                data-testid="manage-links-btn"
              >
                {copy.groups.manageLinksButton}
              </Button>
            )}
            <LeaveGroupButton groupId={group.id} adminPubkeys={adminPubkeys} ownPubkeyHex={pubkeyHex} />
          </HStack>
        </HStack>

        <Divider mb={6} />

        <VStack spacing={6} align="stretch">
          {/* Pending Join Requests (admin-only) */}
          {isAdmin && <PendingRequestsSection groupId={group.id} />}

          {/* Members Section */}
          <Box>
            <Heading as="h2" size="md" mb={3}>
              {copy.groups.membersHeading}
            </Heading>
            {/* AC-GATE-3: onCancelInvite is an admin-only action */}
            <MemberList
              memberPubkeys={group.memberPubkeys}
              ownPubkeyHex={pubkeyHex}
              memberProfiles={profileMap}
              confirmedPubkeys={confirmedPubkeys}
              onCancelInvite={isAdmin ? onCancelInvite : undefined}
              adminPubkeys={adminPubkeys}
              isCurrentUserAdmin={isAdmin}
              onMakeAdmin={isAdmin ? handleMakeAdmin : undefined}
              pendingRemovalPubkeys={pendingRemovalPubkeys}
            />
          </Box>

          {/* Chat + Polls Section */}
          <Box>
            <HStack mb={3} justify="space-between">
              <Heading as="h2" size="md">
                {copy.groups.chatHeading}
              </Heading>
              <HStack spacing={2}>
                {/* Voice/video call icons — rendered only while the call
                    feature is enabled (CALLS_ENABLED); code retained when off. */}
                {CALLS_ENABLED && pubkeyHex && (
                  <GroupCallToolbar
                    groupId={group.id}
                    memberPubkeys={group.memberPubkeys}
                    ownPubkeyHex={pubkeyHex}
                  />
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setPollPanelOpen((v) => !v)}
                  data-testid="toggle-poll-panel-btn"
                >
                  {pollPanelOpen ? copy.polls.hidePolls : copy.polls.showPolls}
                </Button>
                <Button
                  size="xs"
                  onClick={pollDisclosure.onOpen}
                  data-testid="create-poll-btn"
                >
                  {copy.polls.pollButton}
                </Button>
              </HStack>
            </HStack>
            <ChatStoreProvider
              groupId={group.id}
              group={mlsGroup}
              pubkey={pubkeyHex ?? ''}
              privateKeyHex={privateKeyHex}
              signer={signer}
              chatVersion={chatVersion}
              reactionsVersion={reactionsVersion}
            >
              <ChatSendMessageCapture sendMessageRef={sendAnnouncementRef} />
              <PollStoreProvider
                groupId={group.id}
                group={mlsGroup}
                pubkey={pubkeyHex ?? ''}
                pollVersion={pollVersion}
              >
                <Flex gap={4} direction={{ base: 'column', md: 'row' }}>
                  <Box flex="1" minW={0}>
                    <GroupChat threadId={group.id} pubkey={pubkeyHex ?? ''} profileMap={profileMap} />
                  </Box>
                  {pollPanelOpen && (
                    <Box w={{ base: '100%', md: '280px' }} flexShrink={0}>
                      <PollPanel pubkey={pubkeyHex ?? ''} profileMap={profileMap} />
                    </Box>
                  )}
                </Flex>
                <CreatePollModal isOpen={pollDisclosure.isOpen} onClose={pollDisclosure.onClose} />
              </PollStoreProvider>
            </ChatStoreProvider>
          </Box>
        </VStack>
      </Box>

      <InviteMemberModal
        isOpen={inviteDisclosure.isOpen}
        onClose={inviteDisclosure.onClose}
        groupId={group.id}
      />

      <GenerateInviteLinkModal
        isOpen={inviteLinkDisclosure.isOpen}
        onClose={inviteLinkDisclosure.onClose}
        groupId={group.id}
        groupName={group.name}
      />

      <ManageInviteLinksModal
        isOpen={manageLinksDisclosure.isOpen}
        onClose={manageLinksDisclosure.onClose}
        groupId={group.id}
      />
    </>
  );
}

/* ---------- List view (default) ---------- */

export default function GroupsPage() {
  const router = useRouter();
  const id = router.query.id as string | undefined;
  const joinNonce = router.query.join as string | undefined;
  const joinAdmin = router.query.admin as string | undefined;
  const joinName = router.query.name as string | undefined;
  const copy = useCopy();
  const { groups, ready, unsupported } = useMarmot();
  const { backedUp } = useNostrIdentity();
  const createDisclosure = useDisclosure();

  // When ?join=xxx is present, show the join request card. Epic:
  // first-visit-invite-welcome, story S4 — the isFreshIdentity branch that
  // swaps in the blended WelcomeInvite (group variant) for a genuine
  // first-time visitor lives INSIDE JoinRequestCard itself (it already owns
  // the name-draft/send-guard state that variant reuses), not here; this
  // call site is unchanged from pre-S4.
  if (joinNonce && joinAdmin && joinName) {
    return <JoinRequestCard nonce={joinNonce} adminNpub={joinAdmin} groupName={joinName} />;
  }

  // When ?id=xxx is present, show the detail view
  if (id) {
    return <GroupDetailView id={id} />;
  }

  return (
    <>
      <Head>
        <title>{`${copy.groups.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="groups-page">
        {/* Offline indicator */}
        <OfflineBanner />

        {/* Backup reminder: only when user is in groups and hasn't backed up */}
        {ready && groups.length > 0 && !backedUp && (
          <BackupReminderBanner />
        )}

        <Box mb={6}>
          <Heading as="h1" size="xl" mb={4}>
            {copy.groups.heading}
          </Heading>

          {!unsupported && (
            <Button onClick={createDisclosure.onOpen} data-testid="create-group-btn">
              {copy.groups.createGroup}
            </Button>
          )}
        </Box>

        {unsupported && (
          <Alert
            status="warning"
            borderRadius="md"
            flexDirection="column"
            alignItems="flex-start"
            gap={2}
            data-testid="groups-https-required"
          >
            <AlertIcon />
            <Box>
              <Text fontWeight="semibold">{copy.groups.httpsRequired}</Text>
              <AlertDescription>
                <Text>{copy.groups.httpsRequiredBody}</Text>
              </AlertDescription>
            </Box>
          </Alert>
        )}

        {!ready && !unsupported && (
          <Box py={8} textAlign="center" color="textMuted">
            <Text>{copy.groups.loading}</Text>
          </Box>
        )}

        {/* AC-INVITE-7: PendingInvitations renders ABOVE joined-groups list */}
        {ready && !unsupported && <PendingInvitations />}

        {ready && groups.length === 0 && (
          <Alert
            status="info"
            borderRadius="md"
            flexDirection="column"
            alignItems="flex-start"
            gap={2}
            data-testid="groups-empty-state"
          >
            <AlertIcon />
            <Box>
              <Text fontWeight="semibold">{copy.groups.noGroups}</Text>
              <AlertDescription>
                <Text>{copy.groups.noGroupsBody}</Text>
              </AlertDescription>
            </Box>
          </Alert>
        )}

        {ready && groups.length > 0 && (
          <VStack spacing={3} align="stretch" data-testid="groups-list">
            {groups.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}
          </VStack>
        )}
      </Box>

      <CreateGroupModal
        isOpen={createDisclosure.isOpen}
        onClose={createDisclosure.onClose}
      />
    </>
  );
}
