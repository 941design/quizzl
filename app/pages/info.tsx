import React from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { Box, Button, Heading, Text } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';

export default function InfoPage() {
  const copy = useCopy();
  const t = copy.info;

  return (
    <>
      <Head>
        <title>{`${t.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="info-page" maxW="640px">
        <NextLink href="/" passHref legacyBehavior>
          <Button as="a" variant="ghost" size="sm" mb={2}>
            ←
          </Button>
        </NextLink>
        <Heading as="h1" size="xl" mb={6}>
          {t.heading}
        </Heading>
        <Text>{t.body}</Text>
      </Box>
    </>
  );
}
