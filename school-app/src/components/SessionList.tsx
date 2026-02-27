import React from 'react';
import {
  Box,
  Text,
  VStack,
  HStack,
  Divider,
  Badge,
} from '@chakra-ui/react';
import type { StudySession } from '@/src/types';
import { formatDuration } from '@/src/hooks/useStudyTimer';

type SessionListProps = {
  sessions: StudySession[];
  topicTitleBySlug?: Record<string, string>;
};

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SessionList({ sessions, topicTitleBySlug = {} }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <Box
        py={8}
        textAlign="center"
        color="gray.500"
        data-testid="session-list-empty"
      >
        <Text>No study sessions yet.</Text>
        <Text fontSize="sm" mt={1} color="gray.400">
          Start a session on a topic page to track your study time.
        </Text>
      </Box>
    );
  }

  // Show most recent sessions first
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  return (
    <VStack
      spacing={0}
      align="stretch"
      divider={<Divider />}
      data-testid="session-list"
    >
      {sorted.map((session) => {
        const topicTitle = session.topicSlug
          ? topicTitleBySlug[session.topicSlug] ?? session.topicSlug
          : 'General';

        return (
          <HStack
            key={session.id}
            py={3}
            px={1}
            justify="space-between"
            flexWrap="wrap"
            gap={2}
            data-testid={`session-item-${session.id}`}
          >
            <Box>
              <Text fontWeight="semibold" fontSize="sm">
                {topicTitle}
              </Text>
              <Text fontSize="xs" color="gray.500">
                {formatDateTime(session.startedAt)} — {formatDateTime(session.endedAt)}
              </Text>
            </Box>
            <Badge
              colorScheme="teal"
              variant="subtle"
              fontSize="sm"
              data-testid={`session-duration-${session.id}`}
            >
              {formatDuration(session.durationMs)}
            </Badge>
          </HStack>
        );
      })}
    </VStack>
  );
}
