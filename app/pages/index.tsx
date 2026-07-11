import {
  Box,
  Heading,
  Text,
  VStack,
  SimpleGrid,
  LinkBox,
  LinkOverlay,
  UnorderedList,
  ListItem,
} from '@chakra-ui/react';
import Head from 'next/head';
import NextLink from 'next/link';
import { useCopy } from '@/src/context/LanguageContext';
import { useThemeStyles } from '@/src/hooks/useThemeStyles';

export default function HomePage() {
  const copy = useCopy();
  const { cardStyle } = useThemeStyles();

  const tiles = [
    {
      href: '/contacts',
      title: copy.home.contactsTitle,
      subtitle: copy.home.contactsSubtitle,
      testid: 'home-contacts-btn',
    },
    {
      href: '/groups',
      title: copy.home.groupsTitle,
      subtitle: copy.home.groupsSubtitle,
      testid: 'home-groups-btn',
    },
    {
      href: '/profile',
      title: copy.home.profileTitle,
      subtitle: copy.home.profileSubtitle,
      testid: 'home-profile-btn',
    },
    {
      href: '/info',
      title: copy.home.howTitle,
      subtitle: copy.home.howSubtitle,
      testid: 'home-info-btn',
    },
  ];

  return (
    <>
      <Head>
        <title>{`${copy.appName} - ${copy.home.title}`}</title>
        <meta name="description" content={copy.home.description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Box>
        <VStack spacing={8} py={16}>
          <Heading as="h1" size="2xl" textAlign="center">
            {copy.home.title}
          </Heading>
          <VStack spacing={3} maxW="600px" data-testid="home-subheading">
            <Heading as="h2" size="lg" textAlign="center">
              {copy.home.subheadingLead}
            </Heading>
            <UnorderedList spacing={3}>
              {copy.home.subheadingPoints.map((point) => (
                <ListItem key={point} color="textMuted" fontSize="lg">
                  {point}
                </ListItem>
              ))}
            </UnorderedList>
          </VStack>
          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={6} w="full">
            {tiles.map((tile) => (
              <LinkBox
                key={tile.href}
                as="article"
                p={6}
                bg="surfaceBg"
                borderRadius="xl"
                shadow="sm"
                borderWidth="1px"
                borderColor="borderSubtle"
                transition="all 0.15s ease"
                _hover={{ shadow: 'md', transform: 'translateY(-2px)' }}
                {...cardStyle}
              >
                <Heading as="h2" size="md" mb={2}>
                  <NextLink href={tile.href} passHref legacyBehavior>
                    <LinkOverlay data-testid={tile.testid}>{tile.title}</LinkOverlay>
                  </NextLink>
                </Heading>
                <Text color="textMuted">{tile.subtitle}</Text>
              </LinkBox>
            ))}
          </SimpleGrid>
        </VStack>
      </Box>
    </>
  );
}
