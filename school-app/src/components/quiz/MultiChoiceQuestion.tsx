import React, { useState, useEffect } from 'react';
import {
  Box,
  VStack,
  Checkbox,
  CheckboxGroup,
  Text,
  Alert,
  AlertIcon,
  Button,
} from '@chakra-ui/react';
import type { QuizQuestion } from '@/src/types';
import { scoreQuestion } from '@/src/lib/scoring';

type MultiQuestionProps = {
  question: Extract<QuizQuestion, { type: 'multi' }>;
  selectedOptionIds: string[];
  onAnswer: (optionIds: string[]) => void;
  showFeedback: boolean;
  isAnswered: boolean;
};

export default function MultiChoiceQuestion({
  question,
  selectedOptionIds,
  onAnswer,
  showFeedback,
  isAnswered,
}: MultiQuestionProps) {
  const [localSelected, setLocalSelected] = useState<string[]>(selectedOptionIds);

  useEffect(() => {
    setLocalSelected(selectedOptionIds);
  }, [selectedOptionIds, question.id]);

  const correctSet = new Set(question.correctOptionIds);
  const score = isAnswered
    ? scoreQuestion(question, { kind: 'multi', optionIds: selectedOptionIds })
    : null;

  const handleSubmit = () => {
    onAnswer(localSelected);
  };

  return (
    <VStack spacing={4} align="stretch">
      <Text fontWeight="semibold" fontSize="lg" data-testid="question-prompt">
        {question.prompt}
      </Text>
      <Text fontSize="sm" color="gray.500">
        Select all that apply
      </Text>

      <CheckboxGroup
        value={localSelected}
        onChange={(vals) => !isAnswered && setLocalSelected(vals as string[])}
      >
        <VStack spacing={3} align="stretch">
          {question.options.map((option) => {
            const isSelected = isAnswered
              ? selectedOptionIds.includes(option.id)
              : localSelected.includes(option.id);
            const isCorrectOption = correctSet.has(option.id);
            let bg = 'white';
            if (showFeedback && isAnswered) {
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
                  showFeedback && isAnswered
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
                <Checkbox
                  value={option.id}
                  isDisabled={isAnswered}
                  aria-label={option.text}
                  data-testid={`option-${option.id}`}
                >
                  {option.text}
                </Checkbox>
              </Box>
            );
          })}
        </VStack>
      </CheckboxGroup>

      {!isAnswered && (
        <Button
          colorScheme="teal"
          onClick={handleSubmit}
          isDisabled={localSelected.length === 0}
          data-testid="submit-multi-answer"
        >
          Submit Answer
        </Button>
      )}

      {showFeedback && isAnswered && (
        <Alert
          status={score !== null && score > 0 ? 'success' : 'warning'}
          borderRadius="md"
          data-testid="question-feedback"
        >
          <AlertIcon />
          <Box>
            <Text fontWeight="semibold">
              Score: {score} point{score !== 1 ? 's' : ''}
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
