/**
 * AC-INTL-1 — epic-wide i18n completeness check for contact-pairing-code's
 * user-facing UI surface (story S5, last story to touch i18n.ts per
 * stories.json — S6 is e2e-only). Mirrors the REQUIRED_KEYS discipline of
 * the sibling `*.i18n.test.ts` suites (e.g. `cards/addPage.i18n.test.ts`,
 * `cancelPendingInvitation.i18n.test.ts`).
 *
 * Walks every user-facing string this epic introduced or retexted and
 * asserts both `en` and `de` entries exist in `i18n.ts`'s `Copy` type/objects,
 * are non-empty, and are not copy-pasted from one another:
 *
 *   - S4 (pairing-scanner-reciprocation): contacts.addContactPairingInFlight
 *     (AC-SCAN-4 honesty copy), profile.pairingNameSetupPrompt (AC-SCAN-5
 *     redirect prompt) — landed as placeholders by S4, wording FINALIZED by
 *     this story (stories.json: "S5 finalizes wording + owns all remaining
 *     copy").
 *   - S5 (pairing-ui-i18n, this story): profile.shareCardValidityHint
 *     (AC-UI-1, rendered inside NpubQrModal.tsx), profile.shareCardDescription
 *     (pre-existing key, RETEXTED to mention the ~30-minute window),
 *     contacts.pairingAdmissionDigest (AC-UI-2, admission-digest toast),
 *     contacts.addContactErrorUnsupportedVersion (AC-UI-3, friendly
 *     "update your app" copy for RD-5's unrecognized header version).
 *
 * Every key below is referenced via `useCopy()` at its call site — see
 * app/src/components/groups/NpubQrModal.tsx (shareCardValidityHint, passed
 * from app/pages/profile.tsx), app/src/context/MarmotContext.tsx
 * (pairingAdmissionDigest), app/pages/add.tsx (addContactErrorUnsupportedVersion,
 * pairingNameSetupPrompt is rendered from app/pages/profile.tsx), and
 * app/pages/contacts.tsx (addContactPairingInFlight) — none of these hardcode
 * the literal string.
 */
import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

type RequiredKey = {
  section: 'contacts' | 'profile';
  key: string;
  /** 'fn' keys take a sample arg when invoked to obtain the resulting string. */
  kind: 'string' | 'fn';
  sampleArg?: unknown;
};

const REQUIRED_KEYS: RequiredKey[] = [
  // S4 — wording finalized by S5 (stories.json ownership note)
  { section: 'contacts', key: 'addContactPairingInFlight', kind: 'string' },
  { section: 'profile', key: 'pairingNameSetupPrompt', kind: 'string' },

  // S5 — AC-UI-1: ~30-minute validity affordance
  { section: 'profile', key: 'shareCardValidityHint', kind: 'string' },
  { section: 'profile', key: 'shareCardDescription', kind: 'string' },

  // S5 — AC-UI-2: admission digest
  { section: 'contacts', key: 'pairingAdmissionDigest', kind: 'fn', sampleArg: 3 },

  // S5 — AC-UI-3: unrecognized-header-version friendly copy
  { section: 'contacts', key: 'addContactErrorUnsupportedVersion', kind: 'string' },
];

function resolve(copy: ReturnType<typeof getCopy>, entry: RequiredKey): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const section = (copy as any)[entry.section];
  const value = section[entry.key];
  if (entry.kind === 'fn') {
    expect(typeof value).toBe('function');
    return (value as (arg: unknown) => string)(entry.sampleArg);
  }
  expect(typeof value).toBe('string');
  return value as string;
}

describe('epic contact-pairing-code — UI/i18n completeness (AC-INTL-1)', () => {
  it('every required key resolves to a non-empty English string', () => {
    const en = getCopy('en');
    for (const entry of REQUIRED_KEYS) {
      expect(resolve(en, entry).length).toBeGreaterThan(0);
    }
  });

  it('every required key resolves to a non-empty German string', () => {
    const de = getCopy('de');
    for (const entry of REQUIRED_KEYS) {
      expect(resolve(de, entry).length).toBeGreaterThan(0);
    }
  });

  it('English and German are not copy-pasted from one another', () => {
    const en = getCopy('en');
    const de = getCopy('de');
    for (const entry of REQUIRED_KEYS) {
      expect(resolve(de, entry)).not.toBe(resolve(en, entry));
    }
  });

  it('AC-UI-1: both the modal hint and the profile description communicate the ~30-minute window', () => {
    const en = getCopy('en');
    const de = getCopy('de');
    expect(en.profile.shareCardValidityHint).toMatch(/30/);
    expect(en.profile.shareCardDescription).toMatch(/30/);
    expect(de.profile.shareCardValidityHint).toMatch(/30/);
    expect(de.profile.shareCardDescription).toMatch(/30/);
  });

  it('AC-UI-2: the admission digest is a dynamic (count: number) => string and reflects the given count', () => {
    const en = getCopy('en');
    const de = getCopy('de');
    expect(en.contacts.pairingAdmissionDigest(2)).toMatch(/2/);
    expect(en.contacts.pairingAdmissionDigest(5)).toMatch(/5/);
    expect(de.contacts.pairingAdmissionDigest(2)).toMatch(/2/);
  });

  it('AC-UI-3: the unsupported-version copy is distinct from the generic invalid-npub copy', () => {
    const en = getCopy('en');
    const de = getCopy('de');
    expect(en.contacts.addContactErrorUnsupportedVersion).not.toBe(en.contacts.addContactErrorInvalidNpub);
    expect(de.contacts.addContactErrorUnsupportedVersion).not.toBe(de.contacts.addContactErrorInvalidNpub);
  });
});
