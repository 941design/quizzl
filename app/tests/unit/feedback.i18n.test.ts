import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

const REQUIRED_KEYS = [
  'settingsRowLabel',
  'pageTitle',
  'encryptedSubtitle',
  'composerPlaceholder',
  'unavailableState',
] as const;

describe('feedback-channel i18n keys', () => {
  it('English copy has all feedback keys with non-empty string values', () => {
    const en = getCopy('en');
    for (const key of REQUIRED_KEYS) {
      expect(typeof en.feedback[key]).toBe('string');
      expect(en.feedback[key].length).toBeGreaterThan(0);
    }
    expect(en.feedback.settingsRowLabel).toBe('Send feedback to the maintainers');
  });

  it('German copy has all feedback keys with non-empty string values', () => {
    const de = getCopy('de');
    for (const key of REQUIRED_KEYS) {
      expect(typeof de.feedback[key]).toBe('string');
      expect(de.feedback[key].length).toBeGreaterThan(0);
    }
    expect(de.feedback.settingsRowLabel).toBe('Feedback an die Entwickler senden');
  });

  it('English and German differ (translations are not copy-paste)', () => {
    const en = getCopy('en');
    const de = getCopy('de');
    for (const key of REQUIRED_KEYS) {
      expect(de.feedback[key]).not.toBe(en.feedback[key]);
    }
  });
});
