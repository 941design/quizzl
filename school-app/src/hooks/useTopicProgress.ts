import { useState, useEffect, useCallback } from 'react';
import type { QuizAnswer, TopicProgress } from '@/src/types';
import { readTopicProgress, writeTopicProgress } from '@/src/lib/storage';

export function useTopicProgress(slug: string) {
  const [progress, setProgress] = useState<TopicProgress>({
    answers: {},
    quizPoints: 0,
    notesHtml: '',
    completedTaskIds: [],
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readTopicProgress(slug);
    setProgress(stored);
    setHydrated(true);
  }, [slug]);

  const recordAnswer = useCallback(
    (questionId: string, answer: QuizAnswer, points: number) => {
      setProgress((prev) => {
        const newAnswers = { ...prev.answers, [questionId]: answer };
        const updated: TopicProgress = {
          ...prev,
          answers: newAnswers,
          quizPoints: points,
        };
        writeTopicProgress(slug, updated);
        return updated;
      });
    },
    [slug]
  );

  const updateNotes = useCallback(
    (notesHtml: string) => {
      setProgress((prev) => {
        const updated: TopicProgress = { ...prev, notesHtml };
        writeTopicProgress(slug, updated);
        return updated;
      });
    },
    [slug]
  );

  const toggleTask = useCallback(
    (taskId: string) => {
      setProgress((prev) => {
        const completedTaskIds = prev.completedTaskIds.includes(taskId)
          ? prev.completedTaskIds.filter((id) => id !== taskId)
          : [...prev.completedTaskIds, taskId];
        const updated: TopicProgress = { ...prev, completedTaskIds };
        writeTopicProgress(slug, updated);
        return updated;
      });
    },
    [slug]
  );

  const resetQuiz = useCallback(() => {
    setProgress((prev) => {
      const updated: TopicProgress = {
        ...prev,
        answers: {},
        quizPoints: 0,
      };
      writeTopicProgress(slug, updated);
      return updated;
    });
  }, [slug]);

  return {
    progress,
    hydrated,
    recordAnswer,
    updateNotes,
    toggleTask,
    resetQuiz,
  };
}
