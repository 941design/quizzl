/**
 * syncQueue.ts — localStorage-backed queue for failed score sync items.
 *
 * When a publishScoreUpdate fails (e.g. offline or MLS epoch issue),
 * the update is enqueued here. On reconnect, the caller can drain the queue
 * by calling dequeueAll() and retrying each item.
 */

import type { ScoreUpdate } from '@/src/types';
import { STORAGE_KEYS } from '@/src/types';

export type QueuedScoreUpdate = {
  update: Omit<ScoreUpdate, 'sequenceNumber'>;
  enqueuedAt: string;
  retries: number;
};

const QUEUE_KEY = STORAGE_KEYS.scoreSyncQueue;
const MAX_QUEUE_SIZE = 50;

function readQueue(): QueuedScoreUpdate[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedScoreUpdate[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedScoreUpdate[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Storage quota exceeded — discard silently
  }
}

/** Add a failed score update to the retry queue. Caps at MAX_QUEUE_SIZE. */
export function enqueue(update: Omit<ScoreUpdate, 'sequenceNumber'>): void {
  const queue = readQueue();
  if (queue.length >= MAX_QUEUE_SIZE) {
    // Drop the oldest item to make room
    queue.shift();
  }
  queue.push({
    update,
    enqueuedAt: new Date().toISOString(),
    retries: 0,
  });
  writeQueue(queue);
}

/** Remove and return all queued items. Queue is cleared after this call. */
export function dequeueAll(): QueuedScoreUpdate[] {
  const queue = readQueue();
  writeQueue([]);
  return queue;
}

/** Return number of items currently in the queue (without modifying it). */
export function queueSize(): number {
  return readQueue().length;
}

/** Clear the queue without processing. */
export function clearQueue(): void {
  writeQueue([]);
}
