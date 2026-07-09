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
import { parseContactCard } from '@/src/lib/contactCard';
import { importCard } from '@/src/lib/contactCardImport';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';
import NpubQrButton from '@/src/components/groups/NpubQrButton';
import NpubQrModal from '@/src/components/groups/NpubQrModal';

export type AddContactModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

/** Mirrors contacts.ts's AddContactResult error union — reused, not redefined. */
export type AddContactSubmissionResult =
  | { ok: true; pubkeyHex: string; reactivated: boolean; cachedNickname: boolean }
  | { ok: false; error: 'invalid_npub' | 'self' | 'already_exists' };

/**
 * The single pure core both the paste path (`handleAdd`) and the scan path
 * (the `NpubQrModal` `onScan` handler below) route through — this is what makes
 * AC-UX-2's "identical outcome" true by construction rather than by parallel
 * re-implementation (epic: contact-card-exchange, story S4).
 *
 * Routes `input` through `parseContactCard` — the single card decode seam
 * (architecture.md DD 1) — FIRST. A `{ error }` result (e.g. a card whose
 * signature does not verify) is treated as an add-failure and `addContactByNpub`
 * is never called: no silent downgrade to a bare-pubkey add (AC-PARSE-4 /
 * VQ-S4-006).
 *
 * On a successful parse, re-encodes the decoded `pubkeyHex` back to an npub and
 * calls the UNCHANGED `addContactByNpub(npub, ownPubkeyHex)` — contact/knownPeers
 * seeding behaves exactly as it does for a bare npub today (AC-UX-1, AC-UX-5).
 *
 * The card's profile cache write is independent of the add outcome (AC-UX-6):
 * `importCard` runs whenever the parsed result carries a `profile` AND the add
 * either succeeded or failed with `already_exists` — refreshing the cached
 * nickname (subject to `importCard`'s own LWW) even when no new contact entry is
 * created. A `self` rejection (or a parse failure) never calls `importCard`.
 */
export function processContactInput(
  input: string,
  ownPubkeyHex: string | null | undefined,
): AddContactSubmissionResult {
  const parsed = parseContactCard(input);
  if ('error' in parsed) {
    return { ok: false, error: 'invalid_npub' };
  }

  const npub = pubkeyToNpub(parsed.pubkeyHex);
  const addResult = addContactByNpub(npub, ownPubkeyHex);

  const shouldImportProfile = addResult.ok || addResult.error === 'already_exists';
  let cachedNickname = false;
  if (shouldImportProfile && 'profile' in parsed && parsed.profile) {
    const importResult = importCard(parsed.pubkeyHex, parsed.profile);
    cachedNickname = importResult.cached;
  }

  if (!addResult.ok) {
    return { ok: false, error: addResult.error };
  }
  return {
    ok: true,
    pubkeyHex: addResult.pubkeyHex,
    reactivated: addResult.reactivated,
    cachedNickname,
  };
}

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
    const input = npubInput.trim();
    if (!input) return;

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Routes through processContactInput -> parseContactCard, so a pasted
      // card link/payload populates the nickname (AC-UX-1) exactly like a
      // scanned one does (AC-UX-2) -- same function, same outcome.
      const result = processContactInput(input, ownPubkeyHex);
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
        onScan={(scannedValue) => {
          // NpubQrScanner already validated scannedValue via
          // normaliseScanPayload (qr.ts) -- a bare npub OR a card link/payload.
          // Pre-fill the same input the paste path uses; submitting runs the
          // identical processContactInput core (AC-UX-2).
          setNpubInput(scannedValue);
          setError(null);
          scanDisclosure.onClose();
        }}
      />
    </>
  );
}
