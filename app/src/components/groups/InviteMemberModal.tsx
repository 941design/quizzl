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
  Select,
  VStack,
  Alert,
  AlertIcon,
  AlertDescription,
  Text,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { listContacts, selectableContactsForGroup } from '@/src/lib/contacts';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';

type InviteMemberModalProps = {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
};

export type ResolveInviteTargetResult =
  | { ok: true; npub: string }
  | { ok: false; error: 'invalid_npub' };

/**
 * Thin adapter (DD-11, epic: invite-group-member-from-contacts S2). Converts
 * a stored contact's pubkeyHex directly to a canonical npub via
 * pubkeyToNpub.
 *
 * This is NOT the app's decode seam — that remains `parseContactCard`
 * (app/src/lib/contactCard.ts, DD-1 of epic-contact-card-exchange), which
 * handles free-text/card/link input elsewhere in the app. This function's
 * input is already a pubkey sourced from a picker-selected contact, so there
 * is nothing to decode; it only validates hex shape and re-encodes to npub
 * form. The 'invalid_npub' case is defensive (a malformed/empty pubkeyHex,
 * e.g. a stale option value) — not expected via the normal picker path since
 * pubkeyHex is sourced from a stored ContactListItem.
 */
export function resolveInviteTarget(pubkeyHex: string): ResolveInviteTargetResult {
  if (!pubkeyHex || !/^[0-9a-fA-F]{64}$/.test(pubkeyHex)) {
    return { ok: false, error: 'invalid_npub' };
  }
  return { ok: true, npub: pubkeyToNpub(pubkeyHex) };
}

/**
 * The exported async orchestration core of `handleInvite`, minus React state
 * (this repo's hooks-via-pure-function-extraction convention). Calls
 * resolveInviteTarget(pubkeyHex) first; on failure, returns that failure
 * WITHOUT ever invoking inviteByNpub. On success, calls the caller-supplied
 * inviteByNpub(groupId, npub) UNCHANGED and returns its result verbatim.
 * inviteByNpub itself (app/src/context/MarmotContext.tsx) is never modified
 * by this story — it stays npub/pubkey-only (architecture.md: "inviteByNpub
 * stays npub/pubkey-only").
 */
export async function submitInvite(
  pubkeyHex: string,
  groupId: string,
  inviteByNpub: (groupId: string, npub: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const resolved = resolveInviteTarget(pubkeyHex);
  if (!resolved.ok) return resolved;
  return inviteByNpub(groupId, resolved.npub);
}

export default function InviteMemberModal({ isOpen, onClose, groupId }: InviteMemberModalProps) {
  const copy = useCopy();
  const { inviteByNpub, groups } = useMarmot();
  const { pubkeyHex: ownPubkeyHex } = useNostrIdentity();
  const [selectedPubkeyHex, setSelectedPubkeyHex] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Guarded by isOpen: the component always mounts in groups.tsx, so this
  // avoids running listContacts on every unrelated parent re-render
  // (defense-in-depth for AC-SEC-1). Recomputed each render (no memoization)
  // so hasSelectable/isSelectionValid can never drift from the live
  // predicate output (AC-ERR-4).
  const memberPubkeys = groups.find((g) => g.id === groupId)?.memberPubkeys ?? [];
  const entries = isOpen
    ? selectableContactsForGroup(listContacts(ownPubkeyHex, { includeArchived: true }), { memberPubkeys })
    : [];
  const hasSelectable = entries.some((entry) => entry.selectable);
  const isSelectionValid = entries.some(
    (entry) => entry.selectable && entry.contact.pubkeyHex === selectedPubkeyHex,
  );

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
    if (!isSelectionValid) return;

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await submitInvite(selectedPubkeyHex, groupId, inviteByNpub);
      if (result.ok) {
        setSuccess(true);
        setSelectedPubkeyHex('');
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
    setSelectedPubkeyHex('');
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
            {hasSelectable ? (
              <FormControl isRequired>
                <FormLabel>{copy.groups.inviteContactLabel}</FormLabel>
                <Select
                  data-testid="invite-contact-select"
                  value={selectedPubkeyHex}
                  onChange={(e) => setSelectedPubkeyHex(e.target.value)}
                  bg="surfaceBg"
                >
                  {entries.map((entry) => {
                    const label =
                      entry.contact.nickname || truncateNpub(pubkeyToNpub(entry.contact.pubkeyHex));
                    const reasonSuffix =
                      entry.disabledReason === 'already_member'
                        ? ` (${copy.groups.inviteReasonAlreadyMember})`
                        : entry.disabledReason === 'blocked'
                          ? ` (${copy.groups.inviteReasonBlocked})`
                          : '';
                    return (
                      <option
                        key={entry.contact.pubkeyHex}
                        value={entry.contact.pubkeyHex}
                        disabled={!entry.selectable}
                      >
                        {label}
                        {reasonSuffix}
                      </option>
                    );
                  })}
                </Select>
              </FormControl>
            ) : (
              <VStack align="stretch" spacing={2} data-testid="invite-guidance-state">
                <Text fontSize="sm" color="textMuted">
                  {copy.groups.inviteGuidanceMessage}
                </Text>
                <NextLink href="/contacts" passHref legacyBehavior>
                  <Button as="a" variant="link" size="sm" alignSelf="flex-start" data-testid="invite-guidance-link">
                    {copy.groups.inviteGuidanceLink}
                  </Button>
                </NextLink>
              </VStack>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" mr={3} onClick={handleClose} isDisabled={isLoading}>
            {copy.groups.cancel}
          </Button>
          <Button
            onClick={() => void handleInvite()}
            isLoading={isLoading}
            isDisabled={!isSelectionValid || isLoading || success}
            data-testid="invite-submit-btn"
          >
            {copy.groups.inviteSubmit}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
