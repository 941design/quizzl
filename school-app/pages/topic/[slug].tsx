import {
  Box,
  Heading,
  Text,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  HStack,
  Badge,
  Button,
} from '@chakra-ui/react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import type { GetStaticProps, GetStaticPaths } from 'next';
import NextLink from 'next/link';
import type { TopicCatalogue } from '@/src/types';
import { loadTopicCataloguesSync, TOPIC_SLUGS } from '@/src/lib/content';
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import { useTopicProgress } from '@/src/hooks/useTopicProgress';
import {
  answeredCount,
  calculateTotalPoints,
  maxPossiblePoints,
} from '@/src/lib/scoring';
import QuizTab from '@/src/components/quiz/QuizTab';
import NotesTab from '@/src/components/NotesTab';
import StudyPlanTab from '@/src/components/StudyPlanTab';
import StudyTimer from '@/src/components/StudyTimer';

type Props = {
  topicsByLanguage: TopicCatalogue;
};

export default function TopicPage({ topicsByLanguage }: Props) {
  const router = useRouter();
  const slug = (router.query.slug as string) ?? '';
  const { language } = useLanguage();
  const copy = useCopy();
  const topic =
    topicsByLanguage[language]?.find((entry) => entry.slug === slug) ??
    topicsByLanguage.en?.find((entry) => entry.slug === slug) ??
    null;

  const { progress, hydrated, recordAnswer, updateNotes, toggleTask, resetQuiz } = useTopicProgress(
    topic?.slug ?? slug
  );

  if (!topic) {
    return (
      <>
        <Head>
          <title>{`${copy.topicPage.notFoundTitle} - ${copy.appName}`}</title>
        </Head>
        <Box textAlign="center" py={16}>
          <Heading size="lg" mb={4}>{copy.topicPage.notFoundHeading}</Heading>
          <Text color="gray.600" mb={6}>
            {copy.topicPage.notFoundBody}
          </Text>
          <NextLink href="/topics" passHref legacyBehavior>
            <Button as="a" colorScheme="teal">{copy.topicPage.browseTopics}</Button>
          </NextLink>
        </Box>
      </>
    );
  }

  const answered = answeredCount(topic.quiz, progress.answers);
  const totalPoints = calculateTotalPoints(topic.quiz, progress.answers);
  const maxPoints = maxPossiblePoints(topic.quiz);

  return (
    <>
      <Head>
        <title>{`${topic.title} - ${copy.appName}`}</title>
      </Head>
      <Box>
        {/* Topic Header */}
        <Box mb={6}>
          {/* Session recovery / study timer controls */}
          <StudyTimer topicSlug={topic.slug} />

          <HStack mb={2} flexWrap="wrap" gap={2}>
            {topic.tags?.map((tag) => (
              <Badge key={tag} colorScheme="teal" variant="subtle">
                {tag}
              </Badge>
            ))}
          </HStack>
          <Heading as="h1" size="xl" mb={2}>
            {topic.title}
          </Heading>
          <Text color="gray.600" mb={4}>
            {topic.description}
          </Text>

          {/* Stats bar */}
          <HStack
            spacing={6}
            p={3}
            bg="gray.50"
            borderRadius="md"
            flexWrap="wrap"
            gap={3}
            data-testid="topic-stats"
          >
            <Text fontSize="sm" color="gray.600">
              {copy.topicPage.quizLabel}:{' '}
              <Text as="span" fontWeight="semibold">
                {hydrated ? copy.topicPage.answeredStat(answered, topic.quiz.length) : '—'}
              </Text>
            </Text>
            <Text fontSize="sm" color="gray.600">
              {copy.topicPage.pointsLabel}:{' '}
              <Text as="span" fontWeight="semibold" color="teal.600">
                {hydrated ? `${totalPoints}/${maxPoints}` : '—'}
              </Text>
            </Text>
          </HStack>
        </Box>

        {/* Tabs */}
        <Tabs colorScheme="teal" variant="line">
          <TabList>
            <Tab data-testid="tab-quiz">{copy.topicPage.tabs.quiz}</Tab>
            <Tab data-testid="tab-notes">{copy.topicPage.tabs.notes}</Tab>
            <Tab data-testid="tab-study-plan">{copy.topicPage.tabs.studyPlan}</Tab>
          </TabList>

          <TabPanels>
            {/* Quiz Tab */}
            <TabPanel px={0} pt={6}>
              <QuizTab
                topic={topic}
                answers={hydrated ? progress.answers : {}}
                onAnswer={(questionId, answer, newPoints) =>
                  recordAnswer(questionId, answer, newPoints)
                }
                onRetry={resetQuiz}
              />
            </TabPanel>

            {/* Notes Tab */}
            <TabPanel px={0} pt={6}>
              <NotesTab
                slug={topic.slug}
                notesHtml={hydrated ? progress.notesHtml : ''}
                onUpdate={updateNotes}
              />
            </TabPanel>

            {/* Study Plan Tab */}
            <TabPanel px={0} pt={6}>
              <StudyPlanTab
                studyPlan={topic.studyPlan}
                completedTaskIds={hydrated ? progress.completedTaskIds : []}
                onToggleTask={toggleTask}
              />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Box>
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: TOPIC_SLUGS.map((slug) => ({ params: { slug } })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  const topicsByLanguage = loadTopicCataloguesSync();
  return { props: { topicsByLanguage } };
};
