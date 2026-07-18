import React, { useState, useMemo, useEffect } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Box,
  Button,
  FormControl,
  FormLabel,
  Image,
  Input,
  Spinner,
  VStack,
  Text,
  Alert,
  AlertIcon,
  AlertDescription,
  useToast,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { generateNonce, buildInviteUrl } from '@/src/lib/marmot/inviteLinkGeneration';
import { saveInviteLink, buildNewInviteLink } from '@/src/lib/marmot/inviteLinkStorage';
import { generateQrDataUrl } from '@/src/lib/qr';

type GenerateInviteLinkModalProps = {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
};

export default function GenerateInviteLinkModal({
  isOpen,
  onClose,
  groupId,
  groupName,
}: GenerateInviteLinkModalProps) {
  const copy = useCopy();
  const { npub } = useNostrIdentity();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  const nonce = useMemo(() => (isOpen ? generateNonce() : ''), [isOpen]);

  const inviteUrl = useMemo(() => {
    if (!nonce || !npub) return '';
    return buildInviteUrl({ nonce, adminNpub: npub, groupName });
  }, [nonce, npub, groupName]);

  // Render the invite link as a QR so it can be handed over in person by
  // scanning, without routing it through a messenger — the same affordance the
  // contact card gets in NpubQrModal. The URL stays visible below the QR: it
  // is what the Copy button puts on the clipboard, and it is the only usable
  // form of the link when QR generation fails.
  useEffect(() => {
    if (!isOpen || !inviteUrl) {
      setQrDataUrl(null);
      setLoadingQr(false);
      setQrError(null);
      return;
    }

    let cancelled = false;

    async function generate() {
      setLoadingQr(true);
      setQrError(null);

      try {
        const dataUrl = await generateQrDataUrl(inviteUrl);
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch (err) {
        if (!cancelled) {
          setQrError(copy.groups.qrGenerationError);
          console.error('[GenerateInviteLinkModal] QR generation failed:', err);
        }
      } finally {
        if (!cancelled) setLoadingQr(false);
      }
    }

    void generate();

    return () => {
      cancelled = true;
    };
  }, [isOpen, inviteUrl, copy.groups.qrGenerationError]);

  async function persistLink() {
    await saveInviteLink(
      buildNewInviteLink({
        nonce,
        groupId,
        createdAt: Date.now(),
        label: label.trim() || undefined,
      })
    );
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      await persistLink();
      setCopied(true);
      toast({
        title: copy.groups.inviteLinkCopied,
        status: 'success',
        duration: 2000,
        isClosable: true,
      });
    } catch {
      toast({
        title: copy.groups.inviteLinkCopyError,
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
  }

  async function handleClose() {
    if (!copied && nonce) {
      await persistLink();
    }
    setLabel('');
    setCopied(false);
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={() => void handleClose()} isCentered>
      <ModalOverlay />
      <ModalContent data-testid="generate-invite-link-modal">
        <ModalHeader>{copy.groups.inviteLinkTitle}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {!npub && (
              <Alert status="warning" borderRadius="md">
                <AlertIcon />
                <AlertDescription>{copy.identity.notReady}</AlertDescription>
              </Alert>
            )}

            <FormControl>
              <FormLabel>{copy.groups.inviteLinkLabelField}</FormLabel>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={copy.groups.inviteLinkLabelPlaceholder}
                data-testid="invite-link-label-input"
                bg="surfaceBg"
              />
            </FormControl>

            {qrError && (
              <Alert status="error" borderRadius="md">
                <AlertIcon />
                <AlertDescription>{qrError}</AlertDescription>
              </Alert>
            )}

            {inviteUrl && (
              <Box
                minH="240px"
                borderRadius="lg"
                borderWidth="1px"
                borderColor="borderSubtle"
                bg="surfaceMutedBg"
                display="flex"
                alignItems="center"
                justifyContent="center"
                p={4}
              >
                {loadingQr && <Spinner />}
                {!loadingQr && qrDataUrl && (
                  <Image
                    src={qrDataUrl}
                    alt={inviteUrl}
                    maxW="220px"
                    w="100%"
                    h="auto"
                    data-testid="invite-link-qr-image"
                  />
                )}
              </Box>
            )}

            <Text
              fontSize="xs"
              wordBreak="break-all"
              p={2}
              bg="surfaceBg"
              borderRadius="md"
              data-testid="invite-link-url"
            >
              {inviteUrl}
            </Text>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="ghost"
            mr={3}
            onClick={() => void handleClose()}
          >
            {copy.groups.cancel}
          </Button>
          <Button
            onClick={() => void handleCopy()}
            isDisabled={!inviteUrl}
            data-testid="invite-link-copy-btn"
          >
            {copy.groups.inviteLinkCopy}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
