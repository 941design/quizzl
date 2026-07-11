import React from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { Box, Button, Heading } from '@chakra-ui/react';
import Mustache from 'mustache';
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import { IMPRINT } from '@/src/config/imprint';
import Markdown from '@/src/components/Markdown';
import imprintEn from '@/src/content/imprint.en.md';
import imprintDe from '@/src/content/imprint.de.md';

const TEMPLATES = { en: imprintEn, de: imprintDe };

export default function ImprintPage() {
  const copy = useCopy();
  const { language } = useLanguage();
  const t = copy.imprint;

  // Legal facts stay single-sourced in IMPRINT; the per-language markdown
  // templates inject them. Empty fields (phone, VAT) drop out via mustache
  // `{{#field}}` sections — see src/content/imprint.*.md.
  const content = Mustache.render(TEMPLATES[language], {
    ...IMPRINT,
    hasDirectors: IMPRINT.managingDirectors.length > 0,
    managingDirectorsBlock: IMPRINT.managingDirectors.join('\\\n'),
    phoneTel: IMPRINT.phone.replace(/\s+/g, ''),
  });

  return (
    <>
      <Head>
        <title>{`${t.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="imprint-page" maxW="640px">
        <NextLink href="/" passHref legacyBehavior>
          <Button as="a" variant="ghost" size="sm" mb={2}>
            ←
          </Button>
        </NextLink>
        <Heading as="h1" size="xl" mb={6}>
          {t.heading}
        </Heading>

        <Markdown>{content}</Markdown>
      </Box>
    </>
  );
}
