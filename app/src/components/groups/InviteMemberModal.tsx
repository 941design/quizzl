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
import { parseContactCard } from '@/src/lib/contactCard';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';

type InviteMemberModalProps = {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
};

export type ResolveInviteTargetResult =
  | { ok: true; npub: string }
  | { ok: false; error: 'invalid_npub' };

/**
 * S5 (epic: contact-card-exchange) — the single down-conversion point for the
 * group invite input. Pure, synchronous, no side effects.
 *
 * Routes `input` through `parseContactCard` (@/src/lib/contactCard) — the
 * SINGLE decode seam every npub entry point in this epic uses (architecture.md
 * DD 1). Never re-implements card-byte parsing inline.
 *
 * On `{ error }`, returns `{ ok: false, error: 'invalid_npub' }` — a
 * signature-invalid or malformed card is a hard failure, never a silent
 * downgrade to a bare-pubkey pass (mirrors S4's processContactInput
 * precedent for the same class of input).
 *
 * On success (bare npub OR card, with or without a `profile` field), the
 * `profile` field — if present — is DISCARDED: only `pubkeyHex` is used,
 * re-encoded to canonical npub form via `pubkeyToNpub`. This is the load-
 * bearing privacy/DD-8 boundary of this story: no caller of this function
 * ever sees a card's name, so nothing downstream of it can write that name
 * to contactCache/contacts/knownPeers.
 *
 * A bare npub input round-trips unchanged: parseContactCard(npub) →
 * { pubkeyHex } → pubkeyToNpub(pubkeyHex) → the same npub. Bare-npub invite
 * behavior is therefore unchanged from before this story.
 */
export function resolveInviteTarget(input: string): ResolveInviteTargetResult {
  const parsed = parseContactCard(input);
  if ('error' in parsed) return { ok: false, error: 'invalid_npub' };
  return { ok: true, npub: pubkeyToNpub(parsed.pubkeyHex) };
}

/**
 * S5 — the exported async orchestration core of `handleInvite`, minus React
 * state. This IS the production down-conversion + invite call, extracted so
 * it can be driven directly in a unit test (no jsdom) per this repo's
 * hooks-via-pure-function-extraction convention.
 *
 * Calls `resolveInviteTarget(input)` first. On failure, returns that failure
 * WITHOUT ever invoking `inviteByNpub` — a signature-invalid card must never
 * reach the invite/relay/MLS layer.
 *
 * On success, calls the caller-supplied `inviteByNpub(groupId, npub)`
 * UNCHANGED and returns its result verbatim. `inviteByNpub` itself
 * (app/src/context/MarmotContext.tsx) is never modified by this story — it
 * stays npub/pubkey-only; down-conversion happens ONLY here, at the caller
 * (architecture.md: "inviteByNpub stays npub/pubkey-only").
 */
export async function submitInvite(
  input: string,
  groupId: string,
  inviteByNpub: (groupId: string, npub: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const resolved = resolveInviteTarget(input);
  if (!resolved.ok) return resolved;
  return inviteByNpub(groupId, resolved.npub);
}

export default function InviteMemberModal({ isOpen, onClose, groupId }: InviteMemberModalProps) {
  const copy = useCopy();
  const { inviteByNpub } = useMarmot();
  const scanDisclosure = useDisclosure();
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
      case 'timeout':
        return copy.groups.inviteErrorTimeout;
      default:
        return copy.groups.inviteErrorGeneric;
    }
  }

  async function handleInvite() {
    const input = npubInput.trim();
    if (!input) return;

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // S5: input may be a bare npub OR a card (link/QR/payload) — submitInvite
      // is the single down-conversion + invite call (see its doc comment above).
      const result = await submitInvite(input, groupId, inviteByNpub);
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
        onScan={(scannedValue) => {
          // May be a bare npub OR a contact-card link/payload since S4 widened
          // the shared scanner; submitInvite re-parses it via parseContactCard.
          setNpubInput(scannedValue);
          setError(null);
          scanDisclosure.onClose();
        }}
      />
    </>
  );
}
