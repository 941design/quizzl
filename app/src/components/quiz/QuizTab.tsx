import React, { useState, useEffect } from 'react';
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
import { useCopy } from '@/src/context/LanguageContext';
import { useThemeStyles } from '@/src/hooks/useThemeStyles';
import ThemeIcon from '@/src/components/ThemeIcon';
import SingleChoiceQuestion from './SingleChoiceQuestion';
import MultiChoiceQuestion from './MultiChoiceQuestion';
import FlashcardQuestion from './FlashcardQuestion';

type QuizTabProps = {
  topic: Topic;
  answers: Record<string, QuizAnswer>;
  onAnswer: (questionId: string, answer: QuizAnswer, newTotalPoints: number) => void;
  onRetry: () => void;
  /** Called once when the quiz reaches completion (all questions answered) */
  onComplete?: (result: { quizPoints: number; maxPoints: number }) => void;
};

export default function QuizTab({ topic, answers, onAnswer, onRetry, onComplete }: QuizTabProps) {
  const copy = useCopy();
  const questions = topic.quiz;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showFeedback, setShowFeedback] = useState(true);
  const [completionFired, setCompletionFired] = useState(false);

  if (questions.length === 0) {
    return (
      <Box py={8} textAlign="center">
        <Text color="textMuted" fontSize="lg">
          {copy.quiz.emptyHeading}
        </Text>
        <Text color="textMuted" mt={2}>
          {copy.quiz.emptyBody}
        </Text>
      </Box>
    );
  }

  const { cardStyle, isFunTheme } = useThemeStyles();
  const totalPoints = calculateTotalPoints(questions, answers);
  const maxPoints = maxPossiblePoints(questions);
  const answered = answeredCount(questions, answers);
  const complete = isQuizComplete(questions, answers);

  // Fire onComplete callback once when quiz becomes complete
  useEffect(() => {
    if (complete && !completionFired && onComplete) {
      setCompletionFired(true);
      onComplete({ quizPoints: totalPoints, maxPoints });
    }
    if (!complete && completionFired) {
      // Reset for retry
      setCompletionFired(false);
    }
  }, [complete, completionFired, onComplete, totalPoints, maxPoints]);

  // Show summary when complete
  if (complete) {
    return (
      <Box>
        <Box p={6} bg="surfaceMutedBg" borderRadius="lg" textAlign="center" mb={6} borderWidth="1px" borderColor="borderSubtle" {...cardStyle}>
          {isFunTheme && (
            <Box mb={2}>
              <ThemeIcon name="trophy" size={40} color="var(--chakra-colors-brand-500)" />
            </Box>
          )}
          <Heading size="lg" mb={2}>{copy.quiz.completeHeading}</Heading>
          <Text fontSize="xl" fontWeight="bold" color="brand.600">
            {totalPoints} / {maxPoints} points
          </Text>
          <Text color="textMuted" mt={1}>
            {copy.quiz.answeredSummary(questions.length)}
          </Text>
        </Box>

        <VStack spacing={4} mb={6}>
          {questions.map((q, idx) => {
            const answer = answers[q.id];
            const pts = answer ? scoreQuestion(q, answer) : 0;
            return (
              <HStack key={q.id} justify="space-between" w="100%" p={3} bg="surfaceRaisedBg" borderRadius="md" borderWidth="1px" borderColor="borderSubtle">
                <Text fontSize="sm" noOfLines={1} flex="1">
                  {idx + 1}.{' '}
                  {q.type === 'flashcard' ? q.front : q.prompt}
                </Text>
                <Badge colorScheme={pts > 0 ? 'success' : 'neutral'}>
                  {pts} {copy.leaderboard.pointsUnit}
                </Badge>
              </HStack>
            );
          })}
        </VStack>

        <Button
          onClick={() => {
            onRetry();
            setCurrentIndex(0);
          }}
          data-testid="retry-quiz-btn"
        >
          {copy.quiz.retry}
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
          <Text fontSize="sm" color="textMuted">
            {copy.quiz.questionProgress(currentIndex + 1, questions.length)}
          </Text>
          <Text fontSize="sm" color="textMuted">
            {copy.quiz.scoreProgress(answered, questions.length, totalPoints)}
          </Text>
        </HStack>
        <Progress
          value={(answered / questions.length) * 100}
          borderRadius="full"
          size="sm"
          data-testid="quiz-progress"
        />
      </Box>

      {/* Question Type Badge */}
      <Badge
        mb={4}
        textTransform="uppercase"
        fontSize="xs"
      >
        {currentQuestion.type === 'single'
          ? copy.quiz.singleChoice
          : currentQuestion.type === 'multi'
          ? copy.quiz.multiChoice
          : copy.quiz.flashcard}
      </Badge>

      {/* Question Card */}
      <Box
        p={6}
        bg="surfaceBg"
        borderRadius="lg"
        shadow="sm"
        borderWidth="1px"
        borderColor="borderSubtle"
        mb={6}
        data-testid="question-card"
        {...cardStyle}
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
          leftIcon={isFunTheme ? <ThemeIcon name="prev" size={16} /> : undefined}
        >
          {isFunTheme ? copy.quiz.previous : `← ${copy.quiz.previous}`}
        </Button>

        <Button
          onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
          isDisabled={currentIndex === questions.length - 1}
          data-testid="next-question-btn"
          rightIcon={isFunTheme ? <ThemeIcon name="next" size={16} /> : undefined}
        >
          {isFunTheme ? copy.quiz.next : `${copy.quiz.next} →`}
        </Button>
      </HStack>
    </Box>
  );
}
