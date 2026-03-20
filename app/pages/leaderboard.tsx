import React, { useState, useEffect } from 'react';
import {
  Box,
  Heading,
  Text,
  VStack,
  HStack,
  Badge,
  Divider,
  Alert,
  AlertIcon,
  AlertDescription,
} from '@chakra-ui/react';
import Head from 'next/head';
import NextLink from 'next/link';
import { Button } from '@chakra-ui/react';
import { readProgress, readSelectedTopics, readStudyTimes } from '@/src/lib/storage';
import { useCopy } from '@/src/context/LanguageContext';
import LeaderboardEntry from '@/src/components/LeaderboardEntry';
import ProfileSummary from '@/src/components/ProfileSummary';
import { useProfile } from '@/src/context/ProfileContext';
import { useMarmot } from '@/src/context/MarmotContext';
import MemberScoreRow from '@/src/components/groups/MemberScoreRow';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { truncateNpub } from '@/src/lib/nostrKeys';
import { totalPointsFromScores } from '@/src/lib/marmot/scoreSync';
import type { MemberScore, MemberProfile } from '@/src/types';

function calculateStreak(studyTimes: { sessions: { startedAt: string }[] }): number {
  const sessions = studyTimes.sessions;
  if (sessions.length === 0) return 0;

  // Get unique study days (YYYY-MM-DD)
  const studyDays = new Set(
    sessions.map((s) => s.startedAt.slice(0, 10))
  );

  // Count consecutive days ending today
  let streak = 0;
  const today = new Date();

  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);

    if (studyDays.has(key)) {
      streak++;
    } else if (i > 0) {
      // Gap — streak ends
      break;
    }
    // If i === 0 and today has no session, continue checking (streak may be from yesterday)
    else {
      // i === 0, today not in studyDays — check yesterday
      continue;
    }
  }

  return streak;
}

