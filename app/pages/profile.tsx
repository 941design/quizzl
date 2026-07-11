import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import NextLink from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Code,
  Divider,
  HStack,
  Heading,
  Image,
  Input,
  Select,
  Text,
  VStack,
  useDisclosure,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useProfile } from '@/src/context/ProfileContext';
import AvatarBrowserModal from '@/src/components/AvatarBrowserModal';
import NpubQrModal from '@/src/components/groups/NpubQrModal';
import { getOwnShareCard, type ShareCardCacheEntry } from '@/src/lib/shareCard';
import { addableGroupsForContact, archiveContact, eligibleGroupsForContact, getContact, unarchiveContact } from '@/src/lib/contacts';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import { capNickname, NICKNAME_MAX_BYTES } from '@/src/config/profile';
import { utf8ByteLength } from '@/src/lib/contactCard';
import type { ContactListItem } from '@/src/lib/contacts';
import type { ProfileAvatar, UserProfile } from '@/src/types';

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

function OwnProfileSection() {
  const copy = useCopy();
  const { backedUp, npub, pubkeyHex, privateKeyHex, signerMode } = useNostrIdentity();
  const { profile: savedProfile, hydrated, saveProfile } = useProfile();
  const { publishProfileUpdate } = useMarmot();
  const avatarDisclosure = useDisclosure();
  const shareCardDisclosure = useDisclosure();
  const [profile, setProfile] = useState<UserProfile>({ nickname: '', avatar: null });
  // True when the last keystroke/paste was clamped to the byte cap, so we can
  // surface a translated "limit reached" notice.
  const [nicknameCapped, setNicknameCapped] = useState(false);

  // --- Share contact card (epic: contact-card-exchange) ---
  // In-memory only (never persisted, never holds signer/key material — the
  // signer is re-derived on each cache MISS via the existing
  // activeEventSignerOverride ?? createPrivateKeySigner precedent). Keyed by
  // (nickname, signerMode, pubkeyHex) so a repeat open with an unchanged key
  // reuses the cached card instead of re-signing, while a nickname edit,
  // signer-mode switch, or identity restore invalidates it.
  const shareCardCacheRef = useRef<ShareCardCacheEntry | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCardLoading, setShareCardLoading] = useState(false);
  const [shareCardError, setShareCardError] = useState<string | null>(null);

  const handleShareCard = useCallback(async () => {
    setShareCardError(null);
    if (!npub || !privateKeyHex || !pubkeyHex) return;

    setShareCardLoading(true);
    try {
      const result = await getOwnShareCard({
        pubkeyHex,
        nickname: savedProfile.nickname,
        signerMode,
        cache: shareCardCacheRef.current,
        getSignEvent: async () => {
          const { activeEventSignerOverride, createPrivateKeySigner } = await import(
            '@/src/lib/marmot/signerAdapter'
          );
          const signer = activeEventSignerOverride.current ?? createPrivateKeySigner(privateKeyHex);
          return signer.signEvent;
        },
      });
      shareCardCacheRef.current = result.cache;
      setShareUrl(result.shareUrl);
      shareCardDisclosure.onOpen();
    } catch (err) {
      console.error('[Profile] Failed to build share card:', err);
      setShareCardError(copy.profile.shareCardError);
    } finally {
      setShareCardLoading(false);
    }
  }, [npub, privateKeyHex, pubkeyHex, savedProfile.nickname, signerMode, copy.profile.shareCardError, shareCardDisclosure]);

  // Tracks the nickname value as of the last broadcast so a blur that didn't
  // change the text doesn't re-broadcast a profile-update to every group.
  const lastBroadcastNickname = useRef<string | null>(null);

  useEffect(() => {
    setProfile(savedProfile);
  }, [savedProfile]);

  // Seed the broadcast baseline once from the hydrated profile: the persisted
  // nickname is assumed already broadcast, so it isn't re-sent on first blur.
  useEffect(() => {
    if (hydrated && lastBroadcastNickname.current === null) {
      lastBroadcastNickname.current = savedProfile.nickname;
    }
  }, [hydrated, savedProfile.nickname]);

  const broadcastProfile = useCallback(
    (next: UserProfile) => {
      lastBroadcastNickname.current = next.nickname;
      void publishProfileUpdate(next);
    },
    [publishProfileUpdate],
  );

  // Nickname is stored locally on every keystroke, but only broadcast when the
  // text field is left (blur) and the value actually changed.
  const handleNicknameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const { value: nickname, capped } = capNickname(event.target.value);
      setNicknameCapped(capped);
      const next = { ...profile, nickname };
      setProfile(next);
      saveProfile(next);
    },
    [profile, saveProfile],
  );

  const handleNicknameBlur = useCallback(() => {
    if (profile.nickname !== lastBroadcastNickname.current) {
      broadcastProfile(profile);
    }
  }, [profile, broadcastProfile]);

  // Avatar is a selection: persist locally and broadcast immediately. A profile
  // always has an avatar — there is no "remove" path, only "replace".
  function handleAvatarSelect(avatar: ProfileAvatar) {
    const next = { ...profile, avatar };
    setProfile(next);
    saveProfile(next);
    broadcastProfile(next);
    avatarDisclosure.onClose();
  }

  return (
    <>
      <VStack spacing={6} align="stretch">
        {/* Nickname + Avatar */}
        <Box>
          <VStack spacing={5} align="stretch">
            <Box>
              <Heading as="h2" size="md" mb={3}>
                {copy.settings.nicknameHeading}
              </Heading>
              <Input
                value={profile.nickname}
                onChange={handleNicknameChange}
                onBlur={handleNicknameBlur}
                bg="surfaceBg"
                data-testid="profile-nickname-input"
              />
              <HStack justify="space-between" mt={2}>
                <Text fontSize="xs" color="textMuted">
                  {copy.settings.nicknameHelper}
                </Text>
                <Text
                  fontSize="xs"
                  color={nicknameCapped ? 'red.400' : 'textMuted'}
                  data-testid="profile-nickname-bytecount"
                >
                  {utf8ByteLength(profile.nickname)}/{NICKNAME_MAX_BYTES}
                </Text>
              </HStack>
              {nicknameCapped && (
                <Text fontSize="xs" color="red.400" mt={1} data-testid="profile-nickname-limit">
                  {copy.settings.nicknameLimit(NICKNAME_MAX_BYTES)}
                </Text>
              )}
            </Box>

            <Box>
              <Heading as="h2" size="md" mb={3}>
                {copy.settings.avatarHeading}
              </Heading>
              <HStack
                align={{ base: 'stretch', md: 'center' }}
                spacing={4}
                flexDirection={{ base: 'column', md: 'row' }}
              >
                <Box
                  w={{ base: '100%', md: '140px' }}
                  minW={{ md: '140px' }}
                  p={3}
                  borderWidth="1px"
                  borderRadius="xl"
                  borderColor="borderSubtle"
                  bg="surfaceMutedBg"
                >
                  {/* A profile always carries an avatar (seeded on hydration),
                      so the image is the only state. The empty box only shows
                      for the brief pre-hydration frame before the saved
                      profile loads. */}
                  {profile.avatar ? (
                    <Image
                      src={profile.avatar.imageUrl}
                      alt={copy.settings.selectedAvatarAlt}
                      w="100%"
                      aspectRatio={1}
                      objectFit="contain"
                      bg="white"
                      borderRadius="lg"
                    />
                  ) : (
                    <Box aspectRatio={1} borderRadius="lg" bg="surfaceBg" />
                  )}
                </Box>

                <VStack align="stretch" spacing={3} flex={1}>
                  <HStack spacing={3} flexWrap="wrap">
                    <Button onClick={avatarDisclosure.onOpen} data-testid="choose-avatar-btn">
                      {copy.settings.changeAvatar}
                    </Button>
                  </HStack>
                </VStack>
              </HStack>
            </Box>
          </VStack>
        </Box>

        <Divider />

        {/* Share contact card */}
        <Box>
          <Heading as="h2" size="md" mb={1}>
            {copy.profile.shareCardHeading}
          </Heading>
          <Text fontSize="sm" color="textMuted" mb={4}>
            {copy.profile.shareCardDescription}
          </Text>
          <Button
            colorScheme="brand"
            onClick={() => void handleShareCard()}
            isLoading={shareCardLoading}
            data-testid="profile-share-card-btn"
          >
            {copy.profile.shareCardButton}
          </Button>
          {shareCardError && (
            <Alert status="error" borderRadius="md" mt={3} data-testid="profile-share-card-error">
              <AlertIcon />
              <AlertDescription fontSize="sm">{shareCardError}</AlertDescription>
            </Alert>
          )}
        </Box>

        {/* Backup hint — shown when the identity seed phrase hasn't been backed up */}
        {!backedUp && (
          <>
            <Divider />
            <Alert status="warning" borderRadius="md" data-testid="profile-backup-hint">
              <AlertIcon />
              <AlertDescription fontSize="sm">
                {copy.profile.backupNeededHint}{' '}
                <NextLink href="/settings" passHref legacyBehavior>
                  <Text as="a" fontWeight="semibold" textDecoration="underline" display="inline">
                    {copy.layout.nav.settings}
                  </Text>
                </NextLink>
              </AlertDescription>
            </Alert>
          </>
        )}
      </VStack>

      <AvatarBrowserModal
        isOpen={avatarDisclosure.isOpen}
        onClose={avatarDisclosure.onClose}
        onSelect={handleAvatarSelect}
        initialAvatar={profile.avatar}
      />

      <NpubQrModal
        isOpen={shareCardDisclosure.isOpen}
        onClose={shareCardDisclosure.onClose}
        title={copy.profile.shareCardTitle}
        mode="display"
        npub={npub ?? undefined}
        shareUrl={shareUrl ?? undefined}
        copyButtonLabel={copy.profile.copyCardLink}
        copiedButtonLabel={copy.profile.copiedCardLink}
        qrErrorMessage={copy.identity.qrGenerationError}
      />
    </>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const copy = useCopy();
  const { pubkeyHex: ownPubkeyHex } = useNostrIdentity();
  const { groups, inviteByNpub, getGroup, groupDataVersion } = useMarmot();
  const [version, setVersion] = useState(0);
  const [npubCopied, setNpubCopied] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [addToGroupStatus, setAddToGroupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [adminGroupIds, setAdminGroupIds] = useState<Set<string>>(new Set());

  const pubkeyHex = typeof router.query.pubkey === 'string' ? router.query.pubkey : null;
  const isOwnProfile = !pubkeyHex || pubkeyHex === ownPubkeyHex;

  // Resolve admin groups only when viewing another user's profile
  useEffect(() => {
    if (isOwnProfile || !pubkeyHex || !ownPubkeyHex) {
      setAdminGroupIds(new Set());
      return;
    }
    let cancelled = false;
    const candidates = eligibleGroupsForContact(groups, pubkeyHex);
    void Promise.all(
      candidates.map(async (group) => {
        const mlsGroup = await getGroup(group.id).catch(() => null);
        const admins = mlsGroup?.groupData?.adminPubkeys ?? [];
        const isAdmin = admins.some((pk) => pk.toLowerCase() === ownPubkeyHex.toLowerCase());
        return isAdmin ? group.id : null;
      }),
    ).then((ids) => {
      if (cancelled) return;
      setAdminGroupIds(new Set(ids.filter((id): id is string => id !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [groups, pubkeyHex, ownPubkeyHex, getGroup, groupDataVersion, isOwnProfile]);

  const contact: ContactListItem | null = useMemo(() => {
    if (isOwnProfile || !pubkeyHex || !ownPubkeyHex) return null;
    return getContact(pubkeyHex, ownPubkeyHex, { includeArchived: true });
  }, [pubkeyHex, ownPubkeyHex, version, isOwnProfile]);

  if (isOwnProfile) {
    return (
      <>
        <Head>
          <title>{`${copy.profile.pageTitle} - ${copy.appName}`}</title>
        </Head>
        <Box data-testid="profile-page">
          <Heading as="h1" size="xl" mb={2}>
            {copy.profile.ownHeading}
          </Heading>
          <Text color="textMuted" mb={6}>
            {copy.profile.ownDescription}
          </Text>
          <OwnProfileSection />
        </Box>
      </>
    );
  }

  const npub = pubkeyToNpub(pubkeyHex!);
  const displayName = contact?.nickname || truncateNpub(npub);
  const avatar = contact?.avatar ?? null;

  const addableGroups = addableGroupsForContact(groups, pubkeyHex!, adminGroupIds);
  const effectiveGroupId = selectedGroupId || addableGroups[0]?.id || '';

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

          {contact && addableGroups.length > 0 && (
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
                  {addableGroups.map((group) => (
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
