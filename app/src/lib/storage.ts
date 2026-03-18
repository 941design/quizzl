import type {
  Settings,
  UserProfile,
  SelectedTopics,
  Progress,
  StudyTimes,
  TopicProgress,
} from '@/src/types';
import { STORAGE_KEYS } from '@/src/types';
import { DEFAULT_THEME_NAME, normalizeThemeName } from '@/src/lib/theme';
import { PROFILE_BADGE_LIMIT, PROFILE_NICKNAME_MAX_LENGTH } from '@/src/config/profile';

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

const DEFAULT_SETTINGS: Settings = { theme: DEFAULT_THEME_NAME, language: 'en' };
const DEFAULT_USER_PROFILE: UserProfile = { nickname: '', avatar: null, badgeIds: [] };

export function readSettings(): Settings {
  const stored = readItem<Partial<Settings> | null>(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
  const storedTheme = normalizeThemeName(stored?.theme ?? stored?.mood);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    theme: storedTheme,
  };
}

export function writeSettings(settings: Settings): void {
  writeItem(STORAGE_KEYS.settings, {
    theme: normalizeThemeName(settings.theme ?? settings.mood),
    language: settings.language,
  });
}

// ============================
// User Profile
// ============================

function normalizeUserProfile(raw: Partial<UserProfile> | null | undefined): UserProfile {
  const nickname = typeof raw?.nickname === 'string'
    ? raw.nickname.trim().slice(0, PROFILE_NICKNAME_MAX_LENGTH)
    : '';

  const avatar = raw?.avatar
    && typeof raw.avatar.id === 'string'
    && typeof raw.avatar.imageUrl === 'string'
    && typeof raw.avatar.subject === 'string'
    ? {
        id: raw.avatar.id,
        imageUrl: raw.avatar.imageUrl,
        subject: raw.avatar.subject,
        accessories: Array.isArray(raw.avatar.accessories)
          ? raw.avatar.accessories.filter((item): item is string => typeof item === 'string')
          : [],
      }
    : null;

  const badgeIds = Array.isArray(raw?.badgeIds)
    ? raw.badgeIds.filter((item): item is string => typeof item === 'string').slice(0, PROFILE_BADGE_LIMIT)
    : [];

  return {
    nickname,
    avatar,
    badgeIds,
  };
}

export function readUserProfile(): UserProfile {
  const stored = readItem<Partial<UserProfile> | null>(STORAGE_KEYS.userProfile, DEFAULT_USER_PROFILE);
  return normalizeUserProfile(stored);
}

export function writeUserProfile(profile: UserProfile): void {
  writeItem(STORAGE_KEYS.userProfile, normalizeUserProfile(profile));
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
