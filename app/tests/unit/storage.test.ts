import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readSettings,
  writeSettings,
  readUserProfile,
  writeUserProfile,
  readSelectedTopics,
  writeSelectedTopics,
  readProgress,
  writeProgress,
  readTopicProgress,
  writeTopicProgress,
  readStudyTimes,
  writeStudyTimes,
  resetAllData,
  isStorageAvailable,
} from '@/src/lib/storage';
import { STORAGE_KEYS } from '@/src/types';

// Mock localStorage for Node environment
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Reset the cached _storageAvailable flag before each test
// (the module caches it, so we need to reset the module state)
beforeEach(() => {
  localStorageMock.clear();
  // Force re-evaluation of storage availability by resetting internal cache
  // We access the module internals indirectly by ensuring localStorage works
});

describe('Settings', () => {
  it('returns default settings when nothing stored', () => {
    const settings = readSettings();
    expect(settings).toEqual({ theme: 'calm', language: 'en' });
  });

  it('writes and reads settings', () => {
    writeSettings({ theme: 'playful', language: 'de' });
    expect(readSettings()).toEqual({ theme: 'playful', language: 'de' });
  });

  it('fills missing fields for legacy stored settings', () => {
    store[STORAGE_KEYS.settings] = JSON.stringify({ mood: 'playful' });
    expect(readSettings()).toEqual({ theme: 'playful', language: 'en', mood: 'playful' });
  });

  it('uses correct storage key', () => {
    writeSettings({ theme: 'playful', language: 'de' });
    expect(store[STORAGE_KEYS.settings]).toBeDefined();
    const parsed = JSON.parse(store[STORAGE_KEYS.settings]);
    expect(parsed.theme).toBe('playful');
    expect(parsed.language).toBe('de');
  });
});

describe('SelectedTopics', () => {
  it('returns empty slugs when nothing stored', () => {
    expect(readSelectedTopics()).toEqual({ slugs: [] });
  });

  it('writes and reads selected topics', () => {
    writeSelectedTopics({ slugs: ['js', 'python'] });
    expect(readSelectedTopics()).toEqual({ slugs: ['js', 'python'] });
  });
});

describe('UserProfile', () => {
  it('returns an empty profile when nothing stored', () => {
    expect(readUserProfile()).toEqual({ nickname: '', avatar: null, badgeIds: [] });
  });

  it('writes and reads a profile', () => {
    const profile = {
      nickname: 'Rocket Reader',
      avatar: {
        id: 'berry-1',
        imageUrl: 'http://example.test/berry.png',
        subject: 'strawberry',
        accessories: ['glasses'],
      },
      badgeIds: ['quiz-whiz', 'book-buddy'],
    };

    writeUserProfile(profile);
    expect(readUserProfile()).toEqual(profile);
  });

  it('normalizes oversized nickname and badge selection', () => {
    store[STORAGE_KEYS.userProfile] = JSON.stringify({
      nickname: 'A very very very long nickname',
      avatar: {
        id: 'berry-2',
        imageUrl: 'http://example.test/apple.png',
        subject: 'apple',
        accessories: ['hat'],
      },
      badgeIds: ['1', '2', '3', '4'],
    });

    expect(readUserProfile()).toEqual({
      nickname: 'A very very very',
      avatar: {
        id: 'berry-2',
        imageUrl: 'http://example.test/apple.png',
        subject: 'apple',
        accessories: ['hat'],
      },
      badgeIds: ['1', '2', '3'],
    });
  });
});

describe('Progress', () => {
  it('returns empty byTopicSlug when nothing stored', () => {
    expect(readProgress()).toEqual({ byTopicSlug: {} });
  });

  it('writes and reads progress', () => {
    const progress = {
      byTopicSlug: {
        js: { answers: {}, quizPoints: 5, notesHtml: '', completedTaskIds: [] },
      },
    };
    writeProgress(progress);
    expect(readProgress()).toEqual(progress);
  });
});

