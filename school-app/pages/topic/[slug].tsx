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
import type { Topic } from '@/src/types';
import { loadAllTopicsSync, TOPIC_SLUGS } from '@/src/lib/content';
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
  topic: Topic | null;
};

export default function TopicPage({ topic }: Props) {
  const router = useRouter();
  const slug = (router.query.slug as string) ?? '';

  const { progress, hydrated, recordAnswer, updateNotes, toggleTask, resetQuiz } = useTopicProgress(
    topic?.slug ?? slug
  );

  if (!topic) {
    return (
      <>
        <Head>
          <title>Topic Not Found - GroupLearn</title>
        </Head>
        <Box textAlign="center" py={16}>
          <Heading size="lg" mb={4}>Topic not found</Heading>
          <Text color="gray.600" mb={6}>
            This topic doesn&apos;t exist or failed to load.
          </Text>
          <NextLink href="/topics" passHref legacyBehavior>
            <Button as="a" colorScheme="teal">Browse Topics</Button>
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
        <title>{topic.title} - GroupLearn</title>
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
              Quiz:{' '}
              <Text as="span" fontWeight="semibold">
                {hydrated ? `${answered}/${topic.quiz.length} answered` : '—'}
              </Text>
            </Text>
            <Text fontSize="sm" color="gray.600">
              Points:{' '}
              <Text as="span" fontWeight="semibold" color="teal.600">
                {hydrated ? `${totalPoints}/${maxPoints}` : '—'}
              </Text>
            </Text>
          </HStack>
        </Box>

        {/* Tabs */}
        <Tabs colorScheme="teal" variant="line">
          <TabList>
            <Tab data-testid="tab-quiz">Quiz</Tab>
            <Tab data-testid="tab-notes">Notes</Tab>
            <Tab data-testid="tab-study-plan">Study Plan</Tab>
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
  const slug = params?.slug as string;
  const topics = loadAllTopicsSync();
  const topic = topics.find((t) => t.slug === slug) ?? null;
  return { props: { topic } };
};
