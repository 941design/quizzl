import React, { useEffect, useState } from 'react';
import {
  Box,
  Heading,
  Text,
  VStack,
  HStack,
  Button,
  Divider,
  Badge,
  Alert,
  AlertIcon,
  AlertDescription,
  useDisclosure,
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
import MemberScoreRow from '@/src/components/groups/MemberScoreRow';
import InviteMemberModal from '@/src/components/groups/InviteMemberModal';
import LeaveGroupButton from '@/src/components/groups/LeaveGroupButton';
import GroupChat from '@/src/components/groups/GroupChat';
import { ChatStoreProvider } from '@/src/context/ChatStoreContext';
import type { Group, MemberScore, MemberProfile } from '@/src/types';

/* ---------- Detail view (shown when ?id=xxx is present) ---------- */

type MarmotGroupType = import('@internet-privacy/marmot-ts').MarmotGroup;

function GroupDetailView({ id }: { id: string }) {
  const copy = useCopy();
  const { groups, ready, getMemberScores, getMemberProfiles, getGroup: getMarmotGroup } = useMarmot();
  const { pubkeyHex } = useNostrIdentity();
  const { profile: ownProfile } = useProfile();
  const inviteDisclosure = useDisclosure();
  const [group, setGroup] = useState<Group | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [memberScores, setMemberScores] = useState<MemberScore[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, MemberProfile>>({});
  const [mlsGroup, setMlsGroup] = useState<MarmotGroupType | null>(null);

  useEffect(() => {
    if (!ready) return;
    const found = groups.find((g) => g.id === id);
    if (found) {
      setGroup(found);
      void getMarmotGroup(id).then(setMlsGroup).catch(() => {});
      void getMemberScores(id).then(setMemberScores).catch(() => {});
      void getMemberProfiles(id).then((profiles) => {
        const map: Record<string, MemberProfile> = {};
        for (const p of profiles) map[p.pubkeyHex] = p;

        // Fill gaps from the global contact cache (known from other groups)
        const contactCache = readContactCache();
        for (const pk of found.memberPubkeys) {
          if (!map[pk] && contactCache[pk]?.nickname) {
            map[pk] = {
              pubkeyHex: pk,
              nickname: contactCache[pk].nickname,
              avatar: contactCache[pk].avatar,
              badgeIds: [],
              updatedAt: contactCache[pk].updatedAt,
            };
          }
        }

        // Always overlay own profile from ProfileContext (never depends on MLS)
        if (pubkeyHex && ownProfile.nickname) {
          map[pubkeyHex] = {
            pubkeyHex,
            nickname: ownProfile.nickname,
            avatar: ownProfile.avatar,
            badgeIds: ownProfile.badgeIds,
            updatedAt: new Date().toISOString(),
          };
        }

        setProfileMap(map);
      }).catch(() => {});
    } else {
      setNotFound(true);
    }
  }, [ready, groups, id, getMemberScores, getMemberProfiles, pubkeyHex, ownProfile]);

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
            Group not found.{' '}
            <NextLink href="/groups" passHref legacyBehavior>
              <Button as="a" variant="link" size="sm">
                Back to Groups
              </Button>
            </NextLink>
          </AlertDescription>
        </Alert>
      </Box>
    );
  }

  if (!group) return null;

  const memberCount = group.memberPubkeys.length;

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
            <Heading as="h1" size="xl">
              {group.name}
            </Heading>
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
              data-testid="invite-member-btn"
            >
              {copy.groups.inviteMember}
            </Button>
            <LeaveGroupButton groupId={group.id} />
          </HStack>
        </HStack>

        <Divider mb={6} />

        <VStack spacing={6} align="stretch">
          {/* Members Section */}
          <Box>
            <Heading as="h2" size="md" mb={3}>
              Members
            </Heading>
            <MemberList
              memberPubkeys={group.memberPubkeys}
              ownPubkeyHex={pubkeyHex}
              memberProfiles={profileMap}
            />
          </Box>

          {/* Chat Section */}
          <Box>
            <Heading as="h2" size="md" mb={3}>
              Chat
            </Heading>
            <ChatStoreProvider
              groupId={group.id}
              group={mlsGroup}
              pubkey={pubkeyHex ?? ''}
            >
              <GroupChat pubkey={pubkeyHex ?? ''} profileMap={profileMap} />
            </ChatStoreProvider>
          </Box>

          {/* Member Scores Section */}
          {memberScores.length > 0 && (
            <Box>
              <Heading as="h2" size="md" mb={3}>
                {copy.groups.memberScoresHeading}
              </Heading>
              <VStack spacing={2} align="stretch">
                {memberScores
                  .slice()
                  .sort((a, b) => {
                    const aPoints = Object.values(a.scores).reduce((s, sc) => s + sc.quizPoints, 0);
                    const bPoints = Object.values(b.scores).reduce((s, sc) => s + sc.quizPoints, 0);
                    return bPoints - aPoints;
                  })
                  .map((ms, idx) => (
                    <MemberScoreRow
                      key={ms.pubkeyHex}
                      memberScore={ms}
                      isYou={ms.pubkeyHex === pubkeyHex}
                      rank={idx + 1}
                      avatar={profileMap[ms.pubkeyHex]?.avatar}
                      profileNickname={profileMap[ms.pubkeyHex]?.nickname}
                    />
                  ))}
              </VStack>
            </Box>
          )}

          {/* Group ID (for debugging) */}
          <Box>
            <Text fontSize="xs" color="textMuted">
              Group ID: {group.id.slice(0, 16)}...
            </Text>
          </Box>
        </VStack>
      </Box>

      <InviteMemberModal
        isOpen={inviteDisclosure.isOpen}
        onClose={inviteDisclosure.onClose}
        groupId={group.id}
      />
    </>
  );
}

/* ---------- List view (default) ---------- */

export default function GroupsPage() {
  const router = useRouter();
  const id = router.query.id as string | undefined;
  const copy = useCopy();
  const { groups, ready, unsupported } = useMarmot();
  const { backedUp } = useNostrIdentity();
  const createDisclosure = useDisclosure();

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
          <Heading as="h1" size="xl" mb={2}>
            {copy.groups.heading}
          </Heading>
          <Text color="textMuted" mb={4}>
            {copy.groups.description}
          </Text>

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