describe('TopicProgress', () => {
  it('returns default topic progress for unknown slug', () => {
    expect(readTopicProgress('unknown')).toEqual({
      answers: {},
      quizPoints: 0,
      notesHtml: '',
      completedTaskIds: [],
    });
  });

  it('writes topic progress into the correct slug namespace', () => {
    const tp = { answers: {}, quizPoints: 3, notesHtml: '<p>hi</p>', completedTaskIds: ['t1'] };
    writeTopicProgress('js', tp);

    expect(readTopicProgress('js')).toEqual(tp);
    // Other slugs unaffected
    expect(readTopicProgress('python').quizPoints).toBe(0);
  });

  it('does not overwrite other topics when writing', () => {
    writeTopicProgress('js', { answers: {}, quizPoints: 1, notesHtml: '', completedTaskIds: [] });
    writeTopicProgress('py', { answers: {}, quizPoints: 2, notesHtml: '', completedTaskIds: [] });

    expect(readTopicProgress('js').quizPoints).toBe(1);
    expect(readTopicProgress('py').quizPoints).toBe(2);
  });
});

describe('StudyTimes', () => {
  it('returns empty sessions when nothing stored', () => {
    expect(readStudyTimes()).toEqual({ sessions: [] });
  });

  it('writes and reads study times', () => {
    const times = {
      sessions: [
        { id: 's1', topicSlug: 'js', startedAt: '2026-01-01T10:00:00Z', endedAt: '2026-01-01T10:30:00Z', durationMs: 1800000 },
      ],
    };
    writeStudyTimes(times);
    expect(readStudyTimes()).toEqual(times);
  });
});

describe('resetAllData', () => {
  it('clears all lp_* keys', () => {
    writeSettings({ theme: 'playful', language: 'de' });
    writeUserProfile({ nickname: 'Pineapple Pal', avatar: null, badgeIds: ['quiz-whiz'] });
    writeSelectedTopics({ slugs: ['js'] });
    writeTopicProgress('js', { answers: {}, quizPoints: 5, notesHtml: '', completedTaskIds: [] });
    writeStudyTimes({ sessions: [] });

    // All keys should exist
    expect(store[STORAGE_KEYS.settings]).toBeDefined();
    expect(store[STORAGE_KEYS.userProfile]).toBeDefined();
    expect(store[STORAGE_KEYS.selectedTopics]).toBeDefined();
    expect(store[STORAGE_KEYS.progress]).toBeDefined();
    expect(store[STORAGE_KEYS.studyTimes]).toBeDefined();

    resetAllData();

    // All keys should be gone
    expect(store[STORAGE_KEYS.settings]).toBeUndefined();
    expect(store[STORAGE_KEYS.userProfile]).toBeUndefined();
    expect(store[STORAGE_KEYS.selectedTopics]).toBeUndefined();
    expect(store[STORAGE_KEYS.progress]).toBeUndefined();
    expect(store[STORAGE_KEYS.studyTimes]).toBeUndefined();
  });

  it('handles already-empty storage gracefully', () => {
    expect(() => resetAllData()).not.toThrow();
  });
});

describe('corrupt data handling', () => {
  it('returns default when stored data is invalid JSON', () => {
    store[STORAGE_KEYS.settings] = 'not-json{{{';
    expect(readSettings()).toEqual({ theme: 'calm', language: 'en' });
  });

  it('returns empty selected topics when stored data is the literal string "null"', () => {
    store[STORAGE_KEYS.selectedTopics] = 'null';
    // readSelectedTopics must coerce parsed null into the default-shaped
    // object so `.slugs` is always safe to dereference.
    expect(readSelectedTopics()).toEqual({ slugs: [] });
  });

  it('returns empty selected topics when stored data has wrong shape', () => {
    store[STORAGE_KEYS.selectedTopics] = JSON.stringify({ slugs: 'not-an-array' });
    expect(readSelectedTopics()).toEqual({ slugs: [] });
  });
});
