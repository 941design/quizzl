import React from 'react';
import { HStack, Stat, StatLabel, StatNumber, StatHelpText, Box } from '@chakra-ui/react';
import type { StudySession } from '@/src/types';
import { getTodayMs, getThisWeekMs, formatDuration } from '@/src/hooks/useStudyTimer';

type StudyTimeSummaryProps = {
  sessions: StudySession[];
};

export default function StudyTimeSummary({ sessions }: StudyTimeSummaryProps) {
  const todayMs = getTodayMs(sessions);
  const weekMs = getThisWeekMs(sessions);

  return (
    <HStack
      spacing={8}
      p={4}
      bg="gray.50"
      borderRadius="lg"
      flexWrap="wrap"
      data-testid="study-time-summary"
    >
      <Box>
        <Stat>
          <StatLabel>Today</StatLabel>
          <StatNumber fontSize="2xl" data-testid="today-total">
            {todayMs > 0 ? formatDuration(todayMs) : '0s'}
          </StatNumber>
          <StatHelpText>study time</StatHelpText>
        </Stat>
      </Box>
      <Box>
        <Stat>
          <StatLabel>This Week</StatLabel>
          <StatNumber fontSize="2xl" data-testid="week-total">
            {weekMs > 0 ? formatDuration(weekMs) : '0s'}
          </StatNumber>
          <StatHelpText>study time</StatHelpText>
        </Stat>
      </Box>
      <Box>
        <Stat>
          <StatLabel>Total Sessions</StatLabel>
          <StatNumber fontSize="2xl" data-testid="session-count">
            {sessions.length}
          </StatNumber>
          <StatHelpText>completed</StatHelpText>
        </Stat>
      </Box>
    </HStack>
  );
}
