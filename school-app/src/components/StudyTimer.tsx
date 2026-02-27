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
import { useStudyTimer, formatElapsed } from '@/src/hooks/useStudyTimer';

type StudyTimerProps = {
  topicSlug?: string;
};

export default function StudyTimer({ topicSlug }: StudyTimerProps) {
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
          <AlertTitle>Active study session detected</AlertTitle>
          <AlertDescription>
            You may have refreshed during a session. Would you like to continue or stop it?
          </AlertDescription>
        </Box>
        <ButtonGroup mt={{ base: 2, sm: 0 }} ml={{ base: 0, sm: 4 }} size="sm">
          <Button
            colorScheme="teal"
            onClick={recoverContinue}
            data-testid="session-recover-continue"
          >
            Continue
          </Button>
          <Button
            variant="outline"
            onClick={recoverStop}
            data-testid="session-recover-stop"
          >
            Stop
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
          color="teal.600"
          fontFamily="mono"
          data-testid="timer-elapsed"
        >
          {formatElapsed(elapsedMs)}
        </Text>
      )}
      <Button
        size="sm"
        colorScheme={isRunning ? 'red' : 'teal'}
        variant={isRunning ? 'solid' : 'outline'}
        onClick={isRunning ? stop : start}
        data-testid={isRunning ? 'stop-session-btn' : 'start-session-btn'}
      >
        {isRunning ? 'Stop Session' : 'Start Session'}
      </Button>
    </HStack>
  );
}
