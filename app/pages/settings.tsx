import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Heading,
  Text,
  VStack,
  HStack,
  Wrap,
  WrapItem,
  Button,
  Divider,
  Badge,
  Input,
  Textarea,
  Image,
  Alert,
  AlertIcon,
  AlertDescription,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Checkbox,
  useDisclosure,
  useToast,
  Code,
} from '@chakra-ui/react';
import Head from 'next/head';
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import { useProfile } from '@/src/context/ProfileContext';
import { useAppTheme } from '@/src/hooks/useMoodTheme';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import AvatarBrowserModal from '@/src/components/AvatarBrowserModal';
import NpubQrButton from '@/src/components/groups/NpubQrButton';
import NpubQrModal from '@/src/components/groups/NpubQrModal';
import { PROFILE_BADGES, PROFILE_BADGE_LIMIT, PROFILE_NICKNAME_MAX_LENGTH } from '@/src/config/profile';
import { resetAllData } from '@/src/lib/storage';
import { APP_THEMES } from '@/src/lib/theme';
import { truncateNpub, derivePublicKeyHex } from '@/src/lib/nostrKeys';
import type { ProfileAvatar, UserProfile } from '@/src/types';
import { STORAGE_KEYS } from '@/src/types';

export default function SettingsPage() {
  const { language, setLanguage } = useLanguage();
  const { profile: savedProfile, saveProfile } = useProfile();
  const copy = useCopy();
  const { themeName, setTheme, activeThemeDefinition } = useAppTheme();
  const { npub, privateKeyHex, seedHex, backedUp, hydrated: identityHydrated, replaceIdentity } = useNostrIdentity();
  const resetDisclosure = useDisclosure();
  const avatarDisclosure = useDisclosure();
  const ownQrDisclosure = useDisclosure();
  const toast = useToast();
  const [resetDone, setResetDone] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({ nickname: '', avatar: null, badgeIds: [] });
  const [npubCopied, setNpubCopied] = useState(false);

  // Backup flow state
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupDone, setBackupDone] = useState(backedUp);

  // Restore flow state
  const [restoreInput, setRestoreInput] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  const handleCopyNpub = useCallback(async () => {
    if (!npub) return;
    try {
      await navigator.clipboard.writeText(npub);
      setNpubCopied(true);
      setTimeout(() => setNpubCopied(false), 2000);
    } catch {
      // Fallback: do nothing silently
    }
  }, [npub]);

  const handleGeneratePhrase = useCallback(async () => {
    if (!privateKeyHex) return;
    setBackupLoading(true);
    try {
      if (seedHex) {
        // New identity: 12-word mnemonic from 128-bit seed
        const { mnemonicFromSeed } = await import('@/src/lib/bip39');
        const phrase = await mnemonicFromSeed(seedHex);
        setMnemonic(phrase);
      } else {
        // Legacy identity (no seed): 24-word mnemonic from raw private key
        const { mnemonicFromHex } = await import('@/src/lib/bip39');
        const phrase = await mnemonicFromHex(privateKeyHex);
        setMnemonic(phrase);
      }
      setBackupConfirmed(false);
    } catch {
      // Silently fail
    } finally {
      setBackupLoading(false);
    }
  }, [privateKeyHex, seedHex]);

  const handleConfirmBackup = useCallback(() => {
    if (!backupConfirmed) return;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.nostrBackedUp, 'true');
    }
    setBackupDone(true);
    setMnemonic(null);
    toast({ title: copy.identity.backupDone, status: 'success', duration: 3000, isClosable: true });
  }, [backupConfirmed, copy.identity.backupDone, toast]);

  const handleRestore = useCallback(async () => {
    setRestoreLoading(true);
    setRestoreError(null);
    try {
      const { identityFromMnemonic, hexFromMnemonic } = await import('@/src/lib/bip39');
      const wordCount = restoreInput.trim().split(/\s+/).length;

      let restoredIdentity: { privateKeyHex: string; seedHex?: string } | null = null;

      if (wordCount === 12) {
        // New format: 12-word → seed → derive private key
        const result = await identityFromMnemonic(restoreInput);
        if (result) restoredIdentity = result;
      } else if (wordCount === 24) {
        // Legacy format: 24-word → raw private key (no seed)
        const hex = await hexFromMnemonic(restoreInput);
        if (hex) restoredIdentity = { privateKeyHex: hex };
      }

      if (!restoredIdentity) {
        setRestoreError(copy.identity.restoreError);
        return;
      }

      const restoredPubkey = await derivePublicKeyHex(restoredIdentity.privateKeyHex);
      await replaceIdentity({
        privateKeyHex: restoredIdentity.privateKeyHex,
        pubkeyHex: restoredPubkey,
        seedHex: restoredIdentity.seedHex,
      });
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.nostrBackedUp, 'true');
      }
      setRestoreSuccess(true);
      setRestoreInput('');
      setBackupDone(true);
    } catch {
      setRestoreError(copy.identity.restoreError);
    } finally {
      setRestoreLoading(false);
    }
  }, [restoreInput, replaceIdentity, copy.identity.restoreError]);

  function handleReset() {
    resetAllData();
    setResetDone(true);
    const emptyProfile = { nickname: '', avatar: null, badgeIds: [] };
    setProfile(emptyProfile);
    saveProfile(emptyProfile);
    resetDisclosure.onClose();
  }

  useEffect(() => {
    setProfile(savedProfile);
  }, [savedProfile]);

  function handleAvatarSelect(avatar: ProfileAvatar) {
    setProfile((current) => ({ ...current, avatar }));
    avatarDisclosure.onClose();
  }

  function toggleBadge(badgeId: string) {
    setProfile((current) => {
      const alreadySelected = current.badgeIds.includes(badgeId);

      if (alreadySelected) {
        return {
          ...current,
          badgeIds: current.badgeIds.filter((item) => item !== badgeId),
        };
      }

      if (current.badgeIds.length >= PROFILE_BADGE_LIMIT) {
        return current;
      }

      return {
        ...current,
        badgeIds: [...current.badgeIds, badgeId],
      };
    });
  }

  function handleProfileSave() {
    saveProfile(profile);
    toast({
      title: copy.settings.profileSaved,
      status: 'success',
      duration: 2500,
      isClosable: true,
    });
  }

  return (
    <>
      <Head>
        <title>{`${copy.settings.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="settings-page">
        <Heading as="h1" size="xl" mb={2}>
          {copy.settings.heading}
        </Heading>
        <Text color="textMuted" mb={6}>
          {copy.settings.description}
        </Text>

        {resetDone && (
          <Alert status="success" borderRadius="md" mb={6} data-testid="reset-success-banner">
            <AlertIcon />
            <AlertDescription>{copy.settings.resetSuccess}</AlertDescription>
          </Alert>
        )}

        <VStack spacing={6} align="stretch">
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
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      nickname: event.target.value.slice(0, PROFILE_NICKNAME_MAX_LENGTH),
                    }))
                  }
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
                    {profile.avatar && (
                      <Text fontSize="sm" color="textMuted">
                        {profile.avatar.accessories.length > 0
                          ? profile.avatar.accessories.join(', ')
                          : copy.settings.avatarNoAccessories}
                      </Text>
                    )}
                    <HStack spacing={3} flexWrap="wrap">
                      <Button onClick={avatarDisclosure.onOpen} data-testid="choose-avatar-btn">
                        {profile.avatar ? copy.settings.changeAvatar : copy.settings.chooseAvatar}
                      </Button>
                      {profile.avatar && (
                        <Button
                          variant="outline"
                          onClick={() => setProfile((current) => ({ ...current, avatar: null }))}
                        >
                          {copy.settings.removeAvatar}
                        </Button>
                      )}
                    </HStack>
                  </VStack>
                </HStack>
              </Box>

              <Box>
                <Heading as="h3" size="sm" mb={1}>
                  {copy.settings.badgesHeading}
                </Heading>
                <Text fontSize="sm" color="textMuted" mb={3}>
                  {copy.settings.badgesDescription}
                </Text>
                <Text fontSize="xs" color="textMuted" mb={3}>
                  {copy.settings.badgesSelected(profile.badgeIds.length, PROFILE_BADGE_LIMIT)}
                </Text>
                <Wrap spacing={3}>
                  {PROFILE_BADGES.map((badge) => {
                    const isSelected = profile.badgeIds.includes(badge.id);
                    const atLimit = profile.badgeIds.length >= PROFILE_BADGE_LIMIT;
                    const isDisabled = !isSelected && atLimit;

                    return (
                      <WrapItem key={badge.id}>
                        <Button
                          size="sm"
                          variant={isSelected ? 'solid' : 'outline'}
                          colorScheme={badge.colorScheme}
                          onClick={() => toggleBadge(badge.id)}
                          isDisabled={isDisabled}
                        >
                          {badge.label}
                        </Button>
                      </WrapItem>
                    );
                  })}
                </Wrap>
              </Box>

              <Button alignSelf="flex-start" onClick={handleProfileSave} data-testid="save-profile-btn">
                {copy.settings.saveProfile}
              </Button>
            </VStack>
          </Box>

          <Divider />

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

          <Divider />

          {/* Mood Theme Section */}
          <Box>
            <Heading as="h2" size="md" mb={1}>
              {copy.settings.themeHeading}
            </Heading>
            <Text fontSize="sm" color="textMuted" mb={4}>
              {copy.settings.themeDescription}
            </Text>

            <HStack spacing={4} flexWrap="wrap">
              {Object.values(APP_THEMES).map((themeOption) => {
                const isActive = themeName === themeOption.id;

                return (
                  <Button
                    key={themeOption.id}
                    variant={isActive ? 'solid' : 'outline'}
                    colorScheme={themeOption.previewColorScheme}
                    onClick={() => setTheme(themeOption.id)}
                    data-testid={`theme-${themeOption.id}-btn`}
                    size="lg"
                    leftIcon={isActive ? <span>✓</span> : undefined}
                  >
                    {copy.settings[themeOption.labelKey]}
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
              backgroundImage={activeThemeDefinition.backgroundImage}
              backgroundSize={activeThemeDefinition.backgroundImage ? '120px 120px' : undefined}
              data-testid="theme-preview"
            >
              <Text fontSize="sm" color="textMuted">
                {copy.settings.currentTheme}:{' '}
                <Text as="span" fontWeight="semibold" textTransform="capitalize">
                  {copy.settings[activeThemeDefinition.labelKey]}
                </Text>
              </Text>
              <Text fontSize="xs" color="textMuted" mt={1}>
                {copy.settings[activeThemeDefinition.descriptionKey]}
              </Text>
            </Box>
          </Box>

          <Divider />

          {/* Nostr Identity Section */}
          <Box>
            <Heading as="h2" size="md" mb={1}>
              {copy.identity.sectionHeading}
            </Heading>
            <Text fontSize="sm" color="textMuted" mb={4}>
              {copy.identity.sectionDescription}
            </Text>

            {identityHydrated && npub ? (
              <VStack align="stretch" spacing={5}>
                {/* npub display */}
                <Box>
                  <Text fontSize="sm" color="textMuted" mb={1}>
                    {copy.identity.npubLabel}
                  </Text>
                  <HStack spacing={3} flexWrap="wrap">
                    <Code
                      fontSize="sm"
                      px={3}
                      py={2}
                      borderRadius="md"
                      bg="surfaceMutedBg"
                      userSelect="all"
                      data-testid="identity-npub-display"
                    >
                      {truncateNpub(npub)}
                    </Code>
                    <NpubQrButton
                      label={copy.identity.showQr}
                      onClick={ownQrDisclosure.onOpen}
                      data-testid="show-own-npub-qr-btn"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyNpub}
                      data-testid="copy-npub-btn"
                    >
                      {npubCopied ? copy.identity.copiedNpub : copy.identity.copyNpub}
                    </Button>
                  </HStack>
                </Box>

                <NpubQrModal
                  isOpen={ownQrDisclosure.isOpen}
                  onClose={ownQrDisclosure.onClose}
                  title={copy.identity.qrModalTitle}
                  mode="display"
                  npub={npub}
                  qrErrorMessage={copy.identity.qrGenerationError}
                />

                {/* Backup Section */}
                <Box>
                  <Heading as="h3" size="sm" mb={1}>
                    {copy.identity.backupHeading}
                  </Heading>
                  <Text fontSize="sm" color="textMuted" mb={3}>
                    {copy.identity.backupDescription}
                  </Text>

                  {backupDone && !mnemonic && (
                    <Alert status="success" borderRadius="md" mb={3} size="sm">
                      <AlertIcon />
                      <AlertDescription fontSize="sm">{copy.identity.backupDone}</AlertDescription>
                    </Alert>
                  )}

                  {!mnemonic && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleGeneratePhrase()}
                      isLoading={backupLoading}
                      data-testid="generate-backup-phrase-btn"
                    >
                      {copy.identity.generatePhrase}
                    </Button>
                  )}

                  {mnemonic && (
                    <VStack align="stretch" spacing={3}>
                      <Alert status="warning" borderRadius="md">
                        <AlertIcon />
                        <AlertDescription fontSize="sm">{copy.identity.backupWarning}</AlertDescription>
                      </Alert>
                      <Code
                        p={4}
                        borderRadius="md"
                        fontSize="md"
                        whiteSpace="pre-wrap"
                        wordBreak="break-word"
                        bg="surfaceMutedBg"
                        data-testid="mnemonic-display"
                      >
                        {mnemonic}
                      </Code>
                      <Checkbox
                        isChecked={backupConfirmed}
                        onChange={(e) => setBackupConfirmed(e.target.checked)}
                        data-testid="backup-confirm-checkbox"
                      >
                        <Text fontSize="sm">{copy.identity.backupConfirmCheck}</Text>
                      </Checkbox>
                      <Button
                        size="sm"
                        isDisabled={!backupConfirmed}
                        onClick={handleConfirmBackup}
                        data-testid="backup-done-btn"
                      >
                        Done
                      </Button>
                    </VStack>
                  )}
                </Box>

                {/* Restore Section */}
                <Box>
                  <Heading as="h3" size="sm" mb={1}>
                    {copy.identity.restoreHeading}
                  </Heading>
                  <Text fontSize="sm" color="textMuted" mb={3}>
                    {copy.identity.restoreDescription}
                  </Text>

                  {restoreSuccess && (
                    <Alert status="success" borderRadius="md" mb={3}>
                      <AlertIcon />
                      <AlertDescription fontSize="sm">{copy.identity.restoreSuccess}</AlertDescription>
                    </Alert>
                  )}

                  {restoreError && (
                    <Alert status="error" borderRadius="md" mb={3}>
                      <AlertIcon />
                      <AlertDescription fontSize="sm">{restoreError}</AlertDescription>
                    </Alert>
                  )}

                  <VStack align="stretch" spacing={2}>
                    <Textarea
                      value={restoreInput}
                      onChange={(e) => setRestoreInput(e.target.value)}
                      placeholder={copy.identity.restoreInput}
                      rows={3}
                      bg="surfaceBg"
                      fontSize="sm"
                      data-testid="restore-phrase-input"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      colorScheme="danger"
                      onClick={() => void handleRestore()}
                      isLoading={restoreLoading}
                      isDisabled={restoreInput.trim().split(/\s+/).length < 12}
                      data-testid="restore-identity-btn"
                    >
                      {copy.identity.restoreButton}
                    </Button>
                  </VStack>
                </Box>
              </VStack>
            ) : (
              <Text fontSize="sm" color="textMuted">
                {copy.identity.notReady}
              </Text>
            )}
          </Box>

          <Divider />

          {/* Reset Section */}
          <Box>
            <Heading as="h2" size="md" mb={1}>
              {copy.settings.resetHeading}
            </Heading>
            <Text fontSize="sm" color="textMuted" mb={4}>
              {copy.settings.resetDescription}
            </Text>

            <Button
              colorScheme="danger"
              variant="outline"
              onClick={resetDisclosure.onOpen}
              data-testid="reset-data-btn"
            >
              {copy.settings.resetButton}
            </Button>
          </Box>
        </VStack>
      </Box>

      {/* Reset Confirmation Modal */}
      <AvatarBrowserModal
        isOpen={avatarDisclosure.isOpen}
        onClose={avatarDisclosure.onClose}
        onSelect={handleAvatarSelect}
        initialAvatar={profile.avatar}
      />

      <Modal
        isOpen={resetDisclosure.isOpen}
        onClose={resetDisclosure.onClose}
        isCentered
        data-testid="reset-modal"
      >
        <ModalOverlay />
        <ModalContent data-testid="reset-modal-content">
          <ModalHeader>{copy.settings.resetModalTitle}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>
              {copy.settings.resetModalBody}
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost"
              mr={3}
              onClick={resetDisclosure.onClose}
              data-testid="reset-cancel-btn"
            >
              {copy.settings.cancel}
            </Button>
            <Button colorScheme="danger" onClick={handleReset} data-testid="reset-confirm-btn">
              {copy.settings.confirmReset}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
