import React from 'react';
import {
  Box,
  Flex,
  Heading,
  Text,
  VStack,
} from '@chakra-ui/react';
import type { Poll } from '@/src/lib/marmot/pollPersistence';
import { useCopy } from '@/src/context/LanguageContext';

type PollResultsCardProps = {
  poll: Poll;
  profileMap: Record<string, { nickname: string }>;
};

export default function PollResultsCard({ poll, profileMap }: PollResultsCardProps) {
  const copy = useCopy();
  const results = poll.results ?? [];
  const totalVoters = poll.totalVoters ?? 0;
  const totalVotes = results.reduce((sum, r) => sum + r.count, 0);

  const creatorName = profileMap[poll.creatorPubkey]?.nickname ?? poll.creatorPubkey.slice(0, 8);

  return (
    <Box
      borderWidth="1px"
      borderColor="borderSubtle"
      borderRadius="md"
      p={3}
      opacity={0.85}
      data-testid={`poll-results-card-${poll.id}`}
    >
      <Heading as="h4" size="xs" mb={1} noOfLines={2}>
        {poll.title}
      </Heading>
      <Text fontSize="xs" color="textMuted" mb={2}>
        by {creatorName} &middot; {copy.polls.closed}
      </Text>

      <VStack spacing={2} align="stretch">
        {results.map((r) => {
          const pct = totalVotes > 0 ? Math.round((r.count / totalVotes) * 100) : 0;
          return (
            <Box key={r.optionId}>
              <Flex justify="space-between" mb={0.5}>
                <Text fontSize="xs" fontWeight="medium" noOfLines={1} title={r.label}>
                  {r.label}
                </Text>
                <Text fontSize="xs" color="textMuted" flexShrink={0} ml={2}>
                  {r.count} ({pct}%)
                </Text>
              </Flex>
              <Box
                bg="gray.100"
                _dark={{ bg: 'gray.700' }}
                borderRadius="sm"
                h="6px"
                overflow="hidden"
              >
                <Box
                  bg="brand.500"
                  h="100%"
                  w={`${pct}%`}
                  borderRadius="sm"
                  transition="width 0.3s"
                />
              </Box>
            </Box>
          );
        })}
      </VStack>

      <Text fontSize="xs" color="textMuted" mt={2}>
        {copy.polls.voterCount(totalVoters)}
      </Text>
    </Box>
  );
}
