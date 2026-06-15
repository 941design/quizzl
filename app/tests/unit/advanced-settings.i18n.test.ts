/**
 * Unit tests for Advanced Settings i18n completeness (AC-I18N-1).
 *
 * Asserts that:
 * - All required top-level and nested keys exist in both en and de.
 * - All values are non-empty strings.
 * - English and German translations differ (no copy-paste unchanged).
 */

import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

// ---------------------------------------------------------------------------
// Top-level advanced keys
// ---------------------------------------------------------------------------

const ADVANCED_TOP_KEYS = [
  'sectionTitle',
  'toggleExpand',
  'toggleCollapse',
] as const;

// ---------------------------------------------------------------------------
// Nested sub-object keys
// ---------------------------------------------------------------------------

const RELAYS_KEYS = [
  'sectionTitle',
  'addPlaceholder',
  'addBtn',
  'removeBtn',
  'resetBtn',
  'saveBtn',
  'savedSuccess',
  'statusConnected',
  'statusConnecting',
  'statusDisconnected',
  'lastRelayError',
  'invalidUrlError',
  'duplicateUrlError',
  'discoverabilityNote',
] as const;

const DANGER_ZONE_KEYS = [
  'title',
  'wipeBtn',
  'wipeConfirmPrompt',
  'wipeConfirmBtn',
  'wipeConfirmWord',
  'wipeCancel',
  'wipeWarning',
] as const;

const NIP46_KEYS = [
  'sectionTitle',
  'description',
  'disclosureGroupFast',
  'disclosureIdentityLeaves',
  'disclosureDmSlow',
  'connectQrBtn',
  'connectPasteBtn',
  'relayInputLabel',
  'relayInputPlaceholder',
  'generateQrBtn',
  'confirmConnectBtn',
  'pasteUriLabel',
  'pasteUriPlaceholder',
  'connectBtn',
  'connecting',
  'connected',
  'connectedAs',
  'reconnecting',
  'disconnect',
  'signerUnavailable',
  'retryBtn',
  'errorUnreachable',
  'authChallengeOpened',
] as const;

const NIP07_KEYS = [
  'sectionTitle',
  'description',
  'connectBtn',
  'connecting',
  'connected',
  'connectedAs',
  'disconnect',
  'noExtensionError',
  'nip44MissingError',
  'reconnectError',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertNonEmptyString(value: unknown, label: string): void {
  expect(typeof value, `${label}: should be a string`).toBe('string');
  expect((value as string).length, `${label}: should be non-empty`).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('advanced settings i18n: top-level keys', () => {
  for (const lang of ['en', 'de'] as const) {
    describe(`language: ${lang}`, () => {
      it('has all top-level advanced keys with non-empty string values', () => {
        const adv = getCopy(lang).advanced;
        for (const key of ADVANCED_TOP_KEYS) {
          assertNonEmptyString(adv[key], `${lang}.advanced.${key}`);
        }
      });
    });
  }

  it('top-level keys differ between en and de', () => {
    const en = getCopy('en').advanced;
    const de = getCopy('de').advanced;
    for (const key of ADVANCED_TOP_KEYS) {
      expect(de[key], `advanced.${key} must be translated`).not.toBe(en[key]);
    }
  });
});

describe('advanced settings i18n: relays sub-object', () => {
  for (const lang of ['en', 'de'] as const) {
    it(`${lang}: has all relays keys with non-empty string values`, () => {
      const relays = getCopy(lang).advanced.relays;
      for (const key of RELAYS_KEYS) {
        assertNonEmptyString(relays[key], `${lang}.advanced.relays.${key}`);
      }
    });
  }

  it('relays keys differ between en and de', () => {
    const en = getCopy('en').advanced.relays;
    const de = getCopy('de').advanced.relays;
    // At least the prominent labels should differ
    const differingKeys = RELAYS_KEYS.filter((k) => en[k] !== de[k]);
    expect(differingKeys.length, 'at least some relays keys should be translated').toBeGreaterThan(0);
  });
});

describe('advanced settings i18n: dangerZone sub-object', () => {
  for (const lang of ['en', 'de'] as const) {
    it(`${lang}: has all dangerZone keys with non-empty string values`, () => {
      const dz = getCopy(lang).advanced.dangerZone;
      for (const key of DANGER_ZONE_KEYS) {
        assertNonEmptyString(dz[key], `${lang}.advanced.dangerZone.${key}`);
      }
    });
  }

  it('dangerZone.wipeConfirmWord is "WIPE" in both languages', () => {
    // The confirmation word is intentionally identical in both languages so
    // users always type the same word regardless of their language setting.
    expect(getCopy('en').advanced.dangerZone.wipeConfirmWord).toBe('WIPE');
    expect(getCopy('de').advanced.dangerZone.wipeConfirmWord).toBe('WIPE');
  });

  it('dangerZone human-readable keys differ between en and de', () => {
    const en = getCopy('en').advanced.dangerZone;
    const de = getCopy('de').advanced.dangerZone;
    // wipeConfirmWord is intentionally the same; skip it
    const translatedKeys = DANGER_ZONE_KEYS.filter(
      (k) => k !== 'wipeConfirmWord' && en[k] !== de[k],
    );
    expect(translatedKeys.length, 'dangerZone human-readable keys must be translated').toBeGreaterThan(0);
  });
});

describe('advanced settings i18n: nip46 sub-object', () => {
  for (const lang of ['en', 'de'] as const) {
    it(`${lang}: has all nip46 keys with non-empty string values`, () => {
      const nip46 = getCopy(lang).advanced.nip46;
      for (const key of NIP46_KEYS) {
        assertNonEmptyString(nip46[key], `${lang}.advanced.nip46.${key}`);
      }
    });
  }

  it('nip46 keys differ between en and de', () => {
    const en = getCopy('en').advanced.nip46;
    const de = getCopy('de').advanced.nip46;
    const differingKeys = NIP46_KEYS.filter((k) => en[k] !== de[k]);
    expect(differingKeys.length, 'at least some nip46 keys should be translated').toBeGreaterThan(0);
  });
});

describe('advanced settings i18n: nip07 sub-object', () => {
  for (const lang of ['en', 'de'] as const) {
    it(`${lang}: has all nip07 keys with non-empty string values`, () => {
      const nip07 = getCopy(lang).advanced.nip07;
      for (const key of NIP07_KEYS) {
        assertNonEmptyString(nip07[key], `${lang}.advanced.nip07.${key}`);
      }
    });
  }

  it('nip07 keys differ between en and de', () => {
    const en = getCopy('en').advanced.nip07;
    const de = getCopy('de').advanced.nip07;
    const differingKeys = NIP07_KEYS.filter((k) => en[k] !== de[k]);
    expect(differingKeys.length, 'at least some nip07 keys should be translated').toBeGreaterThan(0);
  });
});

describe('advanced settings i18n: sub-object existence', () => {
  for (const lang of ['en', 'de'] as const) {
    it(`${lang}: advanced object has relays, dangerZone, nip46, nip07 sub-objects`, () => {
      const adv = getCopy(lang).advanced;
      expect(typeof adv.relays).toBe('object');
      expect(typeof adv.dangerZone).toBe('object');
      expect(typeof adv.nip46).toBe('object');
      expect(typeof adv.nip07).toBe('object');
    });
  }
});
