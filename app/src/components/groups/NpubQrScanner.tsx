import React, { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertIcon, Box, Spinner, Text, VStack } from '@chakra-ui/react';
import { canUseCameraQrScanner, normaliseNpubPayload } from '@/src/lib/qr';

type NpubQrScannerProps = {
  invalidPayloadMessage: string;
  permissionDeniedMessage: string;
  unavailableMessage: string;
  hint: string;
  onScan: (npub: string) => void;
};

export default function NpubQrScanner({
  invalidPayloadMessage,
  permissionDeniedMessage,
  unavailableMessage,
  hint,
  onScan,
}: NpubQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<{
    stop: () => void;
    destroy: () => void;
  } | null>(null);
  const handledRef = useRef(false);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canUseCameraQrScanner()) {
      setStarting(false);
      setError(unavailableMessage);
      return;
    }

    let mounted = true;

    async function startScanner() {
      try {
        const { default: QrScanner } = await import('qr-scanner');
        const video = videoRef.current;

        if (!video || !mounted) return;

        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          setError(unavailableMessage);
          setStarting(false);
          return;
        }

        const scanner = new QrScanner(
          video,
          (result: { data: string }) => {
            if (handledRef.current) return;

            const npub = normaliseNpubPayload(result.data);
            if (!npub) {
              setError(invalidPayloadMessage);
              return;
            }

            handledRef.current = true;
            scanner.stop();
            onScan(npub);
          },
          {
            onDecodeError: () => {},
            preferredCamera: 'environment',
            highlightScanRegion: true,
            returnDetailedScanResult: true,
            maxScansPerSecond: 8,
          }
        );

        scannerRef.current = scanner;
        await scanner.start();

        if (!mounted) {
          scanner.stop();
          scanner.destroy();
          return;
        }

        setStarting(false);
      } catch (err) {
        const message = err instanceof Error ? err.message.toLowerCase() : '';
        const denied = message.includes('denied') || message.includes('permission') || message.includes('notallowed');
        setError(denied ? permissionDeniedMessage : unavailableMessage);
        setStarting(false);
      }
    }

    void startScanner();

    return () => {
      mounted = false;
      handledRef.current = false;
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
  }, [invalidPayloadMessage, onScan, permissionDeniedMessage, unavailableMessage]);

  return (
    <VStack spacing={4} align="stretch">
      {error && (
        <Alert status="warning" borderRadius="md" data-testid="npub-qr-scan-error">
          <AlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Box
        position="relative"
        borderRadius="lg"
        overflow="hidden"
        bg="black"
        minH="280px"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Box
          as="video"
          ref={videoRef}
          muted
          playsInline
          w="100%"
          h="100%"
          objectFit="cover"
          data-testid="npub-qr-video"
        />
        {starting && (
          <VStack
            spacing={3}
            position="absolute"
            inset={0}
            bg="rgba(0, 0, 0, 0.55)"
            color="white"
            justify="center"
          >
            <Spinner />
            <Text fontSize="sm">Starting camera...</Text>
          </VStack>
        )}
      </Box>

      <Text fontSize="sm" color="textMuted">
        {hint}
      </Text>
    </VStack>
  );
}
