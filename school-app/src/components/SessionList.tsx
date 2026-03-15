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
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import { formatDuration } from '@/src/hooks/useStudyTimer';

type SessionListProps = {
  sessions: StudySession[];
  topicTitleBySlug?: Record<string, string>;
};

function formatDateTime(isoString: string, language: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SessionList({ sessions, topicTitleBySlug = {} }: SessionListProps) {
  const { language } = useLanguage();
  const copy = useCopy();

  if (sessions.length === 0) {
    return (
      <Box
        py={8}
        textAlign="center"
        color="textMuted"
        data-testid="session-list-empty"
      >
        <Text>{copy.studyTimes.noSessions}</Text>
        <Text fontSize="sm" mt={1} color="textMuted">
          {copy.studyTimes.noSessionsBody}
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
          : copy.studyTimes.general;

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
              <Text fontSize="xs" color="textMuted">
                {formatDateTime(session.startedAt, language)} - {formatDateTime(session.endedAt, language)}
              </Text>
            </Box>
            <Badge
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
