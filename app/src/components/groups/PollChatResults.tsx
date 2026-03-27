import React from 'react';
import { Box, Flex, Text, VStack } from '@chakra-ui/react';
import type { PollResult } from '@/src/lib/marmot/pollPersistence';

type PollChatResultsProps = {
  creatorName: string;
  title: string;
  results: PollResult[];
  totalVoters: number;
};

export default function PollChatResults({
  creatorName,
  title,
  results,
  totalVoters,
}: PollChatResultsProps) {
  const totalVotes = results.reduce((sum, r) => sum + r.count, 0);

  return (
    <Box
      px={3}
      py={2}
      borderRadius="md"
      bg="green.50"
      _dark={{ bg: 'green.900' }}
      borderLeftWidth="3px"
      borderLeftColor="green.400"
      data-testid="poll-chat-results"
    >
      <Flex gap={2} align="center" mb={1}>
        <Text fontSize="xs" fontWeight="bold" color="green.600" _dark={{ color: 'green.200' }}>
          Poll Results
        </Text>
      </Flex>
      <Text fontSize="sm" fontWeight="medium">
        {creatorName} closed the poll
      </Text>
      <Text fontSize="sm" color="textMuted" mt={0.5} mb={2}>
        &ldquo;{title}&rdquo;
      </Text>

      <VStack spacing={1.5} align="stretch">
        {results.map((r) => {
          const pct = totalVotes > 0 ? Math.round((r.count / totalVotes) * 100) : 0;
          return (
            <Box key={r.optionId}>
              <Flex justify="space-between" mb={0.5}>
                <Text fontSize="xs" noOfLines={1}>{r.label}</Text>
                <Text fontSize="xs" color="textMuted" flexShrink={0} ml={2}>{pct}%</Text>
              </Flex>
              <Box bg="gray.200" _dark={{ bg: 'gray.600' }} borderRadius="sm" h="4px" overflow="hidden">
                <Box bg="green.500" h="100%" w={`${pct}%`} borderRadius="sm" />
              </Box>
            </Box>
          );
        })}
      </VStack>

      <Text fontSize="xs" color="textMuted" mt={2}>
        {totalVoters} {totalVoters === 1 ? 'vote' : 'votes'}
      </Text>
    </Box>
  );
}
