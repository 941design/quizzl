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

export default function HomePage() {
  return (
    <>
      <Head>
        <title>GroupLearn - Learn Together</title>
        <meta name="description" content="Group learning prototype with quiz, notes, and study plans" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Box>
        <VStack spacing={8} textAlign="center" py={16}>
          <Heading as="h1" size="2xl">
            Welcome to GroupLearn
          </Heading>
          <Text fontSize="xl" color="gray.600" maxW="600px">
            Learn with freely selectable topics. Combine quiz, notes, and study plans
            to master any subject at your own pace.
          </Text>
          <HStack spacing={4}>
            <NextLink href="/topics" passHref legacyBehavior>
              <Button as="a" size="lg" data-testid="browse-topics-btn">
                Browse Topics
              </Button>
            </NextLink>
            <NextLink href="/settings" passHref legacyBehavior>
              <Button as="a" size="lg" variant="outline">
                Settings
              </Button>
            </NextLink>
          </HStack>
        </VStack>

        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6} mt={8}>
          <Box p={6} bg="white" borderRadius="lg" shadow="sm" borderWidth="1px">
            <Heading size="md" mb={2}>Quiz &amp; Flashcards</Heading>
            <Text color="gray.600">
              Test your knowledge with single-choice, multi-choice, and flashcard questions.
            </Text>
          </Box>
          <Box p={6} bg="white" borderRadius="lg" shadow="sm" borderWidth="1px">
            <Heading size="md" mb={2}>Notes</Heading>
            <Text color="gray.600">
              Write rich formatted notes per topic. Auto-saved to your browser.
            </Text>
          </Box>
          <Box p={6} bg="white" borderRadius="lg" shadow="sm" borderWidth="1px">
            <Heading size="md" mb={2}>Study Plans</Heading>
            <Text color="gray.600">
              Follow structured study steps and track your daily progress.
            </Text>
          </Box>
        </SimpleGrid>
      </Box>
    </>
  );
}
