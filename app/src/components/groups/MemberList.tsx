import React from 'react';
import {
  VStack,
  HStack,
  Text,
  Code,
  Box,
  Badge,
  Image,
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
};

export default function MemberList({ memberPubkeys, ownPubkeyHex, memberProfiles, confirmedPubkeys }: MemberListProps) {
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
}: MemberListItemProps) {
  const qrDisclosure = useDisclosure();

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
    </>
  );
}
