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
import { useMarmot } from '@/src/context/MarmotContext';
import NpubQrButton from '@/src/components/groups/NpubQrButton';
import NpubQrModal from '@/src/components/groups/NpubQrModal';

type InviteMemberModalProps = {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
};

export default function InviteMemberModal({ isOpen, onClose, groupId }: InviteMemberModalProps) {
  const copy = useCopy();
  const { inviteByNpub } = useMarmot();
  const scanDisclosure = useDisclosure();
  const [npubInput, setNpubInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  function getErrorMessage(errorCode: string | undefined): string {
    switch (errorCode) {
      case 'invalid_npub':
        return copy.groups.inviteErrorInvalidNpub;
      case 'no_key_package':
        return copy.groups.inviteErrorNoKeyPackage;
      case 'offline':
        return copy.groups.inviteErrorOffline;
      case 'timeout':
        return copy.groups.inviteErrorTimeout;
      default:
        return copy.groups.inviteErrorGeneric;
    }
  }

  async function handleInvite() {
    const npub = npubInput.trim();
    if (!npub) return;

    setIsLoading(true);
    setError(null);
    setWarning(null);
    setSuccess(false);

    try {
      const result = await inviteByNpub(groupId, npub);
      if (result.ok) {
        setSuccess(true);
        setNpubInput('');
        if (result.warning === 'admin_promotion_failed') {
          setWarning(copy.groups.inviteWarningAdminPromotion);
        }
        setTimeout(() => {
          setSuccess(false);
          setWarning(null);
          onClose();
        }, result.warning ? 3000 : 1500);
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
    setWarning(null);
    setSuccess(false);
    scanDisclosure.onClose();
    onClose();
  }

  return (
    <>
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
              {warning && (
                <Alert status="warning" borderRadius="md" data-testid="invite-warning">
                  <AlertIcon />
                  <AlertDescription>{warning}</AlertDescription>
                </Alert>
              )}
              <FormControl isRequired>
                <FormLabel>{copy.groups.inviteNpubLabel}</FormLabel>
                <InputGroup>
                  <Input
                    value={npubInput}
                    onChange={(e) => setNpubInput(e.target.value)}
                    placeholder={copy.groups.inviteNpubPlaceholder}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleInvite();
                    }}
                    data-testid="invite-npub-input"
                    bg="surfaceBg"
                    pr={12}
                  />
                  <InputRightElement width="3rem">
                    <NpubQrButton
                      label={copy.groups.scanQr}
                      onClick={scanDisclosure.onOpen}
                      data-testid="invite-scan-qr-btn"
                    />
                  </InputRightElement>
                </InputGroup>
              </FormControl>
              <Text fontSize="xs" color="textMuted">
                {copy.groups.inviteHelp}
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

      <NpubQrModal
        isOpen={scanDisclosure.isOpen}
        onClose={scanDisclosure.onClose}
        title={copy.groups.qrScannerTitle}
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
