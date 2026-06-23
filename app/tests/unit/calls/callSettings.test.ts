/**
 * Unit tests for Call Settings (Story S10).
 *
 * Tests:
 *   I1-I8. All 8 new i18n keys are present and non-empty in both en and de.
 *   I9.    En and de values differ for each key.
 *   T1.    getIpPrivacyMode() returns false by default.
 *   T2.    After setIpPrivacyMode(true), getIpPrivacyMode() returns true.
 *          (Complements turnConfig.test.ts T5 which already covers this with a
 *           fresh localStorage stub; here we test the same invariant from the
 *           call-settings perspective for standalone auditability.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCopy } from '@/src/lib/i18n';
import { getIpPrivacyMode, setIpPrivacyMode } from '@/src/lib/calls/turnConfig';

// ── In-memory localStorage stub ───────────────────────────────────────────────

function makeLocalStorageStub(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  } as Storage;
}

// ── i18n tests ────────────────────────────────────────────────────────────────

const NEW_KEYS = [
  'callSettings',
  'turnServerUrl',
  'turnUsername',
  'turnCredential',
  'saveTurnConfig',
  'ipPrivacyMode',
  'turnHelp',
  'ipPrivacyHelp',
] as const;

type CallSettingsKey = typeof NEW_KEYS[number];

describe('callSettings i18n keys (Story S10)', () => {
  const en = getCopy('en').calls;
  const de = getCopy('de').calls;

  for (const key of NEW_KEYS) {
    it(`I: "${key}" is present and non-empty in English`, () => {
      const value = en[key as CallSettingsKey];
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    });

    it(`I: "${key}" is present and non-empty in German`, () => {
      const value = de[key as CallSettingsKey];
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    });

    it(`I: "${key}" differs between English and German`, () => {
      expect(en[key as CallSettingsKey]).not.toBe(de[key as CallSettingsKey]);
    });
  }
});

// ── turnConfig tests ──────────────────────────────────────────────────────────

describe('callSettings — getIpPrivacyMode (Story S10)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('T1: getIpPrivacyMode() returns false by default', () => {
    expect(getIpPrivacyMode()).toBe(false);
  });

  it('T2: after setIpPrivacyMode(true), getIpPrivacyMode() returns true', () => {
    setIpPrivacyMode(true);
    expect(getIpPrivacyMode()).toBe(true);
  });
});
