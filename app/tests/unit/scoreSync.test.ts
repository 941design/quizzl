import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildScoreUpdate,
  serialiseScoreUpdate,
  parseScorePayload,
  nextSequenceNumber,
  totalPointsFromScores,
} from '@/src/lib/marmot/scoreSync';
import type { ScoreUpdate } from '@/src/types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe('scoreSync', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('nextSequenceNumber', () => {
    it('starts at 1 when no sequence stored', () => {
      expect(nextSequenceNumber()).toBe(1);
    });

    it('increments on each call', () => {
      expect(nextSequenceNumber()).toBe(1);
      expect(nextSequenceNumber()).toBe(2);
      expect(nextSequenceNumber()).toBe(3);
    });

    it('persists sequence across calls', () => {
      nextSequenceNumber(); // 1
      nextSequenceNumber(); // 2
      // Reset the function reference (new call reads localStorage)
      expect(nextSequenceNumber()).toBe(3);
    });
  });

  describe('buildScoreUpdate', () => {
    it('builds a valid ScoreUpdate with sequential numbers', () => {
      const update = buildScoreUpdate({
        topicSlug: 'js-basics',
        quizPoints: 8,
        maxPoints: 10,
        completedTasks: 3,
        totalTasks: 5,
      });

      expect(update.topicSlug).toBe('js-basics');
      expect(update.quizPoints).toBe(8);
      expect(update.maxPoints).toBe(10);
      expect(update.completedTasks).toBe(3);
      expect(update.totalTasks).toBe(5);
      expect(typeof update.lastStudiedAt).toBe('string');
      expect(update.sequenceNumber).toBe(1);
    });

    it('assigns increasing sequence numbers', () => {
      const first = buildScoreUpdate({ topicSlug: 'a', quizPoints: 1, maxPoints: 5, completedTasks: 0, totalTasks: 0 });
      const second = buildScoreUpdate({ topicSlug: 'b', quizPoints: 2, maxPoints: 5, completedTasks: 0, totalTasks: 0 });
      expect(second.sequenceNumber).toBe(first.sequenceNumber + 1);
    });

    it('sets lastStudiedAt as ISO string', () => {
      const update = buildScoreUpdate({ topicSlug: 'x', quizPoints: 0, maxPoints: 0, completedTasks: 0, totalTasks: 0 });
      expect(() => new Date(update.lastStudiedAt)).not.toThrow();
      expect(update.lastStudiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('serialiseScoreUpdate / parseScorePayload', () => {
    const sampleUpdate: ScoreUpdate = {
      topicSlug: 'world-history',
      quizPoints: 15,
      maxPoints: 20,
      completedTasks: 2,
      totalTasks: 4,
      lastStudiedAt: '2026-03-18T12:00:00.000Z',
      sequenceNumber: 7,
    };

    it('round-trips through serialise/parse', () => {
      const payload = serialiseScoreUpdate(sampleUpdate);
      const result = parseScorePayload(payload);
      expect(result).not.toBeNull();
      expect(result!.topicSlug).toBe('world-history');
      expect(result!.quizPoints).toBe(15);
      expect(result!.sequenceNumber).toBe(7);
    });

    it('returns null for random text', () => {
      expect(parseScorePayload('hello world')).toBeNull();
    });

    it('returns null for unrelated JSON object', () => {
      const payload = JSON.stringify({ foo: 'bar' });
      expect(parseScorePayload(payload)).toBeNull();
    });

    it('returns null for invalid data shape', () => {
      const payload = JSON.stringify({ topicSlug: 123 });
      expect(parseScorePayload(payload)).toBeNull();
    });
  });

  describe('totalPointsFromScores', () => {
    it('returns 0 for empty scores', () => {
      expect(totalPointsFromScores({})).toBe(0);
    });

    it('sums points across topics', () => {
      const scores: Record<string, ScoreUpdate> = {
        'topic-a': { topicSlug: 'topic-a', quizPoints: 10, maxPoints: 20, completedTasks: 1, totalTasks: 2, lastStudiedAt: '', sequenceNumber: 1 },
        'topic-b': { topicSlug: 'topic-b', quizPoints: 5, maxPoints: 10, completedTasks: 0, totalTasks: 1, lastStudiedAt: '', sequenceNumber: 2 },
      };
      expect(totalPointsFromScores(scores)).toBe(15);
    });

    it('handles single topic', () => {
      const scores: Record<string, ScoreUpdate> = {
        'js-basics': { topicSlug: 'js-basics', quizPoints: 8, maxPoints: 10, completedTasks: 2, totalTasks: 3, lastStudiedAt: '', sequenceNumber: 1 },
      };
      expect(totalPointsFromScores(scores)).toBe(8);
    });
  });
});
