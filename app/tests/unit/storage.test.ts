import { describe, it, expect, beforeEach } from 'vitest';
import {
  readSettings,
  readStoredLanguage,
  writeSettings,
  readUserProfile,
  writeUserProfile,
  resetAllData,
} from '@/src/lib/storage';
import { STORAGE_KEYS } from '@/src/types';
import { NICKNAME_MAX_BYTES } from '@/src/config/profile';

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
    expect(settings).toEqual({ theme: 'spring', language: 'en' });
  });

  it('writes and reads settings', () => {
    writeSettings({ theme: 'spring', language: 'de' });
    expect(readSettings()).toEqual({ theme: 'spring', language: 'de' });
  });

  it('normalizes a deprecated/unknown stored theme name to the default (spring)', () => {
    // The old themes (calm/playful/lego/minecraft/flower) were removed. A
    // settings blob persisted before that removal must not error and must
    // fall back to spring — the legacy `mood` field is preserved verbatim.
    store[STORAGE_KEYS.settings] = JSON.stringify({ theme: 'playful', language: 'de' });
    expect(readSettings()).toEqual({ theme: 'spring', language: 'de' });

    store[STORAGE_KEYS.settings] = JSON.stringify({ theme: 'not-a-real-theme', language: 'en' });
    expect(readSettings().theme).toBe('spring');
  });

  it('fills missing fields for legacy stored settings (deprecated mood normalizes to spring)', () => {
    store[STORAGE_KEYS.settings] = JSON.stringify({ mood: 'playful' });
    expect(readSettings()).toEqual({ theme: 'spring', language: 'en', mood: 'playful' });
  });

  it('uses correct storage key', () => {
    writeSettings({ theme: 'spring', language: 'de' });
    expect(store[STORAGE_KEYS.settings]).toBeDefined();
    const parsed = JSON.parse(store[STORAGE_KEYS.settings]);
    expect(parsed.theme).toBe('spring');
    expect(parsed.language).toBe('de');
  });
});

describe('readStoredLanguage', () => {
  it('returns undefined when no preference has been persisted', () => {
    // So the caller can fall back to browser-language detection on a first visit.
    expect(readStoredLanguage()).toBeUndefined();
  });

  it('returns undefined for legacy settings that predate the language field', () => {
    store[STORAGE_KEYS.settings] = JSON.stringify({ mood: 'playful' });
    expect(readStoredLanguage()).toBeUndefined();
  });

  it('returns the explicitly stored language', () => {
    writeSettings({ theme: 'spring', language: 'de' });
    expect(readStoredLanguage()).toBe('de');
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
    const oversized = 'A'.repeat(NICKNAME_MAX_BYTES + 10);
    store[STORAGE_KEYS.userProfile] = JSON.stringify({
      nickname: oversized,
      avatar: { imageUrl: 'http://example.test/apple.png' },
    });

    expect(readUserProfile()).toEqual({
      nickname: 'A'.repeat(NICKNAME_MAX_BYTES),
      avatar: { imageUrl: 'http://example.test/apple.png' },
    });
  });

  it('byte-caps a multi-byte nickname on load (not a char-slice)', () => {
    // 20 umlauts = 40 UTF-8 bytes (2 bytes each), 20 UTF-16 code units. A
    // char-slice(0,32) would keep all 20; the byte cap keeps 16 (= 32 bytes).
    store[STORAGE_KEYS.userProfile] = JSON.stringify({
      nickname: 'ü'.repeat(20),
      avatar: null,
    });

    expect(readUserProfile().nickname).toBe('ü'.repeat(16));
    expect(new TextEncoder().encode(readUserProfile().nickname).length).toBe(32);
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
    writeSettings({ theme: 'spring', language: 'de' });
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
    expect(readSettings()).toEqual({ theme: 'spring', language: 'en' });
  });
});
