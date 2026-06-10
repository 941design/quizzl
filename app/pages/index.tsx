import {
  Box,
  Heading,
  Text,
  Button,
  VStack,
  HStack,
} from '@chakra-ui/react';
import Head from 'next/head';
import NextLink from 'next/link';
import { useCopy } from '@/src/context/LanguageContext';
import ProfileSummary from '@/src/components/ProfileSummary';
import { useProfile } from '@/src/context/ProfileContext';
import { useThemeStyles } from '@/src/hooks/useThemeStyles';

export default function HomePage() {
  const copy = useCopy();
  const { profile } = useProfile();
  const { cardStyle } = useThemeStyles();

  return (
    <>
      <Head>
        <title>{`${copy.appName} - ${copy.home.title}`}</title>
        <meta name="description" content={copy.home.description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Box>
        <VStack spacing={8} textAlign="center" py={16}>
          <Heading as="h1" size="2xl">
            {copy.home.title}
          </Heading>
          <Text fontSize="xl" color="textMuted" maxW="600px">
            {copy.home.description}
          </Text>
          <HStack spacing={4}>
            <NextLink href="/contacts" passHref legacyBehavior>
              <Button as="a" size="lg" data-testid="home-contacts-btn">
                {copy.home.openContacts}
              </Button>
            </NextLink>
            <NextLink href="/groups" passHref legacyBehavior>
              <Button as="a" size="lg" variant="outline" data-testid="home-groups-btn">
                {copy.home.openGroups}
              </Button>
            </NextLink>
            <NextLink href="/settings" passHref legacyBehavior>
              <Button as="a" size="lg" variant="ghost">
                {copy.home.settings}
              </Button>
            </NextLink>
          </HStack>
        </VStack>

        <Box p={6} mt={4} bg="surfaceBg" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="borderSubtle" {...cardStyle}>
          <Text fontSize="sm" color="textMuted" mb={3}>
            {copy.home.profileCardTitle}
          </Text>
          <ProfileSummary
            profile={profile}
            fallbackName={copy.layout.profileFallbackName}
          />
          <Text color="textMuted" mt={3}>
            {copy.home.profileCardBody}
          </Text>
        </Box>
      </Box>
    </>
  );
}
