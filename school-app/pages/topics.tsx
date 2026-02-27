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
import type { Topic } from '@/src/types';
import { loadAllTopicsSync } from '@/src/lib/content';
import { useSelectedTopics } from '@/src/hooks/useSelectedTopics';
import TopicCard from '@/src/components/TopicCard';
import StorageWarning from '@/src/components/StorageWarning';

type Props = {
  topics: Topic[];
};

export default function TopicsPage({ topics }: Props) {
  const { selectedSlugs, toggleTopic, isSelected, hydrated } = useSelectedTopics();

  const myTopics = topics.filter((t) => selectedSlugs.includes(t.slug));

  return (
    <>
      <Head>
        <title>Topics - GroupLearn</title>
      </Head>
      <Box>
        <StorageWarning />

        <Heading as="h1" size="xl" mb={2}>
          Topics
        </Heading>
        <Text color="gray.600" mb={6}>
          Select topics you want to learn. Your selections are saved automatically.
        </Text>

        <Tabs colorScheme="teal" variant="enclosed">
          <TabList>
            <Tab data-testid="tab-all-topics">All Topics ({topics.length})</Tab>
            <Tab data-testid="tab-my-topics">
              My Topics {hydrated ? `(${selectedSlugs.length})` : ''}
            </Tab>
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
                  <Text fontSize="lg" color="gray.500">
                    You haven&apos;t selected any topics yet.
                  </Text>
                  <Text color="gray.400">
                    Go to &quot;All Topics&quot; and click &quot;Select&quot; on any topic to get started.
                  </Text>
                  <NextLink href="/topics" passHref legacyBehavior>
                    <Button
                      as="a"
                      colorScheme="teal"
                      data-testid="pick-topics-cta"
                    >
                      Browse All Topics
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
  const topics = loadAllTopicsSync();
  return {
    props: { topics },
  };
};
