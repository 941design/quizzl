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
  const [revealed, setRevealed] = useState(knewIt !== null);

  useEffect(() => {
    setRevealed(knewIt !== null);
  }, [question.id, knewIt]);

  return (
    <VStack spacing={4} align="stretch">
      {/* Front */}
      <Box
        p={6}
        bg="teal.50"
        borderRadius="lg"
        borderWidth="1px"
        borderColor="teal.200"
        data-testid="flashcard-front"
      >
        <Text fontSize="sm" fontWeight="semibold" color="teal.600" mb={2}>
          Question
        </Text>
        <Text fontWeight="semibold" fontSize="lg">
          {question.front}
        </Text>
      </Box>

      {/* Reveal button */}
      {!revealed && knewIt === null && (
        <Button
          colorScheme="teal"
          variant="outline"
          onClick={() => setRevealed(true)}
          data-testid="reveal-answer-btn"
        >
          Reveal Answer
        </Button>
      )}

      {/* Back */}
      <Collapse in={revealed} animateOpacity>
        <Box
          p={6}
          bg="gray.50"
          borderRadius="lg"
          borderWidth="1px"
          borderColor="gray.200"
          data-testid="flashcard-back"
        >
          <Text fontSize="sm" fontWeight="semibold" color="gray.600" mb={2}>
            Answer
          </Text>
          <Text>{question.back}</Text>
        </Box>
      </Collapse>

      {/* Self-assessment */}
      {revealed && knewIt === null && (
        <HStack spacing={4} justify="center">
          <Button
            colorScheme="red"
            variant="outline"
            onClick={() => onAnswer(false)}
            data-testid="didnt-know-btn"
          >
            I didn&apos;t know it
          </Button>
          <Button
            colorScheme="green"
            onClick={() => onAnswer(true)}
            data-testid="knew-it-btn"
          >
            I knew it!
          </Button>
        </HStack>
      )}

      {/* Answered state */}
      {knewIt !== null && (
        <Box
          p={3}
          borderRadius="md"
          bg={knewIt ? 'green.50' : 'red.50'}
          borderWidth="1px"
          borderColor={knewIt ? 'green.200' : 'red.200'}
          data-testid="question-feedback"
        >
          <Text
            fontWeight="semibold"
            color={knewIt ? 'green.700' : 'red.700'}
          >
            {knewIt ? 'You knew it! +1 point' : "You didn't know it. Keep studying!"}
          </Text>
        </Box>
      )}
    </VStack>
  );
}
