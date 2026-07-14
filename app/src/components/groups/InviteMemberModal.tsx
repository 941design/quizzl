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
  Box,
  Flex,
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
import ProfileSummary from '@/src/components/ProfileSummary';

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
 * form. The 'invalid_npub' case is defensive (a malformed/empty pubkeyHex
 * from a stale picker selection) — not expected via the normal picker path
 * since pubkeyHex is sourced from a stored ContactListItem.
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

/**
 * Pure selection-state predicate over the row-based contact picker's
 * entries (mutation-gate extraction, epic-invite-contact-picker-redesign
 * S1 — same hooks-via-pure-function-extraction convention as
 * resolveInviteTarget/submitInvite above). hasSelectable answers "is there
 * at least one row the user could click"; isSelectionValid answers "is the
 * CURRENTLY selected pubkeyHex still a selectable row" (guards against a
 * stale selection surviving a re-render where the entry became disabled,
 * e.g. the invitee left the group's pending members or got blocked
 * mid-picker).
 */
export function computeSelectionState(
  entries: { selectable: boolean; contact: { pubkeyHex: string } }[],
  selectedPubkeyHex: string,
): { hasSelectable: boolean; isSelectionValid: boolean } {
  return {
    hasSelectable: entries.some((entry) => entry.selectable),
    isSelectionValid: entries.some(
      (entry) => entry.selectable && entry.contact.pubkeyHex === selectedPubkeyHex,
    ),
  };
}

/**
 * Pure error-code → user-facing copy mapping (mutation-gate extraction,
 * same rationale as computeSelectionState above). Previously an inline
 * closure inside the component, invisible to unit tests; the branch/default
 * shape is identical, this only lifts it to module scope and takes `copy`
 * as a parameter instead of closing over it.
 */
export function getErrorMessage(
  errorCode: string | undefined,
  copy: {
    inviteErrorInvalidNpub: string;
    inviteErrorNoKeyPackage: string;
    inviteErrorOffline: string;
    inviteErrorTimeout: string;
    inviteErrorGeneric: string;
  },
): string {
  switch (errorCode) {
    case 'invalid_npub':
      return copy.inviteErrorInvalidNpub;
    case 'no_key_package':
      return copy.inviteErrorNoKeyPackage;
    case 'offline':
      return copy.inviteErrorOffline;
    case 'timeout':
      return copy.inviteErrorTimeout;
    default:
      return copy.inviteErrorGeneric;
  }
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
  const { hasSelectable, isSelectionValid } = computeSelectionState(entries, selectedPubkeyHex);

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
        setError(getErrorMessage(result.error, copy.groups));
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
    <Modal isOpen={isOpen} onClose={handleClose} isCentered size="lg" data-testid="invite-member-modal">
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
              <Box>
                <Text fontWeight="medium" mb={2}>
                  {copy.groups.inviteContactLabel}
                </Text>
                <VStack
                  align="stretch"
                  spacing={2}
                  maxH="320px"
                  overflowY="auto"
                  data-testid="invite-contact-list"
                >
                  {entries.map((entry) => {
                    const isSelected = entry.selectable && entry.contact.pubkeyHex === selectedPubkeyHex;
                    const fallbackName = truncateNpub(pubkeyToNpub(entry.contact.pubkeyHex));
                    const reasonText =
                      entry.disabledReason === 'already_member'
                        ? copy.groups.inviteReasonAlreadyMember
                        : entry.disabledReason === 'blocked'
                          ? copy.groups.inviteReasonBlocked
                          : null;
                    return (
                      <Box
                        key={entry.contact.pubkeyHex}
                        data-testid={`invite-contact-row-${entry.contact.pubkeyHex}`}
                        role="button"
                        aria-pressed={entry.selectable ? isSelected : undefined}
                        aria-disabled={!entry.selectable}
                        tabIndex={entry.selectable ? 0 : -1}
                        p={3}
                        borderWidth="1px"
                        borderRadius="lg"
                        borderColor={isSelected ? 'brand.400' : 'borderSubtle'}
                        boxShadow={isSelected ? '0 0 0 2px var(--chakra-colors-brand-400)' : undefined}
                        bg="surfaceBg"
                        transition="all 0.15s"
                        opacity={entry.selectable ? 1 : 0.5}
                        cursor={entry.selectable ? 'pointer' : 'not-allowed'}
                        _hover={entry.selectable ? { borderColor: 'brand.400', bg: 'surfaceMutedBg' } : undefined}
                        {...(entry.selectable
                          ? {
                              onClick: () => setSelectedPubkeyHex(entry.contact.pubkeyHex),
                              onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedPubkeyHex(entry.contact.pubkeyHex);
                                }
                              },
                            }
                          : {})}
                      >
                        <Flex align="center" justify="space-between" gap={2}>
                          <ProfileSummary
                            profile={{ nickname: entry.contact.nickname, avatar: entry.contact.avatar }}
                            fallbackName={fallbackName}
                            size="sm"
                          />
                          {reasonText && (
                            <Text fontSize="xs" color="textMuted" flexShrink={0}>
                              {reasonText}
                            </Text>
                          )}
                        </Flex>
                      </Box>
                    );
                  })}
                </VStack>
              </Box>
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
