import React from 'react';
import {
  HStack,
  Button,
  Text,
  Alert,
  AlertIcon,
  AlertDescription,
  AlertTitle,
  Box,
  ButtonGroup,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useStudyTimer, formatElapsed } from '@/src/hooks/useStudyTimer';

type StudyTimerProps = {
  topicSlug?: string;
};

export default function StudyTimer({ topicSlug }: StudyTimerProps) {
  const copy = useCopy();
  const {
    isRunning,
    elapsedMs,
    hydrated,
    hasOrphanedSession,
    start,
    stop,
    recoverContinue,
    recoverStop,
  } = useStudyTimer(topicSlug);

  if (!hydrated) return null;

  if (hasOrphanedSession) {
    return (
      <Alert
        status="warning"
        borderRadius="md"
        mb={4}
        flexDirection={{ base: 'column', sm: 'row' }}
        alignItems="flex-start"
        data-testid="session-recovery-banner"
      >
        <AlertIcon />
        <Box flex="1">
          <AlertTitle>{copy.studyTimer.activeSessionTitle}</AlertTitle>
          <AlertDescription>
            {copy.studyTimer.activeSessionBody}
          </AlertDescription>
        </Box>
        <ButtonGroup mt={{ base: 2, sm: 0 }} ml={{ base: 0, sm: 4 }} size="sm">
          <Button
            onClick={recoverContinue}
            data-testid="session-recover-continue"
          >
            {copy.studyTimer.continue}
          </Button>
          <Button
            variant="outline"
            onClick={recoverStop}
            data-testid="session-recover-stop"
          >
            {copy.studyTimer.stop}
          </Button>
        </ButtonGroup>
      </Alert>
    );
  }

  return (
    <HStack spacing={3} data-testid="study-timer">
      {isRunning && (
        <Text
          fontSize="sm"
          fontWeight="semibold"
          color="brand.600"
          fontFamily="mono"
          data-testid="timer-elapsed"
        >
          {formatElapsed(elapsedMs)}
        </Text>
      )}
      <Button
        size="sm"
        colorScheme={isRunning ? 'danger' : 'brand'}
        variant={isRunning ? 'solid' : 'outline'}
        onClick={isRunning ? stop : start}
        data-testid={isRunning ? 'stop-session-btn' : 'start-session-btn'}
      >
        {isRunning ? copy.studyTimer.stopSession : copy.studyTimer.startSession}
      </Button>
    </HStack>
  );
}
