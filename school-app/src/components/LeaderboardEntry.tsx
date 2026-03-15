import React from 'react';
import {
  HStack,
  Box,
  Text,
  Badge,
  Avatar,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';

type LeaderboardEntryProps = {
  rank: number;
  label: string;
  totalPoints: number;
  isYou?: boolean;
};

export default function LeaderboardEntry({
  rank,
  label,
  totalPoints,
  isYou = false,
}: LeaderboardEntryProps) {
  const copy = useCopy();

  return (
    <HStack
      spacing={4}
      p={4}
      borderWidth="1px"
      borderRadius="lg"
      borderColor={isYou ? 'brand.300' : 'borderSubtle'}
      bg={isYou ? 'surfaceMutedBg' : 'surfaceBg'}
      data-testid={`leaderboard-entry-${rank}`}
    >
      {/* Rank badge */}
      <Box
        w={8}
        h={8}
        borderRadius="full"
        bg={rank === 1 ? 'warning.300' : 'neutral.200'}
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        <Text fontSize="sm" fontWeight="bold" color={rank === 1 ? 'warning.900' : 'textMuted'}>
          {rank}
        </Text>
      </Box>

      {/* Avatar */}
      <Avatar
        size="sm"
        name={label}
        bg={isYou ? 'brand.400' : 'neutral.400'}
        color="white"
      />

      {/* Label */}
      <Box flex="1">
        <Text fontWeight={isYou ? 'bold' : 'semibold'} color={isYou ? 'brand.700' : 'textStrong'}>
          {label}
        </Text>
        {isYou && (
          <Badge fontSize="xs" variant="subtle">
            {copy.leaderboard.youBadge}
          </Badge>
        )}
      </Box>

      {/* Points */}
      <Box textAlign="right">
        <Text fontWeight="bold" fontSize="lg" color={isYou ? 'brand.600' : 'textStrong'} data-testid={`entry-points-${rank}`}>
          {totalPoints}
        </Text>
        <Text fontSize="xs" color="textMuted">
          {copy.leaderboard.pointsUnit}
        </Text>
      </Box>
    </HStack>
  );
}
