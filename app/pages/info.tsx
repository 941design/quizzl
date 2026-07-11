import React from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { Box, Button, Heading } from '@chakra-ui/react';
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import Markdown from '@/src/components/Markdown';
import infoEn from '@/src/content/info.en.md';
import infoDe from '@/src/content/info.de.md';

const CONTENT = { en: infoEn, de: infoDe };

export default function InfoPage() {
  const copy = useCopy();
  const { language } = useLanguage();
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

        <Markdown>{CONTENT[language].trim()}</Markdown>
      </Box>
    </>
  );
}
