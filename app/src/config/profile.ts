export const PROFILE_NICKNAME_MAX_LENGTH = 16;
export const PROFILE_BADGE_LIMIT = 3;

export const PROFILE_BADGES = [
  { id: 'quiz-whiz', label: 'Quiz Whiz', colorScheme: 'yellow' },
  { id: 'book-buddy', label: 'Book Buddy', colorScheme: 'green' },
  { id: 'science-scout', label: 'Science Scout', colorScheme: 'blue' },
  { id: 'history-hunter', label: 'History Hunter', colorScheme: 'orange' },
  { id: 'kind-teammate', label: 'Kind Teammate', colorScheme: 'pink' },
  { id: 'creative-thinker', label: 'Creative Thinker', colorScheme: 'purple' },
] as const;

export const AVATAR_BROWSER_CONFIG = {
  resultPageSize: 18,
  defaultSubjects: ['strawberry', 'banana', 'apple', 'carrot', 'watermelon', 'pineapple'],
  endpointBaseUrl: 'http://wp10665333.server-he.de',
} as const;
