import React, { useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Heading,
  Text,
  VStack,
} from '@chakra-ui/react';
import { usePollStore } from '@/src/context/PollStoreContext';
import { useCopy } from '@/src/context/LanguageContext';
import type { MemberProfile } from '@/src/types';
import PollCard from './PollCard';
import PollResultsCard from './PollResultsCard';

type PollPanelProps = {
  pubkey: string;
  profileMap: Record<string, MemberProfile>;
};

export default function PollPanel({ pubkey, profileMap }: PollPanelProps) {
  const { polls, votes } = usePollStore();
  const copy = useCopy();
  const [showClosed, setShowClosed] = useState(false);

  const activePolls = polls.filter((p) => !p.closed);
  const closedPolls = polls.filter((p) => p.closed);

  return (
    <Box
      borderWidth="1px"
      borderColor="borderSubtle"
      borderRadius="md"
      p={3}
      h="400px"
      overflowY="auto"
      data-testid="poll-panel"
    >
      <Heading as="h3" size="sm" mb={3}>
        {copy.polls.heading(activePolls.length)}
      </Heading>

      {polls.length === 0 ? (
        <Flex align="center" justify="center" py={6}>
          <Text fontSize="sm" color="textMuted">
            {copy.polls.noPolls}
          </Text>
        </Flex>
      ) : (
        <VStack spacing={3} align="stretch">
          {/* Active polls */}
          {activePolls.map((poll) => (
            <PollCard
              key={poll.id}
              poll={poll}
              votes={votes[poll.id] ?? []}
              pubkey={pubkey}
              profileMap={profileMap}
            />
          ))}

          {/* Closed polls section */}
          {closedPolls.length > 0 && (
            <>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setShowClosed((v) => !v)}
                data-testid="poll-toggle-closed"
              >
                {showClosed ? copy.polls.hideClosed(closedPolls.length) : copy.polls.showClosed(closedPolls.length)}
              </Button>
              {showClosed &&
                closedPolls.map((poll) => (
                  <PollResultsCard
                    key={poll.id}
                    poll={poll}
                    profileMap={profileMap}
                  />
                ))}
            </>
          )}
        </VStack>
      )}
    </Box>
  );
}
