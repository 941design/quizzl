import React, { useEffect, useMemo, useState } from 'react';
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
  HStack,
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
// Voice/video calls temporarily disabled — icons commented out, feature code retained.
// import { ContactCallToolbar } from '@/src/components/calls/CallToolbar';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useProfile } from '@/src/context/ProfileContext';
import { commonGroups, getContact, listContacts, rememberContactsFromGroups } from '@/src/lib/contacts';
import { isMaintainerPubkey } from '@/src/config/maintainer';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { directConversationId } from '@/src/lib/directMessages';
import { loadMessages } from '@/src/lib/marmot/chatPersistence';
import { formatThreadPreviewText } from '@/src/lib/messageEdits/messageActionUi';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import type { MemberProfile, UserProfile } from '@/src/types';

/**
 * S6 (epic-feature-request-message-edit-and-delete): AC-LIST-1/AC-LIST-2 —
 * the contact list preview reflects an edit to the thread's last message and
 * falls back past a deleted last message (or to the empty state). A small
 * subcomponent (rather than an inline effect inside the parent's `.map()`)
 * so each card's async load obeys the Rules of Hooks. Loaded once per mount,
 * same relaxation as GroupCard's preview — see its comment.
 */
function ContactCardPreview({ peerPubkeyHex }: { peerPubkeyHex: string }) {
  const copy = useCopy();
  const [previewText, setPreviewText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const threadId = directConversationId(peerPubkeyHex);
    loadMessages(threadId)
      .then(({ messages }) => {
        if (cancelled) return;
        setPreviewText(formatThreadPreviewText(messages, {
          emptyText: copy.groups.listPreviewEmpty,
          photoText: copy.groups.listPreviewPhoto,
          structuredText: copy.groups.listPreviewStructured,
        }));
      })
      .catch(() => {
        if (!cancelled) setPreviewText(null);
      });
    return () => {
      cancelled = true;
    };
  }, [peerPubkeyHex, copy.groups.listPreviewEmpty, copy.groups.listPreviewPhoto, copy.groups.listPreviewStructured]);

  if (previewText === null) return null;
  return (
    <Text
      mt={1}
      fontSize="xs"
      color="textMuted"
      noOfLines={1}
      data-testid={`contact-card-preview-${peerPubkeyHex}`}
    >
      {previewText}
    </Text>
  );
}

function ContactListView() {
  const copy = useCopy();
  const router = useRouter();
  const { pubkeyHex } = useNostrIdentity();
  const { groups, ready } = useMarmot();
  const [showHidden, setShowHidden] = useState(false);
  // Revision counter forces a re-read of localStorage after rememberContactsFromGroups runs.
  const [contactsRevision, setContactsRevision] = useState(0);

  // Keep the contacts list in sync with current group membership.
  // Layout.tsx also calls rememberContactsFromGroups, but its useEffect may not
  // have fired yet when this component first renders (e.g. immediately after a
  // group join). Calling it here ensures the contacts store is up-to-date before
  // we derive the list, and the revision bump causes the memos to re-read.
  useEffect(() => {
    if (!ready) return;
    rememberContactsFromGroups(groups, pubkeyHex);
    setContactsRevision((r) => r + 1);
  }, [groups, pubkeyHex, ready]);

  const contacts = useMemo(
    () => listContacts(pubkeyHex, { includeArchived: showHidden }).filter(
      (contact) => !isMaintainerPubkey(contact.pubkeyHex),
    ),
    // contactsRevision ensures a re-read after rememberContactsFromGroups writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubkeyHex, showHidden, contactsRevision],
  );
  const hiddenCount = useMemo(
    () => listContacts(pubkeyHex, { includeArchived: true })
      .filter((contact) => !isMaintainerPubkey(contact.pubkeyHex))
      .filter((contact) => contact.isArchived).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubkeyHex, contactsRevision],
  );
  const hasAnyContacts = contacts.length > 0 || hiddenCount > 0;

  return (
    <>
      <Head>
        <title>{`${copy.contacts.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="contacts-page">
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
              const sharedGroupNames = commonGroups(groups, contact.pubkeyHex).map((group) => group.name);
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
                      {sharedGroupNames.length > 0 ? (
                        <Text
                          mt={1}
                          fontSize="xs"
                          color="textMuted"
                          noOfLines={1}
                          data-testid={`contact-common-groups-${contact.pubkeyHex}`}
                        >
                          {copy.contacts.commonGroups(sharedGroupNames)}
                        </Text>
                      ) : null}
                      <ContactCardPreview peerPubkeyHex={contact.pubkeyHex} />
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
  const contact = useMemo(
    () => getContact(contactPubkeyHex, pubkeyHex, { includeArchived: true }),
    [contactPubkeyHex, pubkeyHex],
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
          <HStack spacing={2}>
            {/* Voice/video call icons temporarily disabled (feature code retained).
            <ContactCallToolbar peerPubkeyHex={contact.pubkeyHex} />
            */}
          </HStack>
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
  // router.query.id is string | string[] | undefined — for a repeated query
  // param (?id=a&id=b) it is an array. Normalize to the first value so the
  // maintainer check below never calls hex.toLowerCase() on an array.
  const rawId = router.query.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  // Maintainer keys are reserved for the feedback channel and must not be
  // reachable as an ordinary contact chat (spec §2.7). A contact record can
  // exist (a reply called rememberContact), so a direct /contacts?id=<maintainer>
  // URL would otherwise render ContactDetailView and send DMs WITHOUT the sealed
  // feedback marker tags. Redirect such IDs to the feedback surface.
  useEffect(() => {
    if (id && isMaintainerPubkey(id)) {
      router.replace('/feedback');
    }
  }, [id, router]);

  if (id) {
    if (isMaintainerPubkey(id)) {
      // Render nothing while the redirect effect runs — never the ordinary chat.
      return null;
    }
    return <ContactDetailView contactPubkeyHex={id} />;
  }

  return <ContactListView />;
}
