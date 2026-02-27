import type { QuizQuestion, QuizAnswer } from '@/src/types';

/**
 * Calculate points for a single answered question.
 *
 * Type A (single): +1 if correct, +0 if wrong
 * Type B (multi): +1 per correct option selected, -1 per incorrect option selected, floor 0
 * Type C (flashcard): +1 if "I knew it", +0 if "I didn't"
 */
export function scoreQuestion(question: QuizQuestion, answer: QuizAnswer): number {
  if (question.type === 'single' && answer.kind === 'single') {
    return answer.optionId === question.correctOptionId ? 1 : 0;
  }

  if (question.type === 'multi' && answer.kind === 'multi') {
    const selected = new Set(answer.optionIds);
    const correct = new Set(question.correctOptionIds);
    const allOptions = question.options.map((o) => o.id);

    let score = 0;
    for (const optionId of allOptions) {
      const isCorrect = correct.has(optionId);
      const isSelected = selected.has(optionId);
      if (isCorrect && isSelected) score += 1;
      else if (!isCorrect && isSelected) score -= 1;
    }

    return Math.max(0, score);
  }

  if (question.type === 'flashcard' && answer.kind === 'flashcard') {
    return answer.knewIt ? 1 : 0;
  }

  return 0;
}

/**
 * Calculate total quiz points for all answered questions.
 */
export function calculateTotalPoints(
  questions: QuizQuestion[],
  answers: Record<string, QuizAnswer>
): number {
  let total = 0;
  for (const question of questions) {
    const answer = answers[question.id];
    if (answer) {
      total += scoreQuestion(question, answer);
    }
  }
  return total;
}

/**
 * Maximum possible points for a quiz.
 */
export function maxPossiblePoints(questions: QuizQuestion[]): number {
  let max = 0;
  for (const question of questions) {
    if (question.type === 'single') {
      max += 1;
    } else if (question.type === 'multi') {
      max += question.correctOptionIds.length;
    } else if (question.type === 'flashcard') {
      max += 1;
    }
  }
  return max;
}

/**
 * Count how many questions have been answered.
 */
export function answeredCount(
  questions: QuizQuestion[],
  answers: Record<string, QuizAnswer>
): number {
  return questions.filter((q) => answers[q.id] !== undefined).length;
}

/**
 * Check if all questions have been answered.
 */
export function isQuizComplete(
  questions: QuizQuestion[],
  answers: Record<string, QuizAnswer>
): boolean {
  return questions.length > 0 && answeredCount(questions, answers) === questions.length;
}
