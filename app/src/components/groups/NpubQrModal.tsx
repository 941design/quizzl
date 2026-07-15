import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
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
import { generateQrDataUrl } from '@/src/lib/qr';

/**
 * S5 (epic: contact-pairing-code, AC-UI-1) — the validity-hint render gate.
 * Exported as a pure predicate (mirrors this repo's "prop-derivation logic"
 * test convention for components the vitest environment cannot render — see
 * `memberListAdminUi.test.ts`'s doc comment) so the gating condition itself
 * is unit-tested directly, even though the DOM output is not. `shareUrl` is
 * the sole gate (matches the `shareUrl && copyButtonLabel` Copy-button gate
 * already used below): a bare-npub or group-invite display never has a
 * `shareUrl`, so this hint only ever appears on an actual pairing share card.
 */
export function shouldShowValidityHint(shareUrl: string | undefined, validityHint: string | undefined): boolean {
  return Boolean(shareUrl && validityHint);
}

type NpubQrModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  mode: 'display' | 'scan';
  npub?: string;
  /**
   * Widened display-seam contract (epic: contact-card-exchange, story S6):
   * a pre-built, ready-to-share value (currently the full onboarding URL,
   * `https://few.chat/add#c=<payload>`, produced by the caller via
   * `encodeCard`/`buildShareUrl` — see `@/src/lib/shareCard`). When present
   * it takes priority over `npub` for BOTH the QR payload (encoded at ECC-L
   * instead of the bare-npub ECC-M) and the displayed/copyable text, and a
   * translated Copy button renders below the QR. This component never
   * builds or parses that value itself — it only ever receives the
   * finished string, per the story's hard boundary (no signer/codec inside
   * NpubQrModal). When omitted, display mode falls back to the original
   * bare-npub-at-ECC-M behaviour unchanged, so this stays a generic value
   * renderer rather than card-specific.
   */
  shareUrl?: string;
  /** Translated label for the Copy button shown under a `shareUrl`-encoded QR. */
  copyButtonLabel?: string;
  /** Translated label shown briefly after a successful copy. */
  copiedButtonLabel?: string;
  /**
   * Translated copy communicating the shared code's limited validity window
   * (epic: contact-pairing-code, story S5, AC-UI-1 — e.g. "This code works
   * for about 30 minutes."). Rendered under the QR/value block only when a
   * `shareUrl`-encoded card is shown, so it never appears on the generic
   * bare-npub or group-invite uses of this modal. This component only ever
   * renders the translated string it is given — it never owns i18n or
   * derives the window itself (mirrors the `shareUrl` seam's "generic value
   * renderer" contract above).
   */
  validityHint?: string;
  qrErrorMessage: string;
  invalidPayloadMessage?: string;
  permissionDeniedMessage?: string;
  unavailableMessage?: string;
  scannerHint?: string;
  /**
   * Widened scan-seam contract (epic: contact-card-exchange, story S4): carries
   * the validated, normalised scan payload from `NpubQrScanner` — a bare npub OR
   * a contact-card onboarding link / raw card payload. Callers parse it (via
   * `parseContactCard`) when they need the decoded pubkey/profile; this modal
   * never parses card bytes itself.
   */
  onScan?: (value: string) => void;
};

export default function NpubQrModal({
  isOpen,
  onClose,
  title,
  mode,
  npub,
  shareUrl,
  copyButtonLabel,
  copiedButtonLabel,
  validityHint,
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
  const [copied, setCopied] = useState(false);

  const displayValue = shareUrl ?? npub;

  useEffect(() => {
    if (!isOpen || mode !== 'display' || !displayValue) {
      setQrDataUrl(null);
      setLoadingQr(false);
      setQrError(null);
      return;
    }

    let cancelled = false;
    const qrValue = displayValue;
    const eccLevel = shareUrl ? 'L' : 'M';

    async function generateQrCode() {
      setLoadingQr(true);
      setQrError(null);

      try {
        const dataUrl = await generateQrDataUrl(qrValue, eccLevel);

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
  }, [isOpen, mode, displayValue, shareUrl, qrErrorMessage]);

  // Reset the transient "copied" flag whenever the modal is (re)opened or
  // the value it would copy changes.
  useEffect(() => {
    setCopied(false);
  }, [isOpen, shareUrl]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: do nothing silently — the value is still visible/selectable in the Code block.
    }
  }, [shareUrl]);

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
                    alt={displayValue ?? 'npub QR code'}
                    maxW="280px"
                    w="100%"
                    h="auto"
                    data-testid="npub-qr-image"
                  />
                )}
              </Box>

              {displayValue && (
                <>
                  <Code
                    fontSize="xs"
                    whiteSpace="pre-wrap"
                    wordBreak="break-all"
                    p={3}
                    borderRadius="md"
                    bg="surfaceMutedBg"
                    data-testid="npub-qr-modal-value"
                  >
                    {displayValue}
                  </Code>
                  {shareUrl && copyButtonLabel && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCopy()}
                      data-testid="npub-qr-modal-copy-btn"
                    >
                      {copied ? (copiedButtonLabel ?? copyButtonLabel) : copyButtonLabel}
                    </Button>
                  )}
                  {shouldShowValidityHint(shareUrl, validityHint) && (
                    <Text fontSize="xs" color="textMuted" data-testid="npub-qr-modal-validity-hint">
                      {validityHint}
                    </Text>
                  )}
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
