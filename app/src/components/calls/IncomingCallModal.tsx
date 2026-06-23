/**
 * IncomingCallModal.tsx — Globally-visible ringing call modal (Story S6).
 *
 * Mounts in Layout.tsx (alongside IncomingCallWatcher). Reads incoming call
 * state from useCallStore() and renders a Chakra UI Modal that lets the user
 * accept or decline the call.
 *
 * Design decisions:
 *   - Caller identity resolution: looks up caller's pubkey in the contacts
 *     store (same strategy as NotificationBell). Falls back to truncated npub.
 *     ProfileContext only tracks the *local* user's profile, so we cannot use
 *     it to look up arbitrary callers — contacts store is the right seam.
 *   - onClose is wired to declineCall: dismissing the modal is semantically
 *     identical to declining. The ModalCloseButton is intentionally omitted
 *     to avoid a "close without action" path that would leave callStore in a
 *     stale ringing state.
 *   - Buttons call getCallManager() at the moment of the click, not at render
 *     time, because the manager is a singleton that may not yet exist when the
 *     component first mounts.
 *   - Modal stays unmounted (isOpen=false) when incoming is null — Chakra
 *     handles the open/close transition automatically via isOpen.
 */

import React from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Badge,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useCallStore } from '@/src/lib/calls/callStore';
import { getCallManager } from '@/src/components/calls/IncomingCallWatcher';
import { useCopy } from '@/src/context/LanguageContext';
import { listContacts } from '@/src/lib/contacts';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';

// ── Component ─────────────────────────────────────────────────────────────────

export function IncomingCallModal() {
  const { incoming } = useCallStore();
  const copy = useCopy();
  const { pubkeyHex: ownPubkeyHex } = useNostrIdentity();

  const isOpen = incoming !== null;

  // Resolve caller display name: contacts store → truncated npub fallback.
  // We read contacts at render time; this is a cheap synchronous lookup.
  const callerDisplayName = React.useMemo(() => {
    if (!incoming) return '';
    const contacts = listContacts(ownPubkeyHex ?? '', { includeArchived: true });
    const contact = contacts.find((c) => c.pubkeyHex === incoming.callerPubkey);
    if (contact?.nickname) return contact.nickname;
    try {
      return truncateNpub(pubkeyToNpub(incoming.callerPubkey));
    } catch {
      // Fallback for malformed pubkey (should never happen in practice)
      return incoming.callerPubkey.slice(0, 12) + '…';
    }
  }, [incoming, ownPubkeyHex]);

  function handleAccept() {
    if (!incoming) return;
    void getCallManager()?.acceptCall(incoming.callId);
  }

  function handleDecline() {
    if (!incoming) return;
    void getCallManager()?.declineCall(incoming.callId);
  }

  // onClose treated as decline (closing the modal = declining the call)
  function handleClose() {
    handleDecline();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      isCentered
      closeOnOverlayClick={false}
      closeOnEsc={false}
      data-testid="incoming-call-modal"
    >
      <ModalOverlay />
      <ModalContent data-testid="incoming-call-modal-content">
        <ModalHeader data-testid="incoming-call-caller-name">
          {callerDisplayName}
        </ModalHeader>
        <ModalBody>
          <VStack spacing={3} align="stretch">
            <Text fontSize="sm" color="textMuted">
              {copy.calls.incomingCallTitle}
            </Text>
            <Badge
              colorScheme={incoming?.callType === 'video' ? 'blue' : 'green'}
              alignSelf="flex-start"
              data-testid="incoming-call-type-badge"
            >
              {incoming?.callType === 'video'
                ? copy.calls.incomingVideoCall
                : copy.calls.incomingVoiceCall}
            </Badge>
          </VStack>
        </ModalBody>
        <ModalFooter gap={3}>
          <Button
            colorScheme="red"
            variant="outline"
            onClick={handleDecline}
            data-testid="incoming-call-decline-btn"
          >
            {copy.calls.declineCall}
          </Button>
          <Button
            colorScheme="green"
            onClick={handleAccept}
            data-testid="incoming-call-accept-btn"
          >
            {copy.calls.acceptCall}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
