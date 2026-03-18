import React, { useState } from 'react';
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
  Alert,
  AlertIcon,
  AlertDescription,
  Text,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';

type InviteMemberModalProps = {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
};

export default function InviteMemberModal({ isOpen, onClose, groupId }: InviteMemberModalProps) {
  const copy = useCopy();
  const { inviteByNpub } = useMarmot();
  const [npubInput, setNpubInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function getErrorMessage(errorCode: string | undefined): string {
    switch (errorCode) {
      case 'invalid_npub':
        return copy.groups.inviteErrorInvalidNpub;
      case 'no_key_package':
        return copy.groups.inviteErrorNoKeyPackage;
      case 'offline':
        return copy.groups.inviteErrorOffline;
      default:
        return copy.groups.inviteErrorGeneric;
    }
  }

  async function handleInvite() {
    const npub = npubInput.trim();
    if (!npub) return;

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await inviteByNpub(groupId, npub);
      if (result.ok) {
        setSuccess(true);
        setNpubInput('');
        setTimeout(() => {
          setSuccess(false);
          onClose();
        }, 1500);
      } else {
        setError(getErrorMessage(result.error));
      }
    } catch (err) {
      setError(copy.groups.inviteErrorGeneric);
      console.error('[InviteMemberModal] invite failed:', err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleClose() {
    setNpubInput('');
    setError(null);
    setSuccess(false);
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} isCentered data-testid="invite-member-modal">
      <ModalOverlay />
      <ModalContent data-testid="invite-member-modal-content">
        <ModalHeader>{copy.groups.inviteTitle}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {error && (
              <Alert status="error" borderRadius="md" data-testid="invite-error">
                <AlertIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert status="success" borderRadius="md" data-testid="invite-success">
                <AlertIcon />
                <AlertDescription>{copy.groups.inviteSuccess}</AlertDescription>
              </Alert>
            )}
            <FormControl isRequired>
              <FormLabel>{copy.groups.inviteNpubLabel}</FormLabel>
              <Input
                value={npubInput}
                onChange={(e) => setNpubInput(e.target.value)}
                placeholder={copy.groups.inviteNpubPlaceholder}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleInvite();
                }}
                data-testid="invite-npub-input"
                bg="surfaceBg"
              />
            </FormControl>
            <Text fontSize="xs" color="textMuted">
              Enter the npub of the person you want to invite. They must have used Quizzl at least once to appear.
            </Text>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="ghost"
            mr={3}
            onClick={handleClose}
            isDisabled={isLoading}
          >
            {copy.groups.cancel}
          </Button>
          <Button
            onClick={() => void handleInvite()}
            isLoading={isLoading}
            isDisabled={!npubInput.trim() || success}
            data-testid="invite-submit-btn"
          >
            {copy.groups.inviteSubmit}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
