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
import type { GetStaticProps } from 'next';
import { loadAllTopicsSync } from '@/src/lib/content';
import LeaderboardEntry from '@/src/components/LeaderboardEntry';

type Props = {
  topicTitleBySlug: Record<string, string>;
};

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

export default function LeaderboardPage({ topicTitleBySlug }: Props) {
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
        <title>Leaderboard - GroupLearn</title>
      </Head>
      <Box data-testid="leaderboard-page">
        <Heading as="h1" size="xl" mb={2}>
          Leaderboard
        </Heading>
        <Text color="gray.600" mb={6}>
          Your learning progress. Keep studying to climb the ranks!
        </Text>

        {hydrated && selectedCount === 0 && (
          <Alert status="info" borderRadius="md" mb={6} data-testid="leaderboard-no-topics">
            <AlertIcon />
            <AlertDescription>
              Select some topics to track your quiz points.{' '}
              <NextLink href="/topics" passHref legacyBehavior>
                <Button as="a" variant="link" colorScheme="teal" size="sm">
                  Browse Topics
                </Button>
              </NextLink>
            </AlertDescription>
          </Alert>
        )}

        {hydrated && selectedCount > 0 && totalPoints === 0 && (
          <Alert status="info" borderRadius="md" mb={6} data-testid="leaderboard-no-points">
            <AlertIcon />
            <AlertDescription>
              Complete some quiz questions to earn points and appear on the leaderboard.
            </AlertDescription>
          </Alert>
        )}

        {hydrated && (
          <VStack spacing={4} align="stretch">
            {/* Leaderboard entry */}
            <LeaderboardEntry
              rank={1}
              label="You (1/1)"
              totalPoints={totalPoints}
              isYou={true}
            />

            <Divider />

            {/* Stats row */}
            <HStack spacing={6} flexWrap="wrap" gap={3}>
              <Box>
                <Text fontSize="sm" color="gray.500">
                  Total Points
                </Text>
                <Text fontWeight="bold" fontSize="2xl" color="teal.600" data-testid="total-points">
                  {totalPoints}
                </Text>
              </Box>
              <Box>
                <Text fontSize="sm" color="gray.500">
                  Rank
                </Text>
                <Text fontWeight="bold" fontSize="2xl" data-testid="rank-display">
                  1 / 1
                </Text>
              </Box>
              <Box>
                <Text fontSize="sm" color="gray.500">
                  Study Streak
                </Text>
                <HStack spacing={1}>
                  <Text fontWeight="bold" fontSize="2xl" data-testid="streak-display">
                    {streak}
                  </Text>
                  <Text fontSize="sm" color="gray.500">
                    {streak === 1 ? 'day' : 'days'}
                  </Text>
                  {streak > 0 && (
                    <Badge colorScheme="orange" variant="solid" fontSize="xs">
                      On a roll!
                    </Badge>
                  )}
                </HStack>
              </Box>
              <Box>
                <Text fontSize="sm" color="gray.500">
                  Topics Selected
                </Text>
                <Text fontWeight="bold" fontSize="2xl" data-testid="topics-selected">
                  {selectedCount}
                </Text>
              </Box>
            </HStack>
          </VStack>
        )}

        {!hydrated && (
          <Box py={8} textAlign="center" color="gray.400">
            <Text>Loading...</Text>
          </Box>
        )}
      </Box>
    </>
  );
}

export const getStaticProps: GetStaticProps<Props> = async () => {
  const topics = loadAllTopicsSync();
  const topicTitleBySlug: Record<string, string> = {};
  topics.forEach((t) => {
    topicTitleBySlug[t.slug] = t.title;
  });
  return { props: { topicTitleBySlug } };
};
