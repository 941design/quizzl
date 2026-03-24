/**
 * scoreSync.ts — Utilities for building and processing ScoreUpdate messages.
 *
 * Responsibilities:
 * - Build a ScoreUpdate from current topic progress
 * - Get-and-increment the per-session sequence number (localStorage)
 * - Serialise/deserialise the ScoreUpdate payload for MLS application messages
 * - Process an incoming raw payload into a MemberScore update
 */

import type { ScoreUpdate } from '@/src/types';
import { STORAGE_KEYS } from '@/src/types';

/** MLS application-message rumor kind for score updates (kind 1 = short text note). */
export const SCORE_RUMOR_KIND = 1;

/** Serialise a ScoreUpdate to JSON content for MLS application rumor. */
export function serialiseScoreUpdate(update: ScoreUpdate): string {
  return JSON.stringify(update);
}

/** Parse rumor content as a ScoreUpdate. Returns null if not valid. */
export function parseScorePayload(content: string): ScoreUpdate | null {
  try {
    const d = JSON.parse(content) as ScoreUpdate;
    if (
      typeof d.topicSlug !== 'string' ||
      typeof d.quizPoints !== 'number' ||
      typeof d.maxPoints !== 'number' ||
      typeof d.sequenceNumber !== 'number'
    ) {
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

/**
 * Get and increment the global score-sync sequence number (localStorage).
 * The sequence is global (not per-group) — same update can be distributed to all groups.
 */
export function nextSequenceNumber(): number {
  if (typeof localStorage === 'undefined') return 1;
  const current = parseInt(localStorage.getItem(STORAGE_KEYS.scoreSyncSeq) ?? '0', 10);
  const next = current + 1;
  localStorage.setItem(STORAGE_KEYS.scoreSyncSeq, String(next));
  return next;
}

/**
 * Build a ScoreUpdate from quiz completion data.
 * Assigns the next sequence number automatically.
 */
export function buildScoreUpdate(params: {
  topicSlug: string;
  quizPoints: number;
  maxPoints: number;
  completedTasks: number;
  totalTasks: number;
}): ScoreUpdate {
  return {
    topicSlug: params.topicSlug,
    quizPoints: params.quizPoints,
    maxPoints: params.maxPoints,
    completedTasks: params.completedTasks,
    totalTasks: params.totalTasks,
    lastStudiedAt: new Date().toISOString(),
    sequenceNumber: nextSequenceNumber(),
  };
}

/**
 * Compute total quiz points across all topics for a MemberScore's scores map.
 */
export function totalPointsFromScores(scores: Record<string, ScoreUpdate>): number {
  return Object.values(scores).reduce((sum, s) => sum + s.quizPoints, 0);
}
