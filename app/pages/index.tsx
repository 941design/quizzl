import {
  Box,
  Heading,
  Text,
  Button,
  VStack,
  HStack,
  SimpleGrid,
} from '@chakra-ui/react';
import Head from 'next/head';
import NextLink from 'next/link';
import { useCopy } from '@/src/context/LanguageContext';
import ProfileSummary from '@/src/components/ProfileSummary';
import { useProfile } from '@/src/context/ProfileContext';

export default function HomePage() {
  const copy = useCopy();
  const { profile } = useProfile();

  return (
    <>
      <Head>
        <title>{`${copy.appName} - ${copy.home.title}`}</title>
        <meta name="description" content={copy.home.description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Box>
        <VStack spacing={8} textAlign="center" py={16}>
          <Heading as="h1" size="2xl">
            {copy.home.title}
          </Heading>
          <Text fontSize="xl" color="textMuted" maxW="600px">
            {copy.home.description}
          </Text>
          <HStack spacing={4}>
            <NextLink href="/topics" passHref legacyBehavior>
              <Button as="a" size="lg" data-testid="browse-topics-btn">
                {copy.home.browseTopics}
              </Button>
            </NextLink>
            <NextLink href="/settings" passHref legacyBehavior>
              <Button as="a" size="lg" variant="outline">
                {copy.home.settings}
              </Button>
            </NextLink>
          </HStack>
        </VStack>

        <Box p={6} mt={4} bg="surfaceBg" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="borderSubtle">
          <Text fontSize="sm" color="textMuted" mb={3}>
            {copy.home.profileCardTitle}
          </Text>
          <ProfileSummary
            profile={profile}
            fallbackName={copy.layout.profileFallbackName}
            showBadges={true}
          />
          <Text color="textMuted" mt={3}>
            {copy.home.profileCardBody}
          </Text>
        </Box>

        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6} mt={8}>
          <Box p={6} bg="surfaceBg" borderRadius="lg" shadow="sm" borderWidth="1px" borderColor="borderSubtle">
            <Heading size="md" mb={2}>{copy.home.featureQuiz}</Heading>
            <Text color="textMuted">
              {copy.home.featureQuizBody}
            </Text>
          </Box>
          <Box p={6} bg="surfaceBg" borderRadius="lg" shadow="sm" borderWidth="1px" borderColor="borderSubtle">
            <Heading size="md" mb={2}>{copy.home.featureNotes}</Heading>
            <Text color="textMuted">
              {copy.home.featureNotesBody}
            </Text>
          </Box>
          <Box p={6} bg="surfaceBg" borderRadius="lg" shadow="sm" borderWidth="1px" borderColor="borderSubtle">
            <Heading size="md" mb={2}>{copy.home.featurePlan}</Heading>
            <Text color="textMuted">
              {copy.home.featurePlanBody}
            </Text>
          </Box>
        </SimpleGrid>
      </Box>
    </>
  );
}
