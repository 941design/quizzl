import { Box, Heading, Text } from '@chakra-ui/react';
import Head from 'next/head';

export default function StudyTimesPage() {
  return (
    <>
      <Head>
        <title>Study Times - GroupLearn</title>
      </Head>
      <Box>
        <Heading as="h1" size="xl" mb={4}>Shared Study Times</Heading>
        <Text color="gray.600">Your study sessions and group study times. Coming soon.</Text>
      </Box>
    </>
  );
}
