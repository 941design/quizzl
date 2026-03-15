import {
  Box,
  Heading,
  Text,
  SimpleGrid,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  VStack,
  Button,
} from '@chakra-ui/react';
import Head from 'next/head';
import type { GetStaticProps } from 'next';
import NextLink from 'next/link';
import type { TopicCatalogue } from '@/src/types';
import { loadTopicCataloguesSync } from '@/src/lib/content';
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import { useSelectedTopics } from '@/src/hooks/useSelectedTopics';
import TopicCard from '@/src/components/TopicCard';
import StorageWarning from '@/src/components/StorageWarning';

type Props = {
  topicsByLanguage: TopicCatalogue;
};

export default function TopicsPage({ topicsByLanguage }: Props) {
  const { language } = useLanguage();
  const copy = useCopy();
  const { selectedSlugs, toggleTopic, isSelected, hydrated } = useSelectedTopics();
  const topics = topicsByLanguage[language] ?? topicsByLanguage.en;

  const myTopics = topics.filter((t) => selectedSlugs.includes(t.slug));

  return (
    <>
      <Head>
        <title>{`${copy.topics.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box>
        <StorageWarning />

        <Heading as="h1" size="xl" mb={2}>
          {copy.topics.heading}
        </Heading>
        <Text color="textMuted" mb={6}>
          {copy.topics.description}
        </Text>

        <Tabs variant="enclosed">
          <TabList>
            <Tab data-testid="tab-all-topics">{copy.topics.allTopics(topics.length)}</Tab>
            <Tab data-testid="tab-my-topics">{copy.topics.myTopics(hydrated ? selectedSlugs.length : undefined)}</Tab>
          </TabList>

          <TabPanels>
            {/* All Topics */}
            <TabPanel px={0} pt={6}>
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {topics.map((topic) => (
                  <TopicCard
                    key={topic.slug}
                    topic={topic}
                    isSelected={hydrated ? isSelected(topic.slug) : false}
                    onToggle={toggleTopic}
                  />
                ))}
              </SimpleGrid>
            </TabPanel>

            {/* My Topics */}
            <TabPanel px={0} pt={6}>
              {!hydrated ? null : myTopics.length === 0 ? (
                <VStack spacing={4} py={12} textAlign="center">
                  <Text fontSize="lg" color="textMuted">
                    {copy.topics.emptyHeading}
                  </Text>
                  <Text color="textMuted">
                    {copy.topics.emptyBody}
                  </Text>
                  <NextLink href="/topics" passHref legacyBehavior>
                    <Button
                      as="a"
                      data-testid="pick-topics-cta"
                    >
                      {copy.topics.browseAll}
                    </Button>
                  </NextLink>
                </VStack>
              ) : (
                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                  {myTopics.map((topic) => (
                    <TopicCard
                      key={topic.slug}
                      topic={topic}
                      isSelected
                      onToggle={toggleTopic}
                    />
                  ))}
                </SimpleGrid>
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Box>
    </>
  );
}

export const getStaticProps: GetStaticProps<Props> = async () => {
  const topicsByLanguage = loadTopicCataloguesSync();
  return {
    props: { topicsByLanguage },
  };
};
