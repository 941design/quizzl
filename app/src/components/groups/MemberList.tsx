import React from 'react';
import {
  VStack,
  HStack,
  Text,
  Code,
  Box,
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
};

export default function MemberList({ memberPubkeys, ownPubkeyHex, memberProfiles }: MemberListProps) {
  const copy = useCopy();

  if (memberPubkeys.length === 0) {
    return (
      <Text color="textMuted" fontSize="sm">
        No members yet.
      </Text>
    );
  }

  return (
    <VStack align="stretch" spacing={2}>
      {memberPubkeys.map((pubkey) => {
        const npub = pubkeyToNpub(pubkey);
        const isYou = pubkey === ownPubkeyHex;
        const profile = memberProfiles?.[pubkey];

        return (
          <MemberListItem
            key={pubkey}
            pubkey={pubkey}
            npub={npub}
            isYou={isYou}
            profile={profile}
            showQrLabel={copy.groups.showQr}
            qrTitle={copy.groups.qrModalTitle}
            qrErrorMessage={copy.groups.qrGenerationError}
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
  profile?: MemberProfile;
  showQrLabel: string;
  qrTitle: string;
  qrErrorMessage: string;
};

function MemberListItem({
  pubkey,
  npub,
  isYou,
  profile,
  showQrLabel,
  qrTitle,
  qrErrorMessage,
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
              <>
                <Text fontSize="sm" fontWeight="medium">
                  {profile.nickname}
                </Text>
                <Code fontSize="xs" bg="transparent" color="textMuted" userSelect="all"
                  data-testid={`member-npub-${pubkey.slice(0, 8)}`}>
                  {truncateNpub(npub)}
                </Code>
              </>
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
              You
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
