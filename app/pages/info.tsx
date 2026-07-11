import React from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { Box, Button, Collapse, Heading, useDisclosure } from '@chakra-ui/react';
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import Markdown from '@/src/components/Markdown';
import infoEn from '@/src/content/info.en.md';
import infoDe from '@/src/content/info.de.md';

const CONTENT = { en: infoEn, de: infoDe };
const TECH_MARKER = '<!-- technical-details -->';

export default function InfoPage() {
  const copy = useCopy();
  const { language } = useLanguage();
  const t = copy.info;
  const { isOpen, onToggle } = useDisclosure();

  const [main, tech = ''] = CONTENT[language].split(TECH_MARKER);

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

        <Markdown>{main.trim()}</Markdown>

        <Box as="section" pt={2}>
          <Button
            variant="ghost"
            size="sm"
            px={0}
            onClick={onToggle}
            aria-expanded={isOpen}
            data-testid="info-tech-toggle"
          >
            {isOpen ? '▾' : '▸'} {t.techToggle}
          </Button>
          <Collapse in={isOpen} animateOpacity>
            <Box pt={3} data-testid="info-tech-details">
              <Markdown>{tech.trim()}</Markdown>
            </Box>
          </Collapse>
        </Box>
      </Box>
    </>
  );
}
