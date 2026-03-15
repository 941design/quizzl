import React, { useState, useEffect } from 'react';
import { Box, Heading, Text, Divider, VStack } from '@chakra-ui/react';
import Head from 'next/head';
import type { StudySession, TopicCatalogue } from '@/src/types';
import { readStudyTimes } from '@/src/lib/storage';
import { loadTopicCataloguesSync } from '@/src/lib/content';
import type { GetStaticProps } from 'next';
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import StudyTimeSummary from '@/src/components/StudyTimeSummary';
import SessionList from '@/src/components/SessionList';

type Props = {
  topicsByLanguage: TopicCatalogue;
};

export default function StudyTimesPage({ topicsByLanguage }: Props) {
  const { language } = useLanguage();
  const copy = useCopy();
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const topicTitleBySlug = Object.fromEntries(
    (topicsByLanguage[language] ?? topicsByLanguage.en).map((topic) => [topic.slug, topic.title])
  );

  useEffect(() => {
    const data = readStudyTimes();
    setSessions(data.sessions);
    setHydrated(true);
  }, []);

  return (
    <>
      <Head>
        <title>{`${copy.studyTimes.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="study-times-page">
        <Heading as="h1" size="xl" mb={2}>
          {copy.studyTimes.heading}
        </Heading>
        <Text color="gray.600" mb={6}>
          {copy.studyTimes.description}
        </Text>

        {hydrated ? (
          <VStack spacing={6} align="stretch">
            {/* Summary stats */}
            <StudyTimeSummary sessions={sessions} />

            <Divider />

            {/* Session history */}
            <Box>
              <Heading as="h2" size="md" mb={4}>
                {copy.studyTimes.recentSessions}
              </Heading>
              <SessionList
                sessions={sessions}
                topicTitleBySlug={topicTitleBySlug}
              />
            </Box>
          </VStack>
        ) : (
          <Box py={8} textAlign="center" color="gray.400">
            <Text>{copy.studyTimes.loading}</Text>
          </Box>
        )}
      </Box>
    </>
  );
}

export const getStaticProps: GetStaticProps<Props> = async () => {
  const topicsByLanguage = loadTopicCataloguesSync();
  return { props: { topicsByLanguage } };
};
