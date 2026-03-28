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
import { useRouter } from 'next/router';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';

type LeaveGroupButtonProps = {
  groupId: string;
};

/**
 * Soft-leave: purges local state only — no MLS Remove proposal is sent.
 *
 * An MLS Remove proposal would block the entire group from sending
 * messages until an admin commits it (ts-mls enforces this per RFC 9420).
 * Instead we just delete local data and navigate away. The member becomes
 * a "ghost leaf" in the ratchet tree but cannot decrypt future messages.
 *
 * See specs/out-of-band-leave.md for the planned protocol-level solution
 * (kind 13 leave-intent application message + admin auto-remove).
 */
export default function LeaveGroupButton({ groupId }: LeaveGroupButtonProps) {
  const copy = useCopy();
  const { leaveGroup } = useMarmot();
  const router = useRouter();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [isLoading, setIsLoading] = useState(false);

  async function handleLeave() {
    setIsLoading(true);
    try {
      await leaveGroup(groupId);
      onClose();
      await router.push('/groups');
    } catch (err) {
      console.error('[LeaveGroupButton] leaveGroup failed:', err);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <Button
        colorScheme="danger"
        variant="outline"
        size="sm"
        onClick={onOpen}
        data-testid="leave-group-btn"
      >
        {copy.groups.leaveGroup}
      </Button>

      <Modal isOpen={isOpen} onClose={onClose} isCentered data-testid="leave-group-modal">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{copy.groups.leaveGroupTitle}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>{copy.groups.leaveGroupBody}</Text>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost"
              mr={3}
              onClick={onClose}
              isDisabled={isLoading}
            >
              {copy.groups.cancel}
            </Button>
            <Button
              colorScheme="danger"
              onClick={() => void handleLeave()}
              isLoading={isLoading}
              data-testid="leave-group-confirm-btn"
            >
              {copy.groups.leaveGroupConfirm}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
