import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { useRouter } from 'next/router';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Heading,
  IconButton,
  LinkBox,
  LinkOverlay,
  Radio,
  RadioGroup,
  Text,
  VStack,
} from '@chakra-ui/react';
import ThemeIcon from '@/src/components/ThemeIcon';
import ProfileSummary from '@/src/components/ProfileSummary';
import ContactChat from '@/src/components/contacts/ContactChat';
import { MigrationNoticeBanner } from '@/src/components/contacts/MigrationNoticeBanner';
import { useCopy } from '@/src/context/LanguageContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useProfile } from '@/src/context/ProfileContext';
import { archiveContact, getContact, listContacts, unarchiveContact } from '@/src/lib/contacts';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import type { MemberProfile, UserProfile } from '@/src/types';

function ContactListView() {
  const copy = useCopy();
  const router = useRouter();
  const { pubkeyHex } = useNostrIdentity();
  const [showHidden, setShowHidden] = useState(false);
  const contacts = useMemo(
    () => listContacts(pubkeyHex, { includeArchived: showHidden }),
    [pubkeyHex, showHidden],
  );
  const hiddenCount = useMemo(
    () => listContacts(pubkeyHex, { includeArchived: true }).filter((contact) => contact.isArchived).length,
    [pubkeyHex],
  );
  const hasAnyContacts = contacts.length > 0 || hiddenCount > 0;

  return (
    <>
      <Head>
        <title>{`${copy.contacts.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="contacts-page">
        <MigrationNoticeBanner />
        <Box mb={6}>
          <Heading as="h1" size="xl" mb={2}>
            {copy.contacts.heading}
          </Heading>
          <Text color="textMuted">{copy.contacts.description}</Text>
        </Box>

        {!hasAnyContacts ? (
          <Alert
            status="info"
            borderRadius="md"
            flexDirection="column"
            alignItems="flex-start"
            gap={2}
            data-testid="contacts-empty-state"
          >
            <AlertIcon />
            <Box>
              <Text fontWeight="semibold">{copy.contacts.emptyTitle}</Text>
              <AlertDescription>
                <Text>{copy.contacts.emptyBody}</Text>
              </AlertDescription>
            </Box>
          </Alert>
        ) : contacts.length === 0 ? (
          <Alert status="info" borderRadius="md" data-testid="contacts-hidden-state">
            <AlertIcon />
            <AlertDescription>{copy.contacts.hiddenOnlyBody(hiddenCount)}</AlertDescription>
          </Alert>
        ) : (
          <VStack spacing={3} align="stretch" data-testid="contacts-list">
            {contacts.map((contact) => {
              const fallbackName = truncateNpub(pubkeyToNpub(contact.pubkeyHex));
              const profile: UserProfile = {
                nickname: contact.nickname,
                avatar: contact.avatar,
              };
              return (
                <LinkBox
                  as="article"
                  key={contact.pubkeyHex}
                  p={4}
                  borderWidth="1px"
                  borderRadius="lg"
                  borderColor="borderSubtle"
                  bg="surfaceBg"
                  cursor="pointer"
                  _hover={{ borderColor: 'brand.400', bg: 'surfaceMutedBg' }}
                  transition="all 0.15s"
                  data-testid={`contact-card-${contact.pubkeyHex}`}
                >
                  <Flex align="center" gap={3}>
                    <Box flex="1" minW={0}>
                      <NextLink href={`/contacts?id=${contact.pubkeyHex}`} passHref legacyBehavior>
                        <LinkOverlay>
                          <ProfileSummary profile={profile} fallbackName={fallbackName} size="sm" />
                        </LinkOverlay>
                      </NextLink>
                    </Box>
                    {contact.isArchived ? (
                      <Badge colorScheme="gray" flexShrink={0}>
                        {copy.contacts.hiddenBadge}
                      </Badge>
                    ) : null}
                    <IconButton
                      aria-label={copy.profile.viewProfile}
                      icon={<ThemeIcon name="person" size={18} />}
                      variant="ghost"
                      size="sm"
                      flexShrink={0}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        router.push(`/profile?pubkey=${contact.pubkeyHex}`);
                      }}
                    />
                  </Flex>
                </LinkBox>
              );
            })}
          </VStack>
        )}

        {hasAnyContacts ? (
          <Box mt={6} pt={4} borderTopWidth="1px" borderColor="borderSubtle">
            <Text mb={2} fontWeight="medium">
              {copy.contacts.hiddenFilterLabel}
            </Text>
            <RadioGroup
              value={showHidden ? 'show' : 'hide'}
              onChange={(value) => setShowHidden(value === 'show')}
            >
              <VStack align="start" spacing={2} data-testid="contacts-hidden-filter">
                <Radio value="hide" data-testid="contacts-filter-hide-hidden">
                  {copy.contacts.hideHiddenOption}
                </Radio>
                <Radio value="show" data-testid="contacts-filter-show-hidden">
                  {copy.contacts.showHiddenOption(hiddenCount)}
                </Radio>
              </VStack>
            </RadioGroup>
          </Box>
        ) : null}
      </Box>
    </>
  );
}

function ContactDetailView({ contactPubkeyHex }: { contactPubkeyHex: string }) {
  const copy = useCopy();
  const { pubkeyHex, privateKeyHex } = useNostrIdentity();
  const { profile: ownProfile } = useProfile();
  const [version, setVersion] = useState(0);
  const contact = useMemo(
    () => getContact(contactPubkeyHex, pubkeyHex, { includeArchived: true }),
    [contactPubkeyHex, pubkeyHex, version],
  );
  const signer = useMemo(
    () => (privateKeyHex ? createPrivateKeySigner(privateKeyHex) : null),
    [privateKeyHex],
  );

  if (!contact) {
    return (
      <Box data-testid="contact-detail-not-found">
        <Alert status="warning" borderRadius="md">
          <AlertIcon />
          <AlertDescription>
            {copy.contacts.contactNotFound}{' '}
            <NextLink href="/contacts" passHref legacyBehavior>
              <Button as="a" variant="link" size="sm">
                {copy.contacts.backToContacts}
              </Button>
            </NextLink>
          </AlertDescription>
        </Alert>
      </Box>
    );
  }

  if (!pubkeyHex || !privateKeyHex || !signer) {
    return null;
  }

  const fallbackName = truncateNpub(pubkeyToNpub(contact.pubkeyHex));
  const displayName = contact.nickname || fallbackName || copy.contacts.profileNameFallback;
  const profileMap: Record<string, MemberProfile> = {
    [pubkeyHex]: {
      pubkeyHex,
      nickname: ownProfile.nickname || truncateNpub(pubkeyToNpub(pubkeyHex)),
      avatar: ownProfile.avatar,
      updatedAt: new Date().toISOString(),
    },
    [contact.pubkeyHex]: {
      pubkeyHex: contact.pubkeyHex,
      nickname: contact.nickname || fallbackName,
      avatar: contact.avatar,
      updatedAt: contact.updatedAt ?? contact.lastSeenAt,
    },
  };

  return (
    <>
      <Head>
        <title>{`${displayName} - ${copy.contacts.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="contact-detail-page">
        <NextLink href="/contacts" passHref legacyBehavior>
          <Button as="a" variant="ghost" size="sm" mb={2}>
            ← {copy.contacts.backToContacts}
          </Button>
        </NextLink>
        <Flex align={{ base: 'start', md: 'center' }} justify="space-between" gap={3} wrap="wrap">
          <Box>
            <Heading as="h1" size="xl">
              {displayName}
            </Heading>
            <Text mt={1} color="textMuted" fontSize="sm">
              {truncateNpub(pubkeyToNpub(contact.pubkeyHex))}
            </Text>
          </Box>
          <Button
            size="sm"
            variant="outline"
            data-testid={contact.isArchived ? 'contact-detail-unarchive' : 'contact-detail-archive'}
            onClick={() => {
              if (contact.isArchived) {
                unarchiveContact(contact.pubkeyHex);
              } else {
                archiveContact(contact.pubkeyHex);
              }
              setVersion((current) => current + 1);
            }}
          >
            {contact.isArchived ? copy.contacts.unarchiveAction : copy.contacts.archiveAction}
          </Button>
        </Flex>
        {contact.isArchived ? (
          <Alert status="info" borderRadius="md" mt={4} data-testid="contact-archived-alert">
            <AlertIcon />
            <AlertDescription>{copy.contacts.archivedDetailNotice}</AlertDescription>
          </Alert>
        ) : null}

        <Divider my={6} />

        <Box>
          <ContactChat
            peerPubkeyHex={contact.pubkeyHex}
            pubkeyHex={pubkeyHex}
            privateKeyHex={privateKeyHex}
            signer={signer}
            profileMap={profileMap}
          />
        </Box>
      </Box>
    </>
  );
}

export default function ContactsPage() {
  const router = useRouter();
  const id = router.query.id as string | undefined;

  if (id) {
    return <ContactDetailView contactPubkeyHex={id} />;
  }

  return <ContactListView />;
}
