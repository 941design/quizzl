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
  nostrIdentity: 'lp_nostrIdentity_v1',
  nostrBackedUp: 'lp_nostrIdentityBackedUp_v1',
  scoreSyncQueue: 'lp_scoreSyncQueue_v1',
  scoreSyncSeq: 'lp_scoreSyncSeq_v1',
} as const;

// ============================
// Nostr / Groups Types
// ============================

/** Default public relay URLs for Nostr connections */
const ENV_RELAYS = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_RELAYS
  ? process.env.NEXT_PUBLIC_RELAYS.split(',').map(r => r.trim()).filter(Boolean)
  : null;

export const DEFAULT_RELAYS: readonly string[] = ENV_RELAYS ?? [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

export type NostrIdentity = {
  pubkeyHex: string;
  npub: string;
  /** Whether the identity has been backed up via seed phrase */
  backedUp: boolean;
};

export type Group = {
  /** hex-encoded MLS group ID */
  id: string;
  name: string;
  /** Unix timestamp of creation/join */
  createdAt: number;
  /** hex pubkeys of members known to the local client */
  memberPubkeys: string[];
  /** Relay URLs this group uses */
  relays: string[];
};

export type GroupMember = {
  pubkeyHex: string;
  npub: string;
  nickname: string;
};

export type ScoreUpdate = {
  topicSlug: string;
  quizPoints: number;
  maxPoints: number;
  completedTasks: number;
  totalTasks: number;
  lastStudiedAt: string;
  /** Monotonically increasing per-group sequence number for LWW resolution */
  sequenceNumber: number;
};

export type MemberScore = {
  pubkeyHex: string;
  nickname: string;
  /** Map of topicSlug -> ScoreUpdate */
  scores: Record<string, ScoreUpdate>;
  /** Last received sequence number (for LWW) */
  lastSeq: number;
};

export type MemberProfile = {
  pubkeyHex: string;
  nickname: string;
  avatar: ProfileAvatar | null;
  badgeIds: string[];
  /** ISO timestamp for LWW resolution */
  updatedAt: string;
};
