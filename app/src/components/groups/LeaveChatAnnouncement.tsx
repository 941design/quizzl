import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';

type LeaveChatAnnouncementProps = {
  memberDisplay: string;
};

export default function LeaveChatAnnouncement({ memberDisplay }: LeaveChatAnnouncementProps) {
  const copy = useCopy();

  return (
    <Box
      px={3}
      py={2}
      borderRadius="md"
      bg="gray.50"
      _dark={{ bg: 'gray.800' }}
      borderLeftWidth="3px"
      borderLeftColor="gray.400"
      data-testid="leave-chat-announcement"
    >
      <Text fontSize="sm" color="textMuted">
        {copy.groups.leftGroup(memberDisplay)}
      </Text>
    </Box>
  );
}
