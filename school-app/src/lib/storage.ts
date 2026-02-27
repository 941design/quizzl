import type { Settings, SelectedTopics, Progress, StudyTimes, TopicProgress } from '@/src/types';
import { STORAGE_KEYS } from '@/src/types';

// ============================
// localStorage availability check
// ============================

let _storageAvailable: boolean | null = null;

export function isStorageAvailable(): boolean {
  if (_storageAvailable !== null) return _storageAvailable;

  try {
    const testKey = '__lp_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    _storageAvailable = true;
  } catch {
    _storageAvailable = false;
  }

  return _storageAvailable;
}

// ============================
// Generic read/write helpers
// ============================

function readItem<T>(key: string, defaultValue: T): T {
  if (!isStorageAvailable()) return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function writeItem<T>(key: string, value: T): void {
  if (!isStorageAvailable()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Silent fail — storage may be full or restricted
  }
}

// ============================
// Settings
// ============================

const DEFAULT_SETTINGS: Settings = { mood: 'calm' };

export function readSettings(): Settings {
  return readItem<Settings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
}

export function writeSettings(settings: Settings): void {
  writeItem(STORAGE_KEYS.settings, settings);
}

// ============================
// Selected Topics
// ============================

const DEFAULT_SELECTED_TOPICS: SelectedTopics = { slugs: [] };

export function readSelectedTopics(): SelectedTopics {
  return readItem<SelectedTopics>(STORAGE_KEYS.selectedTopics, DEFAULT_SELECTED_TOPICS);
}

export function writeSelectedTopics(selected: SelectedTopics): void {
  writeItem(STORAGE_KEYS.selectedTopics, selected);
}

// ============================
// Progress
// ============================

const DEFAULT_PROGRESS: Progress = { byTopicSlug: {} };

const DEFAULT_TOPIC_PROGRESS: TopicProgress = {
  answers: {},
  quizPoints: 0,
  notesHtml: '',
  completedTaskIds: [],
};

export function readProgress(): Progress {
  return readItem<Progress>(STORAGE_KEYS.progress, DEFAULT_PROGRESS);
}

export function writeProgress(progress: Progress): void {
  writeItem(STORAGE_KEYS.progress, progress);
}

export function readTopicProgress(slug: string): TopicProgress {
  const progress = readProgress();
  return progress.byTopicSlug[slug] ?? { ...DEFAULT_TOPIC_PROGRESS };
}

export function writeTopicProgress(slug: string, topicProgress: TopicProgress): void {
  const progress = readProgress();
  writeProgress({
    ...progress,
    byTopicSlug: {
      ...progress.byTopicSlug,
      [slug]: topicProgress,
    },
  });
}

// ============================
// Study Times
// ============================

const DEFAULT_STUDY_TIMES: StudyTimes = { sessions: [] };

export function readStudyTimes(): StudyTimes {
  return readItem<StudyTimes>(STORAGE_KEYS.studyTimes, DEFAULT_STUDY_TIMES);
}

export function writeStudyTimes(studyTimes: StudyTimes): void {
  writeItem(STORAGE_KEYS.studyTimes, studyTimes);
}

// ============================
// Reset all app data
// ============================

export function resetAllData(): void {
  if (!isStorageAvailable()) return;
  Object.values(STORAGE_KEYS).forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Silent fail
    }
  });
}
