import React, { useState, useEffect } from 'react';
import {
  Box,
  VStack,
  Text,
  Button,
  HStack,
  Collapse,
} from '@chakra-ui/react';
import type { QuizQuestion } from '@/src/types';
import { useCopy } from '@/src/context/LanguageContext';
import { useThemeStyles } from '@/src/hooks/useThemeStyles';
import ThemeIcon from '@/src/components/ThemeIcon';

type FlashcardProps = {
  question: Extract<QuizQuestion, { type: 'flashcard' }>;
  knewIt: boolean | null;
  onAnswer: (knewIt: boolean) => void;
};

export default function FlashcardQuestion({
  question,
  knewIt,
  onAnswer,
}: FlashcardProps) {
  const copy = useCopy();
  const { isFunTheme } = useThemeStyles();
  const [revealed, setRevealed] = useState(knewIt !== null);

  useEffect(() => {
    setRevealed(knewIt !== null);
  }, [question.id, knewIt]);

  return (
    <VStack spacing={4} align="stretch">
      {/* Front */}
      <Box
        p={6}
        bg="surfaceMutedBg"
        borderRadius="lg"
        borderWidth="1px"
        borderColor="borderSubtle"
        data-testid="flashcard-front"
      >
        <Text fontSize="sm" fontWeight="semibold" color="brand.600" mb={2}>
          {copy.quiz.flashcardQuestion}
        </Text>
        <Text fontWeight="semibold" fontSize="lg">
          {question.front}
        </Text>
      </Box>

      {/* Reveal button */}
      {!revealed && knewIt === null && (
        <Button
          variant="outline"
          onClick={() => setRevealed(true)}
          data-testid="reveal-answer-btn"
          leftIcon={isFunTheme ? <ThemeIcon name="reveal" size={16} /> : undefined}
        >
          {copy.quiz.revealAnswer}
        </Button>
      )}

      {/* Back */}
      <Collapse in={revealed} animateOpacity>
        <Box
          p={6}
          bg="surfaceRaisedBg"
          borderRadius="lg"
          borderWidth="1px"
          borderColor="borderSubtle"
          data-testid="flashcard-back"
        >
          <Text fontSize="sm" fontWeight="semibold" color="textMuted" mb={2}>
            {copy.quiz.flashcardAnswer}
          </Text>
          <Text>{question.back}</Text>
        </Box>
      </Collapse>

      {/* Self-assessment */}
      {revealed && knewIt === null && (
        <HStack spacing={4} justify="center">
          <Button
            colorScheme="danger"
            variant="outline"
            onClick={() => onAnswer(false)}
            data-testid="didnt-know-btn"
          >
            {copy.quiz.didntKnow}
          </Button>
          <Button
            colorScheme="success"
            onClick={() => onAnswer(true)}
            data-testid="knew-it-btn"
          >
            {copy.quiz.knewIt}
          </Button>
        </HStack>
      )}

      {/* Answered state */}
      {knewIt !== null && (
        <Box
          p={3}
          borderRadius="md"
          bg={knewIt ? 'successBg' : 'dangerBg'}
          borderWidth="1px"
          borderColor={knewIt ? 'successBorder' : 'dangerBorder'}
          data-testid="question-feedback"
        >
          <Text
            fontWeight="semibold"
            color={knewIt ? 'successText' : 'dangerText'}
          >
            {knewIt ? copy.quiz.knewItFeedback : copy.quiz.didntKnowFeedback}
          </Text>
        </Box>
      )}
    </VStack>
  );
}
