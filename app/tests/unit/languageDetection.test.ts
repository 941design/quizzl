import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectBrowserLanguage, normalizeLanguage } from '@/src/lib/i18n';

describe('normalizeLanguage', () => {
  it('maps any German locale tag to "de"', () => {
    expect(normalizeLanguage('de')).toBe('de');
    expect(normalizeLanguage('de-DE')).toBe('de');
    expect(normalizeLanguage('de-AT')).toBe('de');
    expect(normalizeLanguage('DE')).toBe('de');
  });

  it('maps English and other supported-fallback locales to "en"', () => {
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('en-US')).toBe('en');
    // A detected-but-unsupported language still resolves to the English fallback.
    expect(normalizeLanguage('fr-FR')).toBe('en');
    expect(normalizeLanguage('es')).toBe('en');
  });

  it('defaults to German when no language can be detected', () => {
    expect(normalizeLanguage(undefined)).toBe('de');
    expect(normalizeLanguage(null)).toBe('de');
    expect(normalizeLanguage('')).toBe('de');
  });
});

describe('detectBrowserLanguage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('honours a German browser language', () => {
    vi.stubGlobal('navigator', { language: 'de-DE' });
    expect(detectBrowserLanguage()).toBe('de');
  });

  it('honours an English browser language', () => {
    vi.stubGlobal('navigator', { language: 'en-GB' });
    expect(detectBrowserLanguage()).toBe('en');
  });

  it('defaults to German when the browser reports no language', () => {
    vi.stubGlobal('navigator', { language: '' });
    expect(detectBrowserLanguage()).toBe('de');
  });

  it('defaults to German when navigator is unavailable', () => {
    vi.stubGlobal('navigator', undefined);
    expect(detectBrowserLanguage()).toBe('de');
  });
});
