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
import MemberList from '@/src/components/groups/MemberList';
import MemberScoreRow from '@/src/components/groups/MemberScoreRow';
import InviteMemberModal from '@/src/components/groups/InviteMemberModal';
import LeaveGroupButton from '@/src/components/groups/LeaveGroupButton';
import type { Group, MemberScore } from '@/src/types';

export default function GroupDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const copy = useCopy();
  const { groups, ready, getMemberScores } = useMarmot();
  const { pubkeyHex } = useNostrIdentity();
  const inviteDisclosure = useDisclosure();
  const [group, setGroup] = useState<Group | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [memberScores, setMemberScores] = useState<MemberScore[]>([]);

  useEffect(() => {
    if (!ready || typeof id !== 'string') return;
    const found = groups.find((g) => g.id === id);
    if (found) {
      setGroup(found);
      // Load member scores for this group
      void getMemberScores(id).then(setMemberScores).catch(() => {});
    } else {
      setNotFound(true);
    }
  }, [ready, groups, id, getMemberScores]);

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
            />
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
