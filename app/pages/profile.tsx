import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import NextLink from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
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
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useProfile } from '@/src/context/ProfileContext';
import { useAppTheme } from '@/src/hooks/useMoodTheme';
import AvatarBrowserModal from '@/src/components/AvatarBrowserModal';
import { addableGroupsForContact, archiveContact, eligibleGroupsForContact, getContact, unarchiveContact } from '@/src/lib/contacts';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import { listThemes } from '@/src/lib/theme';
import { PROFILE_NICKNAME_MAX_LENGTH } from '@/src/config/profile';
import type { ContactListItem } from '@/src/lib/contacts';
import type { AppThemeName } from '@/src/lib/theme';
import type { ProfileAvatar, UserProfile, LanguageCode } from '@/src/types';

/**
 * Resolves a manifest's `{ en; de? }` localized-text field for the current
 * language, falling back to `en` when `de` is absent (AC-UX-3 / spec.md
 * Implementation Constraint 10 — "de falls back to en").
 */
function localizedThemeText(text: { en: string; de?: string }, language: LanguageCode): string {
  return language === 'de' ? text.de ?? text.en : text.en;
}

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
  const { backedUp } = useNostrIdentity();
  const { profile: savedProfile, hydrated, saveProfile } = useProfile();
  const { language, setLanguage } = useLanguage();
  const { themeName, setTheme, activeThemeDefinition } = useAppTheme();
  const { publishProfileUpdate } = useMarmot();
  const avatarDisclosure = useDisclosure();
  const [profile, setProfile] = useState<UserProfile>({ nickname: '', avatar: null });

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
      const nickname = event.target.value.slice(0, PROFILE_NICKNAME_MAX_LENGTH);
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

  // Avatar is a selection: persist locally and broadcast immediately.
  function applyAvatar(avatar: ProfileAvatar | null) {
    const next = { ...profile, avatar };
    setProfile(next);
    saveProfile(next);
    broadcastProfile(next);
  }

  function handleAvatarSelect(avatar: ProfileAvatar) {
    applyAvatar(avatar);
    avatarDisclosure.onClose();
  }

  return (
    <>
      <VStack spacing={6} align="stretch">
        {/* Nickname + Avatar */}
        <Box>
          <Heading as="h2" size="md" mb={1}>
            {copy.settings.profileHeading}
          </Heading>
          <Text fontSize="sm" color="textMuted" mb={4}>
            {copy.settings.profileDescription}
          </Text>

          <VStack spacing={5} align="stretch">
            <Box>
              <Heading as="h3" size="sm" mb={1}>
                {copy.settings.nicknameHeading}
              </Heading>
              <Text fontSize="sm" color="textMuted" mb={3}>
                {copy.settings.nicknameDescription}
              </Text>
              <Input
                value={profile.nickname}
                onChange={handleNicknameChange}
                onBlur={handleNicknameBlur}
                placeholder={copy.settings.nicknamePlaceholder}
                maxLength={PROFILE_NICKNAME_MAX_LENGTH}
                bg="surfaceBg"
                data-testid="profile-nickname-input"
              />
              <HStack justify="space-between" mt={2}>
                <Text fontSize="xs" color="textMuted">
                  {copy.settings.nicknameHelper}
                </Text>
                <Text fontSize="xs" color="textMuted">
                  {profile.nickname.length}/{PROFILE_NICKNAME_MAX_LENGTH}
                </Text>
              </HStack>
            </Box>

            <Box>
              <Heading as="h3" size="sm" mb={1}>
                {copy.settings.avatarHeading}
              </Heading>
              <Text fontSize="sm" color="textMuted" mb={3}>
                {copy.settings.avatarDescription}
              </Text>
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
                    <Box
                      aspectRatio={1}
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      borderRadius="lg"
                      bg="surfaceBg"
                      color="textMuted"
                      textAlign="center"
                      px={4}
                    >
                      <Text fontSize="sm">{copy.settings.noAvatarSelected}</Text>
                    </Box>
                  )}
                </Box>

                <VStack align="stretch" spacing={3} flex={1}>
                  <HStack spacing={3} flexWrap="wrap">
                    <Button onClick={avatarDisclosure.onOpen} data-testid="choose-avatar-btn">
                      {profile.avatar ? copy.settings.changeAvatar : copy.settings.chooseAvatar}
                    </Button>
                    {profile.avatar && (
                      <Button variant="outline" onClick={() => applyAvatar(null)}>
                        {copy.settings.removeAvatar}
                      </Button>
                    )}
                  </HStack>
                </VStack>
              </HStack>
            </Box>
          </VStack>
        </Box>

        <Divider />

        {/* Theme */}
        <Box>
          <Heading as="h2" size="md" mb={1}>
            {copy.settings.themeHeading}
          </Heading>
          <Text fontSize="sm" color="textMuted" mb={4}>
            {copy.settings.themeDescription}
          </Text>

          <HStack spacing={4} flexWrap="wrap">
            {listThemes().map((themeOption) => {
              const isActive = themeName === themeOption.id;
              return (
                <Button
                  key={themeOption.id}
                  variant={isActive ? 'solid' : 'outline'}
                  colorScheme={themeOption.previewColorScheme}
                  onClick={() => setTheme(themeOption.id as AppThemeName)}
                  data-testid={`theme-${themeOption.id}-btn`}
                  size="lg"
                  leftIcon={isActive ? <span>✓</span> : undefined}
                >
                  {localizedThemeText(themeOption.label, language)}
                  {isActive && (
                    <Badge colorScheme={themeOption.previewColorScheme} ml={2} fontSize="xs">
                      {copy.settings.active}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </HStack>

          <Box
            mt={4}
            p={3}
            borderRadius="md"
            bg="surfaceMutedBg"
            borderWidth="1px"
            borderColor="borderSubtle"
            backgroundImage={activeThemeDefinition.colors.backgroundImage}
            backgroundSize={activeThemeDefinition.colors.backgroundImage ? '120px 120px' : undefined}
            data-testid="theme-preview"
          >
            <Text fontSize="sm" color="textMuted">
              {copy.settings.currentTheme}:{' '}
              <Text as="span" fontWeight="semibold" textTransform="capitalize">
                {localizedThemeText(activeThemeDefinition.label, language)}
              </Text>
            </Text>
            <Text fontSize="xs" color="textMuted" mt={1}>
              {localizedThemeText(activeThemeDefinition.description, language)}
            </Text>
          </Box>
        </Box>

        <Divider />

        {/* Language */}
        <Box>
          <Heading as="h2" size="md" mb={1}>
            {copy.settings.languageHeading}
          </Heading>
          <Text fontSize="sm" color="textMuted" mb={4}>
            {copy.settings.languageDescription}
          </Text>

          <HStack spacing={4} flexWrap="wrap">
            {(['en', 'de'] as const).map((option) => (
              <Button
                key={option}
                variant={language === option ? 'solid' : 'outline'}
                onClick={() => setLanguage(option)}
                size="lg"
              >
                {copy.languageNames[option]}
                {language === option && (
                  <Badge ml={2} fontSize="xs">
                    {copy.settings.active}
                  </Badge>
                )}
              </Button>
            ))}
          </HStack>
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
