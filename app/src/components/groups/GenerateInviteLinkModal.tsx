import React, { useState, useMemo } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  FormControl,
  FormLabel,
  Input,
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
import { saveInviteLink } from '@/src/lib/marmot/inviteLinkStorage';

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

  const nonce = useMemo(() => (isOpen ? generateNonce() : ''), [isOpen]);

  const inviteUrl = useMemo(() => {
    if (!nonce || !npub) return '';
    return buildInviteUrl({ nonce, adminNpub: npub, groupName });
  }, [nonce, npub, groupName]);

  async function persistLink() {
    await saveInviteLink({
      nonce,
      groupId,
      createdAt: Date.now(),
      label: label.trim() || undefined,
      muted: false,
    });
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
