import React from 'react';
import { HStack, Stat, StatLabel, StatNumber, StatHelpText, Box } from '@chakra-ui/react';
import type { StudySession } from '@/src/types';
import { useCopy } from '@/src/context/LanguageContext';
import { getTodayMs, getThisWeekMs, formatDuration } from '@/src/hooks/useStudyTimer';

type StudyTimeSummaryProps = {
  sessions: StudySession[];
};

export default function StudyTimeSummary({ sessions }: StudyTimeSummaryProps) {
  const copy = useCopy();
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
          <StatLabel>{copy.studyTimes.today}</StatLabel>
          <StatNumber fontSize="2xl" data-testid="today-total">
            {todayMs > 0 ? formatDuration(todayMs) : '0s'}
          </StatNumber>
          <StatHelpText>{copy.studyTimes.studyTime}</StatHelpText>
        </Stat>
      </Box>
      <Box>
        <Stat>
          <StatLabel>{copy.studyTimes.thisWeek}</StatLabel>
          <StatNumber fontSize="2xl" data-testid="week-total">
            {weekMs > 0 ? formatDuration(weekMs) : '0s'}
          </StatNumber>
          <StatHelpText>{copy.studyTimes.studyTime}</StatHelpText>
        </Stat>
      </Box>
      <Box>
        <Stat>
          <StatLabel>{copy.studyTimes.totalSessions}</StatLabel>
          <StatNumber fontSize="2xl" data-testid="session-count">
            {sessions.length}
          </StatNumber>
          <StatHelpText>{copy.studyTimes.completed}</StatHelpText>
        </Stat>
      </Box>
    </HStack>
  );
}
