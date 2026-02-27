import { Box, Heading, Text } from '@chakra-ui/react';
import Head from 'next/head';

export default function LeaderboardPage() {
  return (
    <>
      <Head>
        <title>Leaderboard - GroupLearn</title>
      </Head>
      <Box>
        <Heading as="h1" size="xl" mb={4}>Leaderboard</Heading>
        <Text color="gray.600">Your learning progress overview. Coming soon.</Text>
      </Box>
    </>
  );
}
