import { describe, it, expect, beforeEach } from 'vitest';
import { enqueue, dequeueAll, queueSize, clearQueue } from '@/src/lib/marmot/syncQueue';

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

const sampleUpdate = {
  topicSlug: 'js-basics',
  quizPoints: 8,
  maxPoints: 10,
  completedTasks: 2,
  totalTasks: 5,
  lastStudiedAt: '2026-03-18T12:00:00Z',
};

describe('syncQueue', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('enqueue / queueSize', () => {
    it('starts empty', () => {
      expect(queueSize()).toBe(0);
    });

    it('adds items to the queue', () => {
      enqueue(sampleUpdate);
      expect(queueSize()).toBe(1);
    });

    it('adds multiple items', () => {
      enqueue(sampleUpdate);
      enqueue({ ...sampleUpdate, topicSlug: 'world-history' });
      expect(queueSize()).toBe(2);
    });

    it('stores enqueuedAt timestamp', () => {
      enqueue(sampleUpdate);
      const items = dequeueAll();
      expect(items[0].enqueuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('stores retries as 0', () => {
      enqueue(sampleUpdate);
      const items = dequeueAll();
      expect(items[0].retries).toBe(0);
    });
  });

  describe('dequeueAll', () => {
    it('returns all queued items', () => {
      enqueue(sampleUpdate);
      enqueue({ ...sampleUpdate, topicSlug: 'biology' });
      const items = dequeueAll();
      expect(items).toHaveLength(2);
      expect(items[0].update.topicSlug).toBe('js-basics');
      expect(items[1].update.topicSlug).toBe('biology');
    });

    it('clears the queue after dequeue', () => {
      enqueue(sampleUpdate);
      dequeueAll();
      expect(queueSize()).toBe(0);
    });

    it('returns empty array when queue is empty', () => {
      const items = dequeueAll();
      expect(items).toHaveLength(0);
    });
  });

  describe('clearQueue', () => {
    it('empties the queue without returning items', () => {
      enqueue(sampleUpdate);
      enqueue(sampleUpdate);
      clearQueue();
      expect(queueSize()).toBe(0);
    });
  });

  describe('queue cap', () => {
    it('caps at 50 items by dropping the oldest', () => {
      // Fill beyond cap
      for (let i = 0; i < 55; i++) {
        enqueue({ ...sampleUpdate, topicSlug: `topic-${i}` });
      }
      expect(queueSize()).toBe(50);
      // First 5 items were dropped, so oldest is topic-5
      const items = dequeueAll();
      expect(items[0].update.topicSlug).toBe('topic-5');
      expect(items[49].update.topicSlug).toBe('topic-54');
    });
  });
});
