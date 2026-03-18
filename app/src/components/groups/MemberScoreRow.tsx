import React from 'react';
import { HStack, Text, Badge, Box, Image } from '@chakra-ui/react';
import { truncateNpub, pubkeyToNpub } from '@/src/lib/nostrKeys';
import type { MemberScore, ProfileAvatar } from '@/src/types';
import { totalPointsFromScores } from '@/src/lib/marmot/scoreSync';

type MemberScoreRowProps = {
  memberScore: MemberScore;
  isYou?: boolean;
  rank?: number;
  avatar?: ProfileAvatar | null;
};

export default function MemberScoreRow({ memberScore, isYou, rank, avatar }: MemberScoreRowProps) {
  const displayName =
    memberScore.nickname && memberScore.nickname.length > 8
      ? memberScore.nickname
      : truncateNpub(pubkeyToNpub(memberScore.pubkeyHex));

  const points = totalPointsFromScores(memberScore.scores);

  return (
    <HStack
      justify="space-between"
      p={3}
      bg={isYou ? 'surfaceRaisedBg' : 'surfaceBg'}
      borderRadius="md"
      borderWidth="1px"
      borderColor={isYou ? 'brand.200' : 'borderSubtle'}
      data-testid="member-score-row"
    >
      <HStack spacing={3}>
        {rank !== undefined && (
          <Text fontSize="sm" color="textMuted" minW="20px">
            #{rank}
          </Text>
        )}
        {avatar && (
          <Image
            src={avatar.imageUrl}
            alt={displayName}
            boxSize="24px"
            borderRadius="md"
            objectFit="contain"
            bg="white"
          />
        )}
        <Box>
          <Text fontSize="sm" fontWeight={isYou ? 'semibold' : 'normal'}>
            {displayName}
          </Text>
        </Box>
        {isYou && (
          <Badge colorScheme="brand" variant="subtle" fontSize="xs">
            You
          </Badge>
        )}
      </HStack>
      <Text fontWeight="bold" color="brand.600" data-testid="member-score-points">
        {points} pts
      </Text>
    </HStack>
  );
}
