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
