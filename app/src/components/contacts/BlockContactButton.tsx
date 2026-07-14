import React, { useState } from 'react';
import {
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Text,
  useDisclosure,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { archiveContact, unarchiveContact } from '@/src/lib/contacts';
import { wipeSinglePeerHistory } from '@/src/lib/marmot/chatPersistence';
import { performBlockContact, performUnblockContact } from '@/src/lib/blockContactAction';

type BlockContactButtonProps = {
  /** Hex pubkey of the contact this trigger acts on. */
  peerPubkeyHex: string;
  /** Current archived (blocked) state — decides which trigger renders. */
  isArchived: boolean;
  /** Called after either the block or unblock action completes, so the caller re-derives contact state (e.g. bumping a revision / re-reading getContact). */
  onChanged: () => void;
  /** Overrides the trigger button's data-testid. Defaults to 'profile-archive' (DD-10 — kept stable for the existing e2e consumer, groups-contacts.spec.ts). */
  testId?: string;
};

/**
 * Block/Unblock trigger + confirm dialog (epic: block-contact, story S4).
 *
 * Block (AC-CONFIRM-1/2, DD-11): mirrors `LeaveGroupButton.tsx`'s destructive-
 * action pattern — Chakra `Modal` + `useDisclosure`. Clicking the trigger only
 * opens the confirm modal; `performBlockContact` (and therefore `archiveContact`)
 * is invoked ONLY when the modal's confirm button is activated. Cancelling or
 * dismissing the modal calls neither `performBlockContact` nor any of its
 * three injected deps — `onClose` is the only effect.
 *
 * Unblock (AC-UNBLOCK-4, DD-6): no modal at all — the trigger calls
 * `performUnblockContact` directly.
 *
 * Reused by both `profile.tsx` (the block/unblock trigger for a contact's
 * profile page) and `contacts.tsx`'s `ContactDetailView` Blocked banner
 * (unblock-only usage — always rendered with `isArchived` already `true`
 * there, so only the Unblock branch below is ever reachable from that call
 * site).
 */
export default function BlockContactButton({
  peerPubkeyHex,
  isArchived,
  onChanged,
  testId = 'profile-archive',
}: BlockContactButtonProps) {
  const copy = useCopy();
  const { notifyBlockedPeersChanged } = useMarmot();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [isLoading, setIsLoading] = useState(false);

  async function handleConfirmBlock() {
    setIsLoading(true);
    try {
      await performBlockContact(peerPubkeyHex, {
        archiveContact,
        notifyBlockedPeersChanged,
        wipeSinglePeerHistory,
      });
    } finally {
      setIsLoading(false);
      onClose();
      onChanged();
    }
  }

  function handleUnblock() {
    performUnblockContact(peerPubkeyHex, { unarchiveContact, notifyBlockedPeersChanged });
    onChanged();
  }

  if (isArchived) {
    return (
      <Button
        variant="outline"
        onClick={handleUnblock}
        data-testid={testId}
      >
        {copy.profile.unarchiveAction}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={onOpen}
        data-testid={testId}
      >
        {copy.profile.archiveAction}
      </Button>

      <Modal isOpen={isOpen} onClose={onClose} isCentered>
        <ModalOverlay />
        <ModalContent data-testid="block-confirm-modal">
          <ModalHeader>{copy.contacts.blockConfirmTitle}</ModalHeader>
          <ModalCloseButton isDisabled={isLoading} />
          <ModalBody>
            <Text>{copy.contacts.blockConfirmBody}</Text>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost"
              mr={3}
              onClick={onClose}
              isDisabled={isLoading}
              data-testid="block-cancel-btn"
            >
              {copy.contacts.blockCancelButton}
            </Button>
            <Button
              colorScheme="danger"
              onClick={() => void handleConfirmBlock()}
              isLoading={isLoading}
              data-testid="block-confirm-btn"
            >
              {copy.contacts.blockConfirmButton}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
