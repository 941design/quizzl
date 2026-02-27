import React, { useState, useEffect } from 'react';
import { Box, Heading, Text, Divider, VStack } from '@chakra-ui/react';
import Head from 'next/head';
import type { StudySession } from '@/src/types';
import { readStudyTimes } from '@/src/lib/storage';
import { loadAllTopicsSync } from '@/src/lib/content';
import type { GetStaticProps } from 'next';
import StudyTimeSummary from '@/src/components/StudyTimeSummary';
import SessionList from '@/src/components/SessionList';

type Props = {
  topicTitleBySlug: Record<string, string>;
};

export default function StudyTimesPage({ topicTitleBySlug }: Props) {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const data = readStudyTimes();
    setSessions(data.sessions);
    setHydrated(true);
  }, []);

  return (
    <>
      <Head>
        <title>Study Times - GroupLearn</title>
      </Head>
      <Box data-testid="study-times-page">
        <Heading as="h1" size="xl" mb={2}>
          Study Times
        </Heading>
        <Text color="gray.600" mb={6}>
          Track your study sessions and see your progress over time.
        </Text>

        {hydrated ? (
          <VStack spacing={6} align="stretch">
            {/* Summary stats */}
            <StudyTimeSummary sessions={sessions} />

            <Divider />

            {/* Session history */}
            <Box>
              <Heading as="h2" size="md" mb={4}>
                Recent Sessions
              </Heading>
              <SessionList
                sessions={sessions}
                topicTitleBySlug={topicTitleBySlug}
              />
            </Box>
          </VStack>
        ) : (
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
