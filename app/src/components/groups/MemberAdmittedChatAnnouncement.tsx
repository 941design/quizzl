import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';

type MemberAdmittedChatAnnouncementProps = {
  /** Display name of the admin who approved the join request (resolved from the protocol sender). */
  admitterDisplay: string;
  /** Display name of the newly-admitted member. */
  memberDisplay: string;
};

export default function MemberAdmittedChatAnnouncement({
  admitterDisplay,
  memberDisplay,
}: MemberAdmittedChatAnnouncementProps) {
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
      data-testid="member-admitted-announcement"
    >
      <Text fontSize="sm" color="textMuted">
        {copy.groups.admittedMemberAnnouncement(admitterDisplay, memberDisplay)}
      </Text>
    </Box>
  );
}
