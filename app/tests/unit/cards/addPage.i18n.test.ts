/**
 * AC-INTL-1 — epic-wide i18n completeness check (epic: contact-card-exchange,
 * story S7, last-landing story per stories.json's ownership note).
 *
 * Walks REQUIRED_KEYS below — a MAINTAINED enumeration of the user-facing
 * string keys added or retexted across S3–S7 of this epic (same REQUIRED_KEYS
 * discipline as the repo's other `*.i18n.test.ts` suites, e.g.
 * `cancelPendingInvitation.i18n.test.ts`) — and asserts every one has BOTH
 * `en` and `de` entries in `app/src/lib/i18n.ts`, that neither is empty, and
 * that the two languages are not copy-pasted from one another.
 *
 * Durability caveat: because REQUIRED_KEYS is a maintained list (not derived
 * from the section objects at runtime), a FUTURE epic key added en-only and
 * omitted from this list would not be caught here. A whole-i18n programmatic
 * parity walk was deliberately NOT used — it would fail on any pre-existing
 * en/de divergence elsewhere in the app, outside this epic's scope. The list
 * below was reconciled against `git diff HEAD -- app/src/lib/i18n.ts` for this
 * epic's working tree, so it reflects exactly what S3–S7 added/retexted:
 *   - S3 (profile-nickname-cap):      settings.nicknameLimit
 *   - S4 (add-contact-card-wiring):   groups.qrStartingCamera (boy-scout
 *     translation fix); reuses the pre-existing contacts.addContact* error/
 *     success copy for the card-import confirmation/error path (asserted
 *     below too, since AC-INTL-1 names "import confirmation/errors" and S7's
 *     own /add page reuses these same keys — see pages/add.tsx).
 *   - S6 (share-contact-card):        profile.shareCardHeading,
 *     shareCardDescription, shareCardButton, shareCardTitle, copyCardLink,
 *     copiedCardLink, shareCardError (all new; the share action lives on the
 *     Profile page — the Settings page keeps a plain bare-npub QR, so
 *     identity.showQr/qrModalTitle reverted to their pre-epic wording and are
 *     no longer epic-owned keys).
 *   - S7 (add-onboarding-page):       add.pageTitle, add.heading,
 *     add.settingUp, add.noCard, add.goToContacts (all new).
 *
 * Every key below is referenced via `useCopy()` at its call site — see
 * app/pages/profile.tsx (settings.nicknameLimit, profile.shareCard*),
 * NpubQrScanner.tsx (groups.qrStartingCamera),
 * AddContactModal.tsx (contacts.addContact*), and app/pages/add.tsx (add.*)
 * — none of these components hardcode the literal string.
 */
import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

type RequiredKey = {
  section: 'settings' | 'identity' | 'groups' | 'contacts' | 'add' | 'profile';
  key: string;
  /** 'fn' keys take a sample arg when invoked to obtain the resulting string. */
  kind: 'string' | 'fn';
  sampleArg?: unknown;
};

const REQUIRED_KEYS: RequiredKey[] = [
  // S3 — profile nickname cap
  { section: 'settings', key: 'nicknameLimit', kind: 'fn', sampleArg: 32 },

  // S4 — add-contact card wiring
  { section: 'groups', key: 'qrStartingCamera', kind: 'string' },
  { section: 'contacts', key: 'addContactSuccess', kind: 'string' },
  { section: 'contacts', key: 'addContactErrorInvalidNpub', kind: 'string' },
  { section: 'contacts', key: 'addContactErrorSelf', kind: 'string' },
  { section: 'contacts', key: 'addContactErrorAlreadyExists', kind: 'string' },
  { section: 'contacts', key: 'addContactErrorGeneric', kind: 'string' },

  // S6 — share contact card (lives on the Profile page; Settings keeps a plain
  // bare-npub QR, so identity.showQr/qrModalTitle reverted to their pre-epic
  // wording and are no longer epic-owned keys).
  { section: 'profile', key: 'shareCardHeading', kind: 'string' },
  { section: 'profile', key: 'shareCardDescription', kind: 'string' },
  { section: 'profile', key: 'shareCardButton', kind: 'string' },
  { section: 'profile', key: 'shareCardTitle', kind: 'string' },
  { section: 'profile', key: 'copyCardLink', kind: 'string' },
  { section: 'profile', key: 'copiedCardLink', kind: 'string' },
  { section: 'profile', key: 'shareCardError', kind: 'string' },

  // S7 — /add deep-link/onboarding page
  { section: 'add', key: 'pageTitle', kind: 'string' },
  { section: 'add', key: 'heading', kind: 'string' },
  { section: 'add', key: 'settingUp', kind: 'string' },
  { section: 'add', key: 'noCard', kind: 'string' },
  { section: 'add', key: 'goToContacts', kind: 'string' },
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

describe('epic contact-card-exchange — i18n completeness across S3-S7 (AC-INTL-1)', () => {
  it('every required key resolves to a non-empty English string', () => {
    const en = getCopy('en');
    for (const entry of REQUIRED_KEYS) {
      const resolved = resolve(en, entry);
      expect(resolved.length).toBeGreaterThan(0);
    }
  });

  it('every required key resolves to a non-empty German string', () => {
    const de = getCopy('de');
    for (const entry of REQUIRED_KEYS) {
      const resolved = resolve(de, entry);
      expect(resolved.length).toBeGreaterThan(0);
    }
  });

  it('English and German are not copy-pasted from one another', () => {
    const en = getCopy('en');
    const de = getCopy('de');
    for (const entry of REQUIRED_KEYS) {
      const enResolved = resolve(en, entry);
      const deResolved = resolve(de, entry);
      expect(deResolved).not.toBe(enResolved);
    }
  });

  it('spot-checks the exact S7 /add-page copy (this story\'s own new keys)', () => {
    const en = getCopy('en');
    const de = getCopy('de');
    expect(en.add.pageTitle).toBe('Add Contact');
    expect(en.add.settingUp).toBe('Setting up your account…');
    expect(en.add.noCard).toBe("This link doesn't include a contact card.");
    expect(en.add.goToContacts).toBe('Go to Contacts');
    expect(de.add.pageTitle).toBe('Kontakt hinzufügen');
    expect(de.add.settingUp).toBe('Dein Konto wird eingerichtet …');
    expect(de.add.noCard).toBe('Dieser Link enthält keine Kontaktkarte.');
    expect(de.add.goToContacts).toBe('Zu den Kontakten');
  });
});
