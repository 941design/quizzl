import { Box, Heading, Text } from '@chakra-ui/react';
import Head from 'next/head';

export default function TopicsPage() {
  return (
    <>
      <Head>
        <title>Topics - GroupLearn</title>
      </Head>
      <Box>
        <Heading as="h1" size="xl" mb={4}>Topics</Heading>
        <Text color="gray.600">Browse and select topics to learn. Coming soon.</Text>
      </Box>
    </>
  );
}
