// ============================
// Content Schema Types
// ============================

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number];
export type AppThemeName = 'calm' | 'playful' | 'lego' | 'minecraft' | 'flower';

export type Option = {
  id: string;
  text: string;
};

export type QuizQuestion =
  | {
      id: string;
      type: 'single';
      prompt: string;
      options: Option[];
      correctOptionId: string;
      explanation?: string;
    }
  | {
      id: string;
      type: 'multi';
      prompt: string;
      options: Option[];
      correctOptionIds: string[];
      explanation?: string;
    }
  | {
      id: string;
      type: 'flashcard';
      front: string;
      back: string;
    };

export type StudyTask =
  | { id: string; type: 'quiz'; questionIds: string[]; title: string }
  | { id: string; type: 'notes'; title: string }
  | { id: string; type: 'flashcards'; questionIds?: string[]; title: string }
  | { id: string; type: 'custom'; title: string; description?: string };

export type StudyStep = {
  id: string;
  title: string;
  description?: string;
  tasks: StudyTask[];
};

export type StudyPlan = {
  steps: StudyStep[];
};

export type Topic = {
  slug: string;
  title: string;
  description: string;
  tags?: string[];
  quiz: QuizQuestion[];
  studyPlan: StudyPlan;
};

export type TopicCatalogue = Record<LanguageCode, Topic[]>;

// ============================
// User Data / localStorage Types
// ============================

export type Settings = {
  theme: AppThemeName;
  mood?: AppThemeName;
  language: LanguageCode;
};

export type ProfileAvatar = {
  id: string;
  imageUrl: string;
  subject: string;
  accessories: string[];
};

export type UserProfile = {
  nickname: string;
  avatar: ProfileAvatar | null;
  badgeIds: string[];
};

export type SelectedTopics = {
  slugs: string[];
};

export type QuizAnswer =
  | { kind: 'single'; optionId: string }
  | { kind: 'multi'; optionIds: string[] }
  | { kind: 'flashcard'; knewIt: boolean };

export type TopicProgress = {
  answers: Record<string, QuizAnswer>;
  quizPoints: number;
  notesHtml: string;
  completedTaskIds: string[];
};

export type Progress = {
  byTopicSlug: Record<string, TopicProgress>;
};

export type StudySession = {
  id: string;
  topicSlug?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

export type StudyTimes = {
  sessions: StudySession[];
  activeSession?: { startedAt: string; topicSlug?: string };
};

// ============================
// Storage Keys
// ============================

export const STORAGE_KEYS = {
  settings: 'lp_settings_v1',
  userProfile: 'lp_userProfile_v1',
  selectedTopics: 'lp_selectedTopics_v1',
  progress: 'lp_progress_v1',
  studyTimes: 'lp_studyTimes_v1',
} as const;
