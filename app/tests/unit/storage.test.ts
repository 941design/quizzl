import { describe, it, expect, beforeEach } from 'vitest';
import {
  readSettings,
  writeSettings,
  readUserProfile,
  writeUserProfile,
  resetAllData,
} from '@/src/lib/storage';
import { STORAGE_KEYS } from '@/src/types';
import { PROFILE_NICKNAME_MAX_LENGTH } from '@/src/config/profile';

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

beforeEach(() => {
  localStorageMock.clear();
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

describe('UserProfile', () => {
  it('returns an empty profile when nothing stored', () => {
    expect(readUserProfile()).toEqual({ nickname: '', avatar: null });
  });

  it('writes and reads a profile', () => {
    const profile = {
      nickname: 'Rocket Reader',
      avatar: { imageUrl: 'http://example.test/berry.png' },
    };

    writeUserProfile(profile);
    expect(readUserProfile()).toEqual(profile);
  });

  it('normalizes oversized nickname', () => {
    const oversized = 'A'.repeat(PROFILE_NICKNAME_MAX_LENGTH + 10);
    store[STORAGE_KEYS.userProfile] = JSON.stringify({
      nickname: oversized,
      avatar: { imageUrl: 'http://example.test/apple.png' },
    });

    expect(readUserProfile()).toEqual({
      nickname: 'A'.repeat(PROFILE_NICKNAME_MAX_LENGTH),
      avatar: { imageUrl: 'http://example.test/apple.png' },
    });
  });

  it('drops obsolete subject/accessories, keeping only imageUrl', () => {
    store[STORAGE_KEYS.userProfile] = JSON.stringify({
      nickname: 'Legacy',
      avatar: {
        id: 'berry-2',
        imageUrl: 'http://example.test/apple.png',
        subject: 'apple',
        accessories: ['hat'],
      },
    });

    expect(readUserProfile().avatar).toEqual({ imageUrl: 'http://example.test/apple.png' });
  });

  it('reconstructs imageUrl from a legacy id-only avatar', () => {
    store[STORAGE_KEYS.userProfile] = JSON.stringify({
      nickname: 'Legacy',
      avatar: { id: 'berry-9', subject: 'apple', accessories: [] },
    });

    expect(readUserProfile().avatar).toEqual({
      imageUrl: '//few.chat/assets/berry-9.png',
    });
  });
});

// resetAllData is currently unused by the frontend — the "Reset All Data" UI was
// removed from the Settings page to prevent accidental, irreversible identity
// wipes. These tests keep the retained logic covered for any future re-exposure.
describe('resetAllData', () => {
  it('clears all lp_* keys', () => {
    writeSettings({ theme: 'playful', language: 'de' });
    writeUserProfile({ nickname: 'Pineapple Pal', avatar: null });

    expect(store[STORAGE_KEYS.settings]).toBeDefined();
    expect(store[STORAGE_KEYS.userProfile]).toBeDefined();

    resetAllData();

    expect(store[STORAGE_KEYS.settings]).toBeUndefined();
    expect(store[STORAGE_KEYS.userProfile]).toBeUndefined();
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
});
