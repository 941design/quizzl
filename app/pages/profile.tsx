import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  HStack,
  Heading,
  Image,
  Select,
  Text,
  VStack,
  Code,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { archiveContact, eligibleGroupsForContact, getContact, unarchiveContact } from '@/src/lib/contacts';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import type { ContactListItem } from '@/src/lib/contacts';
import type { ProfileAvatar } from '@/src/types';

function AvatarDisplay({ avatar, displayName, size }: { avatar: ProfileAvatar | null; displayName: string; size: string }) {
  return (
    <Box
      w={size}
      h={size}
      borderRadius="full"
      overflow="hidden"
      bg="surfaceMutedBg"
      display="flex"
      alignItems="center"
      justifyContent="center"
      borderWidth="1px"
      borderColor="borderSubtle"
      flexShrink={0}
    >
      {avatar ? (
        <Image src={avatar.imageUrl} alt={displayName} w="100%" h="100%" objectFit="cover" />
      ) : (
        <Text fontWeight="bold" color="textMuted" fontSize="3xl">
          {displayName.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </Box>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const copy = useCopy();
  const { pubkeyHex: ownPubkeyHex } = useNostrIdentity();
  const { groups, inviteByNpub } = useMarmot();
  const [version, setVersion] = useState(0);
  const [npubCopied, setNpubCopied] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [addToGroupStatus, setAddToGroupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const pubkeyHex = typeof router.query.pubkey === 'string' ? router.query.pubkey : null;

  useEffect(() => {
    if (pubkeyHex && ownPubkeyHex && pubkeyHex === ownPubkeyHex) {
      router.replace('/settings');
    }
  }, [pubkeyHex, ownPubkeyHex, router]);

  const contact: ContactListItem | null = useMemo(() => {
    if (!pubkeyHex || !ownPubkeyHex) return null;
    return getContact(pubkeyHex, ownPubkeyHex, { includeArchived: true });
  }, [pubkeyHex, ownPubkeyHex, version]);

  if (!pubkeyHex) {
    return (
      <Box data-testid="profile-page">
        <Alert status="warning" borderRadius="md">
          <AlertIcon />
          <AlertDescription>{copy.profile.notFound}</AlertDescription>
        </Alert>
      </Box>
    );
  }

  if (pubkeyHex === ownPubkeyHex) {
    return null;
  }

  const npub = pubkeyToNpub(pubkeyHex);
  const displayName = contact?.nickname || truncateNpub(npub);
  const avatar = contact?.avatar ?? null;

  const eligibleGroups = eligibleGroupsForContact(groups, pubkeyHex);
  // The Select defaults to the first eligible group when the user hasn't picked
  // one yet, so the submit handler always has a valid target.
  const effectiveGroupId = selectedGroupId || eligibleGroups[0]?.id || '';

  function handleCopyNpub() {
    navigator.clipboard.writeText(npub).catch(() => {});
    setNpubCopied(true);
    setTimeout(() => setNpubCopied(false), 2000);
  }

  function handleArchiveToggle() {
    if (!contact) return;
    if (contact.isArchived) {
      unarchiveContact(contact.pubkeyHex);
    } else {
      archiveContact(contact.pubkeyHex);
    }
    setVersion((v) => v + 1);
  }

  async function handleAddToGroup() {
    if (!effectiveGroupId || !pubkeyHex) return;
    setAddToGroupStatus('loading');
    try {
      const result = await inviteByNpub(effectiveGroupId, pubkeyToNpub(pubkeyHex));
      if (result.ok) {
        setAddToGroupStatus('success');
        setSelectedGroupId('');
      } else {
        setAddToGroupStatus('error');
      }
    } catch {
      setAddToGroupStatus('error');
    }
  }

  return (
    <>
      <Head>
        <title>{`${displayName} - ${copy.profile.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="profile-page">
        <Button variant="ghost" size="sm" mb={4} onClick={() => router.back()}>
          ← {copy.profile.backLabel}
        </Button>

        <VStack align="start" spacing={6}>
          <HStack spacing={4} align="center">
            <AvatarDisplay avatar={avatar} displayName={displayName} size="80px" />
            <VStack align="start" spacing={1}>
              <Heading as="h1" size="lg">
                {displayName}
              </Heading>
            </VStack>
          </HStack>

          <HStack spacing={3} align="center" flexWrap="wrap">
            <Code fontSize="xs" userSelect="all" data-testid="profile-npub">
              {truncateNpub(npub)}
            </Code>
            <Button size="xs" variant="outline" onClick={handleCopyNpub}>
              {npubCopied ? copy.profile.copiedNpub : copy.profile.copyNpub}
            </Button>
          </HStack>

          <Button
            colorScheme="brand"
            onClick={() => router.push(`/contacts?id=${pubkeyHex}`)}
            data-testid="profile-send-dm"
          >
            {copy.profile.sendDm}
          </Button>

          {contact && eligibleGroups.length > 0 && (
            <Box w="100%" maxW="sm" data-testid="profile-add-to-group">
              <Text fontWeight="medium" mb={2}>
                {copy.profile.addToGroupLabel}
              </Text>
              {addToGroupStatus === 'success' && (
                <Alert status="success" borderRadius="md" mb={3} data-testid="profile-add-to-group-success">
                  <AlertIcon />
                  <AlertDescription>{copy.profile.addToGroupSuccess}</AlertDescription>
                </Alert>
              )}
              {addToGroupStatus === 'error' && (
                <Alert status="error" borderRadius="md" mb={3} data-testid="profile-add-to-group-error">
                  <AlertIcon />
                  <AlertDescription>{copy.profile.addToGroupError}</AlertDescription>
                </Alert>
              )}
              <HStack spacing={3} align="stretch">
                <Select
                  value={effectiveGroupId}
                  onChange={(e) => {
                    setSelectedGroupId(e.target.value);
                    setAddToGroupStatus('idle');
                  }}
                  aria-label={copy.profile.addToGroupSelect}
                  data-testid="profile-add-to-group-select"
                  bg="surfaceBg"
                >
                  {eligibleGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
                <Button
                  colorScheme="brand"
                  flexShrink={0}
                  onClick={() => void handleAddToGroup()}
                  isLoading={addToGroupStatus === 'loading'}
                  isDisabled={!effectiveGroupId}
                  data-testid="profile-add-to-group-btn"
                >
                  {copy.profile.addToGroupBtn}
                </Button>
              </HStack>
            </Box>
          )}

          {contact && (
            <Button
              variant="outline"
              onClick={handleArchiveToggle}
              data-testid="profile-archive"
            >
              {contact.isArchived ? copy.profile.unarchiveAction : copy.profile.archiveAction}
            </Button>
          )}
        </VStack>
      </Box>
    </>
  );
}
