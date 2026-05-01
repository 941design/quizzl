import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';

type InviteCancelledChatAnnouncementProps = {
  memberDisplay: string;
  cancellerDisplay: string;
};

export default function InviteCancelledChatAnnouncement({
  memberDisplay,
  cancellerDisplay,
}: InviteCancelledChatAnnouncementProps) {
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
      data-testid="invite-cancelled-announcement"
    >
      <Text fontSize="sm" color="textMuted">
        {copy.groups.cancelledByAnnouncement(memberDisplay, cancellerDisplay)}
      </Text>
    </Box>
  );
}