export default function LeaderboardPage() {
  const copy = useCopy();
  const { profile } = useProfile();
  const { groups, getMemberScores, getMemberProfiles, ready: marmotReady } = useMarmot();
  const { pubkeyHex, npub } = useNostrIdentity();
  const npubFallback = npub ? truncateNpub(npub) : copy.leaderboard.youLabel;
  const [totalPoints, setTotalPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [selectedCount, setSelectedCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  // Aggregated member scores across all groups (deduplicated by pubkeyHex)
  const [groupMemberScores, setGroupMemberScores] = useState<Array<{ score: MemberScore; groupName: string }>>([]);
  const [profileMap, setProfileMap] = useState<Record<string, MemberProfile>>({});

  useEffect(() => {
    const selected = readSelectedTopics();
    const progress = readProgress();
    const studyTimes = readStudyTimes();

    setSelectedCount(selected.slugs.length);

    // Aggregate points across selected topics
    const points = selected.slugs.reduce((sum, slug) => {
      const topicProgress = progress.byTopicSlug[slug];
      return sum + (topicProgress?.quizPoints ?? 0);
    }, 0);

    setTotalPoints(points);
    setStreak(calculateStreak(studyTimes));
    setHydrated(true);
  }, []);

  // Load group member scores when marmot is ready
  useEffect(() => {
    if (!marmotReady || groups.length === 0) return;

    async function loadGroupScores() {
      // Collect all member scores across groups, deduplicating by pubkeyHex
      const seen = new Set<string>();
      const results: Array<{ score: MemberScore; groupName: string }> = [];
      const profiles: Record<string, MemberProfile> = {};

      for (const group of groups) {
        try {
          const [scores, memberProfiles] = await Promise.all([
            getMemberScores(group.id),
            getMemberProfiles(group.id),
          ]);
          for (const p of memberProfiles) {
            if (!profiles[p.pubkeyHex]) profiles[p.pubkeyHex] = p;
          }
          for (const ms of scores) {
            if (ms.pubkeyHex === pubkeyHex) continue; // Skip self
            if (seen.has(ms.pubkeyHex)) continue;
            seen.add(ms.pubkeyHex);
            if (Object.keys(ms.scores).length > 0) {
              results.push({ score: ms, groupName: group.name });
            }
          }
        } catch {
          // Non-fatal
        }
      }

      // Sort by total points descending
      results.sort(
        (a, b) => totalPointsFromScores(b.score.scores) - totalPointsFromScores(a.score.scores)
      );
      setGroupMemberScores(results);
      setProfileMap(profiles);
    }

    void loadGroupScores();
  }, [marmotReady, groups, getMemberScores, getMemberProfiles, pubkeyHex]);

  return (
    <>
      <Head>
        <title>{`${copy.leaderboard.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="leaderboard-page">
        <Heading as="h1" size="xl" mb={2}>
          {copy.leaderboard.heading}
        </Heading>
        <Text color="textMuted" mb={6}>
          {copy.leaderboard.description}
        </Text>

        {hydrated && selectedCount === 0 && (
          <Alert status="info" borderRadius="md" mb={6} data-testid="leaderboard-no-topics">
            <AlertIcon />
            <AlertDescription>
              {copy.leaderboard.noTopics}{' '}
              <NextLink href="/topics" passHref legacyBehavior>
                <Button as="a" variant="link" size="sm">
                  {copy.leaderboard.browseTopics}
                </Button>
              </NextLink>
            </AlertDescription>
          </Alert>
        )}

        {hydrated && selectedCount > 0 && totalPoints === 0 && (
          <Alert status="info" borderRadius="md" mb={6} data-testid="leaderboard-no-points">
            <AlertIcon />
            <AlertDescription>
              {copy.leaderboard.noPoints}
            </AlertDescription>
          </Alert>
        )}

        {hydrated && (
          <VStack spacing={4} align="stretch">
            {/* Leaderboard entry */}
            <LeaderboardEntry
              rank={1}
              label={profile.nickname || npubFallback}
              totalPoints={totalPoints}
              isYou={true}
              profile={profile}
            />

            <Divider />

            <Box
              p={4}
              borderWidth="1px"
              borderRadius="lg"
              borderColor="borderSubtle"
              bg="surfaceBg"
            >
              <Text fontSize="sm" color="textMuted" mb={3}>
                {copy.leaderboard.profileHeading}
              </Text>
              <ProfileSummary
                profile={profile}
                fallbackName={npubFallback}
                showBadges={true}
              />
            </Box>

            {/* Stats row */}
            <HStack spacing={6} flexWrap="wrap" gap={3}>
              <Box>
                <Text fontSize="sm" color="textMuted">
                  {copy.leaderboard.totalPoints}
                </Text>
                <Text fontWeight="bold" fontSize="2xl" color="brand.600" data-testid="total-points">
                  {totalPoints}
                </Text>
              </Box>
              <Box>
                <Text fontSize="sm" color="textMuted">
                  {copy.leaderboard.rank}
                </Text>
                <Text fontWeight="bold" fontSize="2xl" data-testid="rank-display">
                  1 / 1
                </Text>
              </Box>
              <Box>
                <Text fontSize="sm" color="textMuted">
                  {copy.leaderboard.streak}
                </Text>
                <HStack spacing={1}>
                  <Text fontWeight="bold" fontSize="2xl" data-testid="streak-display">
                    {streak}
                  </Text>
                  <Text fontSize="sm" color="textMuted">
                    {streak === 1 ? copy.leaderboard.streakDay : copy.leaderboard.streakDays}
                  </Text>
                  {streak > 0 && (
                    <Badge colorScheme="warning" variant="solid" fontSize="xs">
                      {copy.leaderboard.onARoll}
                    </Badge>
                  )}
                </HStack>
              </Box>
              <Box>
                <Text fontSize="sm" color="textMuted">
                  {copy.leaderboard.topicsSelected}
                </Text>
                <Text fontWeight="bold" fontSize="2xl" data-testid="topics-selected">
                  {selectedCount}
                </Text>
              </Box>
            </HStack>
          </VStack>
        )}

        {/* Group Members Section */}
        {hydrated && groupMemberScores.length > 0 && (
          <Box mt={6}>
            <Divider mb={4} />
            <Heading as="h2" size="md" mb={3}>
              {copy.groups.memberScoresHeading}
            </Heading>
            <VStack spacing={2} align="stretch" data-testid="group-members-leaderboard">
              {groupMemberScores.map(({ score, groupName }, idx) => (
                <Box key={score.pubkeyHex}>
                  <MemberScoreRow
                    memberScore={score}
                    rank={idx + 2}
                    avatar={profileMap[score.pubkeyHex]?.avatar}
                    profileNickname={profileMap[score.pubkeyHex]?.nickname}
                  />
                  <Text fontSize="xs" color="textMuted" pl={2} mt={0.5}>
                    {copy.groups.fromGroup(groupName)}
                  </Text>
                </Box>
              ))}
            </VStack>
          </Box>
        )}

        {!hydrated && (
          <Box py={8} textAlign="center" color="textMuted">
            <Text>{copy.leaderboard.loading}</Text>
          </Box>
        )}
      </Box>
    </>
  );
}
