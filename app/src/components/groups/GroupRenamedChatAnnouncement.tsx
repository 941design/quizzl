import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';

type GroupRenamedChatAnnouncementProps = {
  /** Display name of the admin who renamed the group (resolved from the protocol sender). */
  actorDisplay: string;
  /** The new group name carried by the notice. */
  newName: string;
};

export default function GroupRenamedChatAnnouncement({
  actorDisplay,
  newName,
}: GroupRenamedChatAnnouncementProps) {
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
      data-testid="group-renamed-announcement"
    >
      <Text fontSize="sm" color="textMuted">
        {copy.groups.renamedGroupAnnouncement(actorDisplay, newName)}
      </Text>
    </Box>
  );
}
