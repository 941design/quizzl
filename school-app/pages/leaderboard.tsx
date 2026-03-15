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
  const [totalPoints, setTotalPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [selectedCount, setSelectedCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);

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
              label={copy.leaderboard.youLabel}
              totalPoints={totalPoints}
              isYou={true}
            />

            <Divider />

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

        {!hydrated && (
          <Box py={8} textAlign="center" color="textMuted">
            <Text>{copy.leaderboard.loading}</Text>
          </Box>
        )}
      </Box>
    </>
  );
}
