import React, { useState } from 'react';
import {
  VStack,
  HStack,
  Text,
  Code,
  Box,
  Badge,
  Button,
  Image,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import NpubQrButton from '@/src/components/groups/NpubQrButton';
import NpubQrModal from '@/src/components/groups/NpubQrModal';
import type { MemberProfile } from '@/src/types';

type MemberListProps = {
  memberPubkeys: string[];
  ownPubkeyHex: string | null;
  memberProfiles?: Record<string, MemberProfile>;
  /** Pubkeys that have confirmed membership (sent a profile in this group) */
  confirmedPubkeys?: Set<string>;
  /** Called when the user confirms cancellation of a pending invite for the given pubkey */
  onCancelInvite?: (pubkey: string) => Promise<void>;
};

export default function MemberList({ memberPubkeys, ownPubkeyHex, memberProfiles, confirmedPubkeys, onCancelInvite }: MemberListProps) {
  const copy = useCopy();

  if (memberPubkeys.length === 0) {
    return (
      <Text color="textMuted" fontSize="sm">
        {copy.groups.noMembersYet}
      </Text>
    );
  }

  return (
    <VStack align="stretch" spacing={2}>
      {memberPubkeys.map((pubkey) => {
        const npub = pubkeyToNpub(pubkey);
        const isYou = pubkey === ownPubkeyHex;
        const profile = memberProfiles?.[pubkey];
        const isPending = confirmedPubkeys ? !confirmedPubkeys.has(pubkey) && !isYou : false;

        return (
          <MemberListItem
            key={pubkey}
            pubkey={pubkey}
            npub={npub}
            isYou={isYou}
            isPending={isPending}
            profile={profile}
            showQrLabel={copy.groups.showQr}
            qrTitle={copy.groups.qrModalTitle}
            qrErrorMessage={copy.groups.qrGenerationError}
            pendingLabel={copy.groups.memberPending}
            youLabel={copy.groups.memberYou}
            cancelInviteLabel={copy.groups.cancelInviteButton}
            cancelInviteTitle={copy.groups.cancelInviteTitle}
            cancelInviteBody={copy.groups.cancelInviteBody}
            cancelInviteConfirm={copy.groups.cancelInviteConfirm}
            cancelLabel={copy.groups.cancel}
            onCancelInvite={isPending && !isYou ? onCancelInvite : undefined}
          />
        );
      })}
    </VStack>
  );
}

type MemberListItemProps = {
  pubkey: string;
  npub: string;
  isYou: boolean;
  isPending: boolean;
  profile?: MemberProfile;
  showQrLabel: string;
  qrTitle: string;
  qrErrorMessage: string;
  pendingLabel: string;
  youLabel: string;
  cancelInviteLabel: string;
  cancelInviteTitle: string;
  cancelInviteBody: string;
  cancelInviteConfirm: string;
  cancelLabel: string;
  onCancelInvite?: (pubkey: string) => Promise<void>;
};

function MemberListItem({
  pubkey,
  npub,
  isYou,
  isPending,
  profile,
  showQrLabel,
  qrTitle,
  qrErrorMessage,
  pendingLabel,
  youLabel,
  cancelInviteLabel,
  cancelInviteTitle,
  cancelInviteBody,
  cancelInviteConfirm,
  cancelLabel,
  onCancelInvite,
}: MemberListItemProps) {
  const qrDisclosure = useDisclosure();
  const cancelDisclosure = useDisclosure();
  const [isCancelling, setIsCancelling] = useState(false);

  async function handleConfirmCancel() {
    if (!onCancelInvite) return;
    setIsCancelling(true);
    try {
      await onCancelInvite(pubkey);
    } finally {
      setIsCancelling(false);
      cancelDisclosure.onClose();
    }
  }

  const displayName = profile?.nickname ?? truncateNpub(npub) + '…';

  return (
    <>
      <Box
        p={3}
        borderRadius="md"
        bg="surfaceMutedBg"
        borderWidth="1px"
        borderColor="borderSubtle"
        opacity={isPending ? 0.6 : 1}
        data-testid={`member-item-${pubkey.slice(0, 8)}`}
      >
        <HStack justify="space-between" flexWrap="wrap" gap={2}>
          <HStack spacing={2}>
            {profile?.avatar && (
              <Image
                src={profile.avatar.imageUrl}
                alt={profile.nickname}
                boxSize="28px"
                borderRadius="md"
                objectFit="contain"
                bg="white"
              />
            )}
            {profile?.nickname ? (
              <Text fontSize="sm" fontWeight="medium"
                data-testid={`member-name-${pubkey.slice(0, 8)}`}>
                {profile.nickname}
              </Text>
            ) : (
              <Code
                fontSize="xs"
                bg="transparent"
                userSelect="all"
                data-testid={`member-npub-${pubkey.slice(0, 8)}`}
              >
                {truncateNpub(npub)}
              </Code>
            )}
            {isPending && (
              <Badge
                colorScheme="yellow"
                variant="subtle"
                fontSize="2xs"
                data-testid={`member-pending-${pubkey.slice(0, 8)}`}
              >
                {pendingLabel}
              </Badge>
            )}
            <NpubQrButton
              label={showQrLabel}
              onClick={qrDisclosure.onOpen}
              data-testid={`member-show-qr-${pubkey.slice(0, 8)}`}
            />
          </HStack>
          <HStack spacing={2}>
            {isYou && (
              <Text
                fontSize="xs"
                fontWeight="semibold"
                color="brand.500"
                data-testid="member-you-badge"
              >
                {youLabel}
              </Text>
            )}
            {isPending && !isYou && onCancelInvite && (
              <Button
                size="xs"
                colorScheme="red"
                variant="ghost"
                onClick={cancelDisclosure.onOpen}
                data-testid={`cancel-invite-${pubkey.slice(0, 8)}`}
              >
                {cancelInviteLabel}
              </Button>
            )}
          </HStack>
        </HStack>
      </Box>

      <NpubQrModal
        isOpen={qrDisclosure.isOpen}
        onClose={qrDisclosure.onClose}
        title={qrTitle}
        mode="display"
        npub={npub}
        qrErrorMessage={qrErrorMessage}
      />

      <Modal isOpen={cancelDisclosure.isOpen} onClose={cancelDisclosure.onClose} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{cancelInviteTitle}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text fontWeight="medium" mb={2}>{displayName}</Text>
            <Text fontSize="sm" color="textMuted">{cancelInviteBody}</Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={cancelDisclosure.onClose} isDisabled={isCancelling}>
              {cancelLabel}
            </Button>
            <Button
              colorScheme="red"
              onClick={handleConfirmCancel}
              isLoading={isCancelling}
              data-testid={`cancel-invite-confirm-${pubkey.slice(0, 8)}`}
            >
              {cancelInviteConfirm}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
