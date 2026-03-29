import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';

type PollChatAnnouncementProps = {
  creatorName: string;
  title: string;
};

export default function PollChatAnnouncement({ creatorName, title }: PollChatAnnouncementProps) {
  const copy = useCopy();

  return (
    <Box
      px={3}
      py={2}
      borderRadius="md"
      bg="blue.50"
      _dark={{ bg: 'blue.900' }}
      borderLeftWidth="3px"
      borderLeftColor="blue.400"
      data-testid="poll-chat-announcement"
    >
      <Flex gap={2} align="center" mb={1}>
        <Text fontSize="xs" fontWeight="bold" color="blue.600" _dark={{ color: 'blue.200' }}>
          {copy.polls.pollLabel}
        </Text>
      </Flex>
      <Text fontSize="sm" fontWeight="medium">
        {copy.polls.startedPoll(creatorName)}
      </Text>
      <Text fontSize="sm" color="textMuted" mt={0.5}>
        &ldquo;{title}&rdquo;
      </Text>
    </Box>
  );
}
