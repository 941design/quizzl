import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Heading,
  Text,
  VStack,
  HStack,
  Button,
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
  Textarea,
  useDisclosure,
  useToast,
  Code,
} from '@chakra-ui/react';
import Head from 'next/head';
import { useCopy } from '@/src/context/LanguageContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import NpubQrButton from '@/src/components/groups/NpubQrButton';
import NpubQrModal from '@/src/components/groups/NpubQrModal';
import { truncateNpub, derivePublicKeyHex } from '@/src/lib/nostrKeys';
import { useProfile } from '@/src/context/ProfileContext';
import { STORAGE_KEYS } from '@/src/types';

export default function SettingsPage() {
  const copy = useCopy();
  const { npub, privateKeyHex, seedHex, backedUp, hydrated: identityHydrated, replaceIdentity } = useNostrIdentity();
  const { profile: savedProfile, saveProfile } = useProfile();
  const ownQrDisclosure = useDisclosure();
  const toast = useToast();
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

  // Relay backup restore state
  const [pendingBackupPayload, setPendingBackupPayload] = useState<import('@/src/lib/backup/relayBackup').BackupPayload | null>(null);
  const backupRestoreDisclosure = useDisclosure();

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
        const { mnemonicFromSeed } = await import('@/src/lib/bip39');
        const phrase = await mnemonicFromSeed(seedHex);
        setMnemonic(phrase);
      } else {
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
        const result = await identityFromMnemonic(restoreInput);
        if (result) restoredIdentity = result;
      } else if (wordCount === 24) {
        const hex = await hexFromMnemonic(restoreInput);
        if (hex) restoredIdentity = { privateKeyHex: hex };
      }

      if (!restoredIdentity) {
        setRestoreError(copy.identity.restoreError);
        return;
      }

      const restoredPubkey = await derivePublicKeyHex(restoredIdentity.privateKeyHex);

      // Fetch profile from Nostr relays (kind 0) BEFORE replaceIdentity,
      // because replaceIdentity publishes kind 0 with the current (empty) profile.
      try {
        const { connectNdk, fetchEventsWithTimeout } = await import('@/src/lib/ndkClient');
        const ndk = await connectNdk(restoredIdentity.privateKeyHex);
        const { events } = await fetchEventsWithTimeout(ndk, {
          kinds: [0 as import('@nostr-dev-kit/ndk').NDKKind],
          authors: [restoredPubkey],
          limit: 5,
        });
        const sorted = Array.from(events).sort(
          (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
        );
        if (sorted.length > 0) {
          const meta = JSON.parse(sorted[0].content ?? '{}');
          const nickname = meta.name || meta.display_name || '';
          if (nickname) {
            saveProfile({ nickname, avatar: savedProfile.avatar });
          }
        }
      } catch (err) {
        console.warn('[Settings] Profile recovery from relays failed:', err);
      }

      await replaceIdentity({
        privateKeyHex: restoredIdentity.privateKeyHex,
        pubkeyHex: restoredPubkey,
        seedHex: restoredIdentity.seedHex,
      });
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.nostrBackedUp, 'true');
      }

      // Check for relay backup
      try {
        const { fetchBackup, getBackupRelays } = await import('@/src/lib/backup/relayBackup');
        const { createPrivateKeySigner } = await import('@/src/lib/marmot/signerAdapter');
        const { connectNdk: connectForBackup } = await import('@/src/lib/ndkClient');
        const backupNdk = await connectForBackup(restoredIdentity.privateKeyHex);
        const backupSigner = createPrivateKeySigner(restoredIdentity.privateKeyHex);
        const backupRelays = await getBackupRelays(backupNdk, restoredPubkey);
        const backup = await fetchBackup(backupSigner, restoredPubkey, backupNdk, backupRelays);
        if (backup) {
          setPendingBackupPayload(backup);
          backupRestoreDisclosure.onOpen();
          setRestoreInput('');
          setBackupDone(true);
          return;
        }
      } catch (err) {
        console.warn('[Settings] Relay backup check failed:', err);
      }

      setRestoreSuccess(true);
      setRestoreInput('');
      setBackupDone(true);
    } catch {
      setRestoreError(copy.identity.restoreError);
    } finally {
      setRestoreLoading(false);
    }
  }, [restoreInput, replaceIdentity, copy.identity.restoreError, savedProfile, saveProfile, backupRestoreDisclosure]);

  const handleConfirmBackupRestore = useCallback(async () => {
    if (!pendingBackupPayload) return;
    try {
      const { restoreFromBackup } = await import('@/src/lib/backup/relayBackup');
      await restoreFromBackup(pendingBackupPayload);
      window.location.reload();
    } catch (err) {
      console.error('[Settings] Backup restore failed:', err);
      backupRestoreDisclosure.onClose();
      setPendingBackupPayload(null);
      setRestoreSuccess(true);
    }
  }, [pendingBackupPayload, backupRestoreDisclosure]);

  const handleDismissBackupRestore = useCallback(() => {
    backupRestoreDisclosure.onClose();
    setPendingBackupPayload(null);
    setRestoreSuccess(true);
  }, [backupRestoreDisclosure]);

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

        <VStack spacing={6} align="stretch">
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
        </VStack>
      </Box>

      {/* Relay backup restore confirmation dialog */}
      <Modal
        isOpen={backupRestoreDisclosure.isOpen}
        onClose={handleDismissBackupRestore}
        isCentered
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Restore from backup?</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>
              A backup was found on the relay network. Restoring will replace all
              local data (groups and chat messages) with the
              backed-up version. This cannot be undone.
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost"
              mr={3}
              onClick={handleDismissBackupRestore}
            >
              Skip
            </Button>
            <Button colorScheme="blue" onClick={handleConfirmBackupRestore}>
              Restore
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
