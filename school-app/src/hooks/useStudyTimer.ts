import { useState, useEffect, useRef, useCallback } from 'react';
import type { StudyTimes, StudySession } from '@/src/types';
import { readStudyTimes, writeStudyTimes } from '@/src/lib/storage';

function generateId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export type StudyTimerState = {
  isRunning: boolean;
  elapsedMs: number;
  hasActiveSession: boolean; // True when an unrecovered active session is found on mount
};

export function useStudyTimer(topicSlug?: string) {
  const [isRunning, setIsRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [hasOrphanedSession, setHasOrphanedSession] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On mount: check for orphaned active session
  useEffect(() => {
    const data = readStudyTimes();
    if (data.activeSession) {
      // Found an orphaned session (user refreshed during active session)
      setHasOrphanedSession(true);
    }
    setHydrated(true);
  }, []);

  // Interval to update elapsed time
  useEffect(() => {
    if (isRunning && startedAt) {
      intervalRef.current = setInterval(() => {
        setElapsedMs(Date.now() - new Date(startedAt).getTime());
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, startedAt]);

  const start = useCallback(() => {
    const now = new Date().toISOString();
    setStartedAt(now);
    setElapsedMs(0);
    setIsRunning(true);

    const data = readStudyTimes();
    writeStudyTimes({
      ...data,
      activeSession: { startedAt: now, topicSlug },
    });
  }, [topicSlug]);

  const stop = useCallback(() => {
    if (!startedAt) return;

    const now = new Date().toISOString();
    const durationMs = Date.now() - new Date(startedAt).getTime();

    const session: StudySession = {
      id: generateId(),
      topicSlug,
      startedAt,
      endedAt: now,
      durationMs,
    };

    const data = readStudyTimes();
    writeStudyTimes({
      sessions: [...data.sessions, session],
      activeSession: undefined,
    });

    setIsRunning(false);
    setStartedAt(null);
    setElapsedMs(0);
  }, [startedAt, topicSlug]);

  // Recover orphaned session: "continue" resumes from original start time
  const recoverContinue = useCallback(() => {
    const data = readStudyTimes();
    if (data.activeSession) {
      const { startedAt: originalStart, topicSlug: sessionSlug } = data.activeSession;
      setStartedAt(originalStart);
      setElapsedMs(Date.now() - new Date(originalStart).getTime());
      setIsRunning(true);
      setHasOrphanedSession(false);

      // Re-write active session with current topic if needed
      writeStudyTimes({
        ...data,
        activeSession: { startedAt: originalStart, topicSlug: sessionSlug ?? topicSlug },
      });
    }
  }, [topicSlug]);

  // Recover orphaned session: "stop" ends the session from the original start time
  const recoverStop = useCallback(() => {
    const data = readStudyTimes();
    if (data.activeSession) {
      const { startedAt: originalStart, topicSlug: sessionSlug } = data.activeSession;
      const now = new Date().toISOString();
      const durationMs = Date.now() - new Date(originalStart).getTime();

      const session: StudySession = {
        id: generateId(),
        topicSlug: sessionSlug,
        startedAt: originalStart,
        endedAt: now,
        durationMs,
      };

      writeStudyTimes({
        sessions: [...data.sessions, session],
        activeSession: undefined,
      });
    }

    setHasOrphanedSession(false);
    setIsRunning(false);
    setStartedAt(null);
    setElapsedMs(0);
  }, []);

  return {
    isRunning,
    elapsedMs,
    hydrated,
    hasOrphanedSession,
    start,
    stop,
    recoverContinue,
    recoverStop,
  };
}

// ============================
// Utility functions for study times
// ============================

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function getTodayMs(sessions: StudySession[]): number {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartTs = todayStart.getTime();

  return sessions
    .filter((s) => new Date(s.startedAt).getTime() >= todayStartTs)
    .reduce((sum, s) => sum + s.durationMs, 0);
}

export function getThisWeekMs(sessions: StudySession[]): number {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartTs = weekStart.getTime();

  return sessions
    .filter((s) => new Date(s.startedAt).getTime() >= weekStartTs)
    .reduce((sum, s) => sum + s.durationMs, 0);
}
