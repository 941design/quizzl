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
  InputGroup,
  InputRightElement,
  VStack,
  Alert,
  AlertIcon,
  AlertDescription,
  Text,
  useDisclosure,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { addContactByNpub } from '@/src/lib/contacts';
import NpubQrButton from '@/src/components/groups/NpubQrButton';
import NpubQrModal from '@/src/components/groups/NpubQrModal';

export type AddContactModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function AddContactModal({ isOpen, onClose, onSuccess }: AddContactModalProps): JSX.Element {
  const copy = useCopy();
  const { pubkeyHex: ownPubkeyHex } = useNostrIdentity();
  const { notifyKnownPeersChanged } = useMarmot();
  const scanDisclosure = useDisclosure();
  const [npubInput, setNpubInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function getErrorMessage(errorCode: string | undefined): string {
    switch (errorCode) {
      case 'invalid_npub':
        return copy.contacts.addContactErrorInvalidNpub;
      case 'self':
        return copy.contacts.addContactErrorSelf;
      case 'already_exists':
        return copy.contacts.addContactErrorAlreadyExists;
      default:
        return copy.contacts.addContactErrorGeneric;
    }
  }

  function handleAdd() {
    const npub = npubInput.trim();
    if (!npub) return;

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const result = addContactByNpub(npub, ownPubkeyHex);
      if (result.ok) {
        setSuccess(true);
        setNpubInput('');
        // addContactByNpub already wrote the new peer to lp_knownPeers_v1
        // synchronously; bump the revision so the always-mounted watchers
        // (DM notifications, incoming calls, ContactChat) refresh their
        // cached knownPeers ref immediately instead of waiting for an
        // unrelated `groups` change or a full reload.
        notifyKnownPeersChanged();
        onSuccess();
        setTimeout(() => {
          setSuccess(false);
          onClose();
        }, 1500);
      } else {
        setError(getErrorMessage(result.error));
      }
    } catch (err) {
      setError(copy.contacts.addContactErrorGeneric);
      console.error('[AddContactModal] add contact failed:', err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleClose() {
    setNpubInput('');
    setError(null);
    setSuccess(false);
    scanDisclosure.onClose();
    onClose();
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} isCentered data-testid="add-contact-modal">
        <ModalOverlay />
        <ModalContent data-testid="add-contact-modal-content">
          <ModalHeader>{copy.contacts.addContactTitle}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} align="stretch">
              {error && (
                <Alert status="error" borderRadius="md" data-testid="add-contact-error">
                  <AlertIcon />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {success && (
                <Alert status="success" borderRadius="md" data-testid="add-contact-success">
                  <AlertIcon />
                  <AlertDescription>{copy.contacts.addContactSuccess}</AlertDescription>
                </Alert>
              )}
              <FormControl isRequired>
                <FormLabel>{copy.contacts.addContactNpubLabel}</FormLabel>
                <InputGroup>
                  <Input
                    value={npubInput}
                    onChange={(e) => setNpubInput(e.target.value)}
                    placeholder={copy.contacts.addContactNpubPlaceholder}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAdd();
                    }}
                    data-testid="add-contact-npub-input"
                    bg="surfaceBg"
                    pr={12}
                  />
                  <InputRightElement width="3rem">
                    <NpubQrButton
                      label={copy.groups.scanQr}
                      onClick={scanDisclosure.onOpen}
                      data-testid="add-contact-scan-qr-btn"
                    />
                  </InputRightElement>
                </InputGroup>
              </FormControl>
              <Text fontSize="xs" color="textMuted">
                {copy.contacts.addContactHelp}
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
              {copy.contacts.addContactCancel}
            </Button>
            <Button
              onClick={handleAdd}
              isLoading={isLoading}
              isDisabled={!npubInput.trim() || success}
              data-testid="add-contact-submit-btn"
            >
              {copy.contacts.addContactSubmit}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <NpubQrModal
        isOpen={scanDisclosure.isOpen}
        onClose={scanDisclosure.onClose}
        title={copy.contacts.addContactTitle}
        mode="scan"
        qrErrorMessage={copy.groups.qrUnavailable}
        invalidPayloadMessage={copy.groups.qrInvalidPayload}
        permissionDeniedMessage={copy.groups.cameraPermissionDenied}
        unavailableMessage={copy.groups.qrUnavailable}
        scannerHint={copy.groups.qrScannerHint}
        onScan={(scannedNpub) => {
          setNpubInput(scannedNpub);
          setError(null);
          scanDisclosure.onClose();
        }}
      />
    </>
  );
}
