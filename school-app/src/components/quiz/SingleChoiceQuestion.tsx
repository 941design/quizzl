import React from 'react';
import {
  Box,
  VStack,
  RadioGroup,
  Radio,
  Text,
  Alert,
  AlertIcon,
} from '@chakra-ui/react';
import type { QuizQuestion } from '@/src/types';

type SingleQuestionProps = {
  question: Extract<QuizQuestion, { type: 'single' }>;
  selectedOptionId: string | null;
  onAnswer: (optionId: string) => void;
  showFeedback: boolean;
};

export default function SingleChoiceQuestion({
  question,
  selectedOptionId,
  onAnswer,
  showFeedback,
}: SingleQuestionProps) {
  const isCorrect = selectedOptionId === question.correctOptionId;

  return (
    <VStack spacing={4} align="stretch">
      <Text fontWeight="semibold" fontSize="lg" data-testid="question-prompt">
        {question.prompt}
      </Text>

      <RadioGroup
        value={selectedOptionId ?? ''}
        onChange={onAnswer}
      >
        <VStack spacing={3} align="stretch">
          {question.options.map((option) => {
            const isSelected = selectedOptionId === option.id;
            const isCorrectOption = option.id === question.correctOptionId;
            let bg = 'white';
            if (showFeedback && selectedOptionId !== null) {
              if (isCorrectOption) bg = 'green.50';
              else if (isSelected && !isCorrectOption) bg = 'red.50';
            }

            return (
              <Box
                key={option.id}
                p={3}
                borderRadius="md"
                borderWidth="1px"
                borderColor={
                  showFeedback && selectedOptionId !== null
                    ? isCorrectOption
                      ? 'green.300'
                      : isSelected
                      ? 'red.300'
                      : 'gray.200'
                    : isSelected
                    ? 'teal.400'
                    : 'gray.200'
                }
                bg={bg}
                transition="all 0.15s"
              >
                <Radio
                  value={option.id}
                  isDisabled={showFeedback && selectedOptionId !== null}
                  aria-label={option.text}
                  data-testid={`option-${option.id}`}
                >
                  {option.text}
                </Radio>
              </Box>
            );
          })}
        </VStack>
      </RadioGroup>

      {showFeedback && selectedOptionId !== null && (
        <Alert
          status={isCorrect ? 'success' : 'error'}
          borderRadius="md"
          data-testid="question-feedback"
        >
          <AlertIcon />
          <Box>
            <Text fontWeight="semibold">
              {isCorrect ? 'Correct!' : 'Incorrect'}
            </Text>
            {question.explanation && (
              <Text fontSize="sm" mt={1}>{question.explanation}</Text>
            )}
          </Box>
        </Alert>
      )}
    </VStack>
  );
}
