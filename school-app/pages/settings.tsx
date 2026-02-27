import { Box, Heading, Text } from '@chakra-ui/react';
import Head from 'next/head';

export default function SettingsPage() {
  return (
    <>
      <Head>
        <title>Settings - GroupLearn</title>
      </Head>
      <Box>
        <Heading as="h1" size="xl" mb={4}>Settings</Heading>
        <Text color="gray.600">Mood theme and data reset options. Coming soon.</Text>
      </Box>
    </>
  );
}
