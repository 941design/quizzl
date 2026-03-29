import React, { useEffect, useState } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  HStack,
  Switch,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import {
  loadInviteLinks,
  updateInviteLinkMuted,
  type InviteLink,
} from '@/src/lib/marmot/inviteLinkStorage';

type ManageInviteLinksModalProps = {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
};

export default function ManageInviteLinksModal({
  isOpen,
  onClose,
  groupId,
}: ManageInviteLinksModalProps) {
  const copy = useCopy();
  const [links, setLinks] = useState<InviteLink[]>([]);

  useEffect(() => {
    if (isOpen) {
      void loadInviteLinks(groupId).then(setLinks);
    }
  }, [isOpen, groupId]);

  async function handleToggleMute(nonce: string, muted: boolean) {
    await updateInviteLinkMuted(nonce, muted);
    setLinks((prev) =>
      prev.map((l) => (l.nonce === nonce ? { ...l, muted } : l)),
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered>
      <ModalOverlay />
      <ModalContent data-testid="manage-invite-links-modal">
        <ModalHeader>{copy.groups.manageLinksTitle}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <VStack spacing={3} align="stretch">
            {links.map((link) => (
              <HStack
                key={link.nonce}
                justify="space-between"
                p={2}
                bg="surfaceBg"
                borderRadius="md"
                data-testid={`invite-link-row-${link.nonce}`}
              >
                <VStack align="start" spacing={0}>
                  <Text fontSize="sm" fontWeight="medium">
                    {link.label || copy.groups.manageLinksUntitled}
                  </Text>
                  <Text fontSize="xs" color="textMuted">
                    {new Date(link.createdAt).toLocaleDateString()}
                  </Text>
                </VStack>
                <HStack spacing={2}>
                  <Text fontSize="xs" color="textMuted">
                    {copy.groups.manageLinksMuteLabel}
                  </Text>
                  <Switch
                    size="sm"
                    isChecked={link.muted}
                    onChange={() =>
                      void handleToggleMute(link.nonce, !link.muted)
                    }
                    data-testid={`mute-toggle-${link.nonce}`}
                  />
                </HStack>
              </HStack>
            ))}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
