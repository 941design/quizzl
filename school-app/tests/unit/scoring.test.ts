import { describe, it, expect } from 'vitest';
import {
  scoreQuestion,
  calculateTotalPoints,
  maxPossiblePoints,
  answeredCount,
  isQuizComplete,
} from '@/src/lib/scoring';
import type { QuizQuestion, QuizAnswer } from '@/src/types';

// Fixtures
const singleQ: Extract<QuizQuestion, { type: 'single' }> = {
  id: 'q1',
  type: 'single',
  prompt: 'Pick one',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  correctOptionId: 'b',
};

const multiQ: Extract<QuizQuestion, { type: 'multi' }> = {
  id: 'q2',
  type: 'multi',
  prompt: 'Pick many',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
    { id: 'd', text: 'D' },
  ],
  correctOptionIds: ['a', 'c'],
};

const flashQ: Extract<QuizQuestion, { type: 'flashcard' }> = {
  id: 'q3',
  type: 'flashcard',
  front: 'What is X?',
  back: 'Y',
};

describe('scoreQuestion', () => {
  describe('Type A: single-choice', () => {
    it('returns 1 for correct answer', () => {
      expect(scoreQuestion(singleQ, { kind: 'single', optionId: 'b' })).toBe(1);
    });

    it('returns 0 for wrong answer', () => {
      expect(scoreQuestion(singleQ, { kind: 'single', optionId: 'a' })).toBe(0);
    });
  });

  describe('Type B: multi-choice', () => {
    it('returns max points when all correct selected, none wrong', () => {
      expect(scoreQuestion(multiQ, { kind: 'multi', optionIds: ['a', 'c'] })).toBe(2);
    });

    it('returns partial credit for one correct', () => {
      expect(scoreQuestion(multiQ, { kind: 'multi', optionIds: ['a'] })).toBe(1);
    });

    it('applies -1 penalty per wrong selection', () => {
      // select a (correct +1), b (wrong -1) = 0
      expect(scoreQuestion(multiQ, { kind: 'multi', optionIds: ['a', 'b'] })).toBe(0);
    });

    it('floors at 0 (never negative)', () => {
      // select b and d (both wrong) = -2 → floored to 0
      expect(scoreQuestion(multiQ, { kind: 'multi', optionIds: ['b', 'd'] })).toBe(0);
    });

    it('handles all options selected', () => {
      // a(+1) c(+1) b(-1) d(-1) = 0
      expect(scoreQuestion(multiQ, { kind: 'multi', optionIds: ['a', 'b', 'c', 'd'] })).toBe(0);
    });

    it('handles empty selection', () => {
      expect(scoreQuestion(multiQ, { kind: 'multi', optionIds: [] })).toBe(0);
    });
  });

  describe('Type C: flashcard', () => {
    it('returns 1 when user knew it', () => {
      expect(scoreQuestion(flashQ, { kind: 'flashcard', knewIt: true })).toBe(1);
    });

    it('returns 0 when user did not know it', () => {
      expect(scoreQuestion(flashQ, { kind: 'flashcard', knewIt: false })).toBe(0);
    });
  });

  it('returns 0 for mismatched question/answer kinds', () => {
    expect(scoreQuestion(singleQ, { kind: 'flashcard', knewIt: true })).toBe(0);
    expect(scoreQuestion(flashQ, { kind: 'single', optionId: 'a' })).toBe(0);
  });
});

describe('calculateTotalPoints', () => {
  const questions: QuizQuestion[] = [singleQ, multiQ, flashQ];

  it('sums points for all answered questions', () => {
    const answers: Record<string, QuizAnswer> = {
      q1: { kind: 'single', optionId: 'b' },      // 1
      q2: { kind: 'multi', optionIds: ['a', 'c'] }, // 2
      q3: { kind: 'flashcard', knewIt: true },      // 1
    };
    expect(calculateTotalPoints(questions, answers)).toBe(4);
  });

  it('ignores unanswered questions', () => {
    const answers: Record<string, QuizAnswer> = {
      q1: { kind: 'single', optionId: 'b' }, // 1
    };
    expect(calculateTotalPoints(questions, answers)).toBe(1);
  });

  it('returns 0 with no answers', () => {
    expect(calculateTotalPoints(questions, {})).toBe(0);
  });
});

describe('maxPossiblePoints', () => {
  it('calculates max: 1 for single, correctOptionIds.length for multi, 1 for flashcard', () => {
    expect(maxPossiblePoints([singleQ, multiQ, flashQ])).toBe(4); // 1 + 2 + 1
  });

  it('returns 0 for empty quiz', () => {
    expect(maxPossiblePoints([])).toBe(0);
  });
});

describe('answeredCount', () => {
  it('counts answered questions', () => {
    const answers: Record<string, QuizAnswer> = {
      q1: { kind: 'single', optionId: 'a' },
      q3: { kind: 'flashcard', knewIt: false },
    };
    expect(answeredCount([singleQ, multiQ, flashQ], answers)).toBe(2);
  });

  it('returns 0 with no answers', () => {
    expect(answeredCount([singleQ, multiQ], {})).toBe(0);
  });
});

describe('isQuizComplete', () => {
  it('returns true when all answered', () => {
    const answers: Record<string, QuizAnswer> = {
      q1: { kind: 'single', optionId: 'a' },
      q2: { kind: 'multi', optionIds: ['b'] },
      q3: { kind: 'flashcard', knewIt: false },
    };
    expect(isQuizComplete([singleQ, multiQ, flashQ], answers)).toBe(true);
  });

  it('returns false when some unanswered', () => {
    const answers: Record<string, QuizAnswer> = {
      q1: { kind: 'single', optionId: 'a' },
    };
    expect(isQuizComplete([singleQ, multiQ, flashQ], answers)).toBe(false);
  });

  it('returns false for empty quiz', () => {
    expect(isQuizComplete([], {})).toBe(false);
  });
});
