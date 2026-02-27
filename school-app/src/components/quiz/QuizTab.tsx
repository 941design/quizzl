import React, { useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Button,
  Text,
  Progress,
  Heading,
  Divider,
  Badge,
} from '@chakra-ui/react';
import type { Topic, QuizAnswer } from '@/src/types';
import {
  scoreQuestion,
  calculateTotalPoints,
  maxPossiblePoints,
  answeredCount,
  isQuizComplete,
} from '@/src/lib/scoring';
import SingleChoiceQuestion from './SingleChoiceQuestion';
import MultiChoiceQuestion from './MultiChoiceQuestion';
import FlashcardQuestion from './FlashcardQuestion';

type QuizTabProps = {
  topic: Topic;
  answers: Record<string, QuizAnswer>;
  onAnswer: (questionId: string, answer: QuizAnswer, newTotalPoints: number) => void;
  onRetry: () => void;
};

export default function QuizTab({ topic, answers, onAnswer, onRetry }: QuizTabProps) {
  const questions = topic.quiz;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showFeedback, setShowFeedback] = useState(true);

  if (questions.length === 0) {
    return (
      <Box py={8} textAlign="center">
        <Text color="gray.500" fontSize="lg">
          This topic has no quiz questions yet.
        </Text>
        <Text color="gray.400" mt={2}>
          Try the Notes or Study Plan tabs to continue learning.
        </Text>
      </Box>
    );
  }

  const totalPoints = calculateTotalPoints(questions, answers);
  const maxPoints = maxPossiblePoints(questions);
  const answered = answeredCount(questions, answers);
  const complete = isQuizComplete(questions, answers);

  // Show summary when complete
  if (complete) {
    return (
      <Box>
        <Box p={6} bg="teal.50" borderRadius="lg" textAlign="center" mb={6}>
          <Heading size="lg" mb={2}>Quiz Complete!</Heading>
          <Text fontSize="xl" fontWeight="bold" color="teal.600">
            {totalPoints} / {maxPoints} points
          </Text>
          <Text color="gray.600" mt={1}>
            {questions.length} question{questions.length !== 1 ? 's' : ''} answered
          </Text>
        </Box>

        <VStack spacing={4} mb={6}>
          {questions.map((q, idx) => {
            const answer = answers[q.id];
            const pts = answer ? scoreQuestion(q, answer) : 0;
            return (
              <HStack key={q.id} justify="space-between" w="100%" p={3} bg="gray.50" borderRadius="md">
                <Text fontSize="sm" noOfLines={1} flex="1">
                  {idx + 1}.{' '}
                  {q.type === 'flashcard' ? q.front : q.prompt}
                </Text>
                <Badge colorScheme={pts > 0 ? 'green' : 'gray'}>
                  {pts} pt{pts !== 1 ? 's' : ''}
                </Badge>
              </HStack>
            );
          })}
        </VStack>

        <Button
          colorScheme="teal"
          onClick={() => {
            onRetry();
            setCurrentIndex(0);
          }}
          data-testid="retry-quiz-btn"
        >
          Retry Quiz
        </Button>
      </Box>
    );
  }

  const currentQuestion = questions[currentIndex];
  const currentAnswer = answers[currentQuestion.id];

  const handleSingleAnswer = (optionId: string) => {
    const answer: QuizAnswer = { kind: 'single', optionId };
    const newPoints = calculateTotalPoints(questions, { ...answers, [currentQuestion.id]: answer });
    onAnswer(currentQuestion.id, answer, newPoints);
  };

  const handleMultiAnswer = (optionIds: string[]) => {
    const answer: QuizAnswer = { kind: 'multi', optionIds };
    const newPoints = calculateTotalPoints(questions, { ...answers, [currentQuestion.id]: answer });
    onAnswer(currentQuestion.id, answer, newPoints);
  };

  const handleFlashcardAnswer = (knewIt: boolean) => {
    const answer: QuizAnswer = { kind: 'flashcard', knewIt };
    const newPoints = calculateTotalPoints(questions, { ...answers, [currentQuestion.id]: answer });
    onAnswer(currentQuestion.id, answer, newPoints);
  };

  return (
    <Box>
      {/* Progress Header */}
      <Box mb={6}>
        <HStack justify="space-between" mb={2}>
          <Text fontSize="sm" color="gray.600">
            Question {currentIndex + 1} of {questions.length}
          </Text>
          <Text fontSize="sm" color="gray.600">
            {answered}/{questions.length} answered · {totalPoints} pts
          </Text>
        </HStack>
        <Progress
          value={(answered / questions.length) * 100}
          colorScheme="teal"
          borderRadius="full"
          size="sm"
          data-testid="quiz-progress"
        />
      </Box>

      {/* Question Type Badge */}
      <Badge
        colorScheme="teal"
        mb={4}
        textTransform="uppercase"
        fontSize="xs"
      >
        {currentQuestion.type === 'single'
          ? 'Single Choice'
          : currentQuestion.type === 'multi'
          ? 'Multiple Choice'
          : 'Flashcard'}
      </Badge>

      {/* Question Card */}
      <Box
        p={6}
        bg="white"
        borderRadius="lg"
        shadow="sm"
        borderWidth="1px"
        mb={6}
        data-testid="question-card"
      >
        {currentQuestion.type === 'single' && (
          <SingleChoiceQuestion
            question={currentQuestion}
            selectedOptionId={
              currentAnswer?.kind === 'single' ? currentAnswer.optionId : null
            }
            onAnswer={handleSingleAnswer}
            showFeedback={showFeedback}
          />
        )}

        {currentQuestion.type === 'multi' && (
          <MultiChoiceQuestion
            question={currentQuestion}
            selectedOptionIds={
              currentAnswer?.kind === 'multi' ? currentAnswer.optionIds : []
            }
            onAnswer={handleMultiAnswer}
            showFeedback={showFeedback}
            isAnswered={!!currentAnswer}
          />
        )}

        {currentQuestion.type === 'flashcard' && (
          <FlashcardQuestion
            question={currentQuestion}
            knewIt={
              currentAnswer?.kind === 'flashcard' ? currentAnswer.knewIt : null
            }
            onAnswer={handleFlashcardAnswer}
          />
        )}
      </Box>

      <Divider mb={4} />

      {/* Navigation */}
      <HStack justify="space-between">
        <Button
          variant="outline"
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          isDisabled={currentIndex === 0}
          data-testid="prev-question-btn"
        >
          ← Previous
        </Button>

        <Button
          colorScheme="teal"
          onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
          isDisabled={currentIndex === questions.length - 1}
          data-testid="next-question-btn"
        >
          Next →
        </Button>
      </HStack>
    </Box>
  );
}
