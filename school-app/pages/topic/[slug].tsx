import { Box, Heading, Text } from '@chakra-ui/react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function TopicPage() {
  const router = useRouter();
  const { slug } = router.query;

  return (
    <>
      <Head>
        <title>Topic - GroupLearn</title>
      </Head>
      <Box>
        <Heading as="h1" size="xl" mb={4}>Topic: {slug}</Heading>
        <Text color="gray.600">Quiz, Notes, and Study Plan tabs coming soon.</Text>
      </Box>
    </>
  );
}
