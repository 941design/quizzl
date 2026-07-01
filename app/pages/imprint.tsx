import React from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { Box, Button, Heading, Link, Text, VStack } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { IMPRINT } from '@/src/config/imprint';

export default function ImprintPage() {
  const copy = useCopy();
  const t = copy.imprint;

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

        <VStack align="stretch" spacing={6}>
          <Box as="section">
            <Heading as="h2" size="sm" mb={2}>
              {t.providerHeading}
            </Heading>
            <Text>{IMPRINT.companyName}</Text>
            <Text>{IMPRINT.street}</Text>
            <Text>{IMPRINT.city}</Text>
            <Text>{IMPRINT.country}</Text>
          </Box>

          {IMPRINT.managingDirectors.length > 0 && (
            <Box as="section">
              <Heading as="h2" size="sm" mb={2}>
                {t.representedByLabel}
              </Heading>
              {IMPRINT.managingDirectors.map((name) => (
                <Text key={name}>{name}</Text>
              ))}
            </Box>
          )}

          {(IMPRINT.email || IMPRINT.phone) && (
            <Box as="section">
              <Heading as="h2" size="sm" mb={2}>
                {t.contactHeading}
              </Heading>
              {IMPRINT.email && (
                <Text>
                  {t.emailLabel}:{' '}
                  <Link href={`mailto:${IMPRINT.email}`} color="brand.500">
                    {IMPRINT.email}
                  </Link>
                </Text>
              )}
              {IMPRINT.phone && (
                <Text>
                  {t.phoneLabel}:{' '}
                  <Link href={`tel:${IMPRINT.phone.replace(/\s+/g, '')}`} color="brand.500">
                    {IMPRINT.phone}
                  </Link>
                </Text>
              )}
            </Box>
          )}

          <Box as="section">
            <Heading as="h2" size="sm" mb={2}>
              {t.registerHeading}
            </Heading>
            <Text>
              {t.registerCourtLabel}: {IMPRINT.registerCourt}
            </Text>
            <Text>
              {t.registerNumberLabel}: {IMPRINT.registerNumber}
            </Text>
          </Box>

          {IMPRINT.vatId && (
            <Box as="section">
              <Heading as="h2" size="sm" mb={2}>
                {t.vatHeading}
              </Heading>
              <Text color="textMuted" fontSize="sm" mb={1}>
                {t.vatLabel}
              </Text>
              <Text>{IMPRINT.vatId}</Text>
            </Box>
          )}
        </VStack>
      </Box>
    </>
  );
}
