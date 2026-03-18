import React from 'react';
import {
  VStack,
  HStack,
  Text,
  Code,
  Box,
} from '@chakra-ui/react';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';

type MemberListProps = {
  memberPubkeys: string[];
  ownPubkeyHex: string | null;
};

export default function MemberList({ memberPubkeys, ownPubkeyHex }: MemberListProps) {
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

        return (
          <Box
            key={pubkey}
            p={3}
            borderRadius="md"
            bg="surfaceMutedBg"
            borderWidth="1px"
            borderColor="borderSubtle"
            data-testid={`member-item-${pubkey.slice(0, 8)}`}
          >
            <HStack justify="space-between" flexWrap="wrap" gap={2}>
              <Code
                fontSize="xs"
                bg="transparent"
                userSelect="all"
                data-testid={`member-npub-${pubkey.slice(0, 8)}`}
              >
                {truncateNpub(npub)}
              </Code>
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
        );
      })}
    </VStack>
  );
}
