import React from 'react';
import {
  HStack,
  Box,
  Text,
  Badge,
  Avatar,
} from '@chakra-ui/react';

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
  return (
    <HStack
      spacing={4}
      p={4}
      borderWidth="1px"
      borderRadius="lg"
      borderColor={isYou ? 'teal.300' : 'gray.200'}
      bg={isYou ? 'teal.50' : 'white'}
      data-testid={`leaderboard-entry-${rank}`}
    >
      {/* Rank badge */}
      <Box
        w={8}
        h={8}
        borderRadius="full"
        bg={rank === 1 ? 'yellow.400' : 'gray.200'}
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        <Text fontSize="sm" fontWeight="bold" color={rank === 1 ? 'yellow.800' : 'gray.600'}>
          {rank}
        </Text>
      </Box>

      {/* Avatar */}
      <Avatar
        size="sm"
        name={label}
        bg={isYou ? 'teal.400' : 'gray.400'}
        color="white"
      />

      {/* Label */}
      <Box flex="1">
        <Text fontWeight={isYou ? 'bold' : 'semibold'} color={isYou ? 'teal.700' : 'gray.700'}>
          {label}
        </Text>
        {isYou && (
          <Badge colorScheme="teal" fontSize="xs" variant="subtle">
            You
          </Badge>
        )}
      </Box>

      {/* Points */}
      <Box textAlign="right">
        <Text fontWeight="bold" fontSize="lg" color={isYou ? 'teal.600' : 'gray.700'} data-testid={`entry-points-${rank}`}>
          {totalPoints}
        </Text>
        <Text fontSize="xs" color="gray.500">
          pts
        </Text>
      </Box>
    </HStack>
  );
}
