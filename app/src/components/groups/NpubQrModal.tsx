import React, { useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Code,
  Image,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import NpubQrScanner from '@/src/components/groups/NpubQrScanner';

type NpubQrModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  mode: 'display' | 'scan';
  npub?: string;
  qrErrorMessage: string;
  invalidPayloadMessage?: string;
  permissionDeniedMessage?: string;
  unavailableMessage?: string;
  scannerHint?: string;
  onScan?: (npub: string) => void;
};

export default function NpubQrModal({
  isOpen,
  onClose,
  title,
  mode,
  npub,
  qrErrorMessage,
  invalidPayloadMessage,
  permissionDeniedMessage,
  unavailableMessage,
  scannerHint,
  onScan,
}: NpubQrModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || mode !== 'display' || !npub) {
      setQrDataUrl(null);
      setLoadingQr(false);
      setQrError(null);
      return;
    }

    let cancelled = false;
    const qrValue = npub;

    async function generateQrCode() {
      setLoadingQr(true);
      setQrError(null);

      try {
        const { default: QRCode } = await import('qrcode');
        const dataUrl = await QRCode.toDataURL(qrValue, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 320,
        });

        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      } catch (err) {
        if (!cancelled) {
          setQrError(qrErrorMessage);
          console.error('[NpubQrModal] QR generation failed:', err);
        }
      } finally {
        if (!cancelled) {
          setLoadingQr(false);
        }
      }
    }

    void generateQrCode();

    return () => {
      cancelled = true;
    };
  }, [isOpen, mode, npub, qrErrorMessage]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="md">
      <ModalOverlay />
      <ModalContent data-testid={`npub-qr-modal-${mode}`}>
        <ModalHeader>{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          {mode === 'display' ? (
            <VStack spacing={4} align="stretch">
              {qrError && (
                <Alert status="error" borderRadius="md">
                  <AlertIcon />
                  <AlertDescription>{qrError}</AlertDescription>
                </Alert>
              )}

              <Box
                minH="280px"
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
                    alt={npub ?? 'npub QR code'}
                    maxW="280px"
                    w="100%"
                    h="auto"
                    data-testid="npub-qr-image"
                  />
                )}
              </Box>

              {npub && (
                <>
                  <Text fontSize="sm" color="textMuted">
                    {npub}
                  </Text>
                  <Code
                    fontSize="xs"
                    whiteSpace="pre-wrap"
                    wordBreak="break-all"
                    p={3}
                    borderRadius="md"
                    bg="surfaceMutedBg"
                    data-testid="npub-qr-modal-value"
                  >
                    {npub}
                  </Code>
                </>
              )}
            </VStack>
          ) : (
            <NpubQrScanner
              invalidPayloadMessage={invalidPayloadMessage ?? qrErrorMessage}
              permissionDeniedMessage={permissionDeniedMessage ?? qrErrorMessage}
              unavailableMessage={unavailableMessage ?? qrErrorMessage}
              hint={scannerHint ?? ''}
              onScan={(value) => {
                if (onScan) onScan(value);
              }}
            />
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
