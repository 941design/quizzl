/**
 * AC-UX-3 — i18n completeness check for the pending-contact-confirmation epic,
 * story S2 (`app/pages/contacts.tsx`, `PendingConfirmationPrompt.tsx`).
 *
 * Walks REQUIRED_KEYS below — a MAINTAINED enumeration of the user-facing
 * string keys added by this story (same REQUIRED_KEYS discipline as the
 * repo's other `*.i18n.test.ts` suites, e.g. `cards/addPage.i18n.test.ts`,
 * `cancelPendingInvitation.i18n.test.ts`) — and asserts every one has BOTH
 * `en` and `de` entries in `app/src/lib/i18n.ts`, that neither is empty, and
 * that the two languages are not copy-pasted from one another.
 *
 * Every key below is referenced via `useCopy()` at its call site:
 *   - `contacts.pendingBadge` — the contacts-list pending badge and the
 *     `ContactDetailView` mount decision's implicit trigger
 *     (`contact.isPendingConfirmation`), `app/pages/contacts.tsx`.
 *   - `contacts.pendingConfirmHeading` / `pendingConfirmBody` —
 *     `PendingConfirmationPrompt.tsx`'s confirmation-prompt copy.
 *   - `contacts.pendingConfirmButton` — the confirm action label, reused by
 *     both `app/pages/contacts.tsx`'s list-row confirm button and
 *     `PendingConfirmationPrompt.tsx`'s detail-view confirm button.
 * None of these strings are hardcoded in `contacts.tsx` or
 * `PendingConfirmationPrompt.tsx` — both read exclusively via `useCopy()`.
 */
import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

type RequiredKey = {
  section: 'contacts';
  key: string;
  /** 'fn' keys take a sample arg when invoked to obtain the resulting string. */
  kind: 'string' | 'fn';
  sampleArg?: unknown;
};

const REQUIRED_KEYS: RequiredKey[] = [
  { section: 'contacts', key: 'pendingBadge', kind: 'string' },
  { section: 'contacts', key: 'pendingConfirmHeading', kind: 'string' },
  { section: 'contacts', key: 'pendingConfirmBody', kind: 'fn', sampleArg: 'Alice' },
  { section: 'contacts', key: 'pendingConfirmButton', kind: 'string' },
];

function resolve(copy: ReturnType<typeof getCopy>, entry: RequiredKey): string {
  const section = copy[entry.section];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = (section as any)[entry.key];
  if (entry.kind === 'fn') {
    expect(typeof value).toBe('function');
    return (value as (arg: unknown) => string)(entry.sampleArg);
  }
  expect(typeof value).toBe('string');
  return value as string;
}

describe('epic pending-contact-confirmation, story S2 — i18n completeness (AC-UX-3)', () => {
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

  it('pendingBadge is distinct from the existing hiddenBadge (blocked) copy in both locales', () => {
    // AC-UX-1: the pending indicator must be visibly distinct from the
    // existing archived/blocked badge, not a relabeled reuse of it.
    const en = getCopy('en').contacts;
    const de = getCopy('de').contacts;
    expect(en.pendingBadge).not.toBe(en.hiddenBadge);
    expect(de.pendingBadge).not.toBe(de.hiddenBadge);
  });

  it('pendingConfirmBody includes the supplied contact name in both locales', () => {
    const en = getCopy('en').contacts;
    const de = getCopy('de').contacts;
    expect(en.pendingConfirmBody('Alice')).toContain('Alice');
    expect(de.pendingConfirmBody('Alice')).toContain('Alice');
  });

  it('spot-checks the exact S2 pending-confirmation copy (this story\'s own new keys)', () => {
    const en = getCopy('en').contacts;
    const de = getCopy('de').contacts;
    expect(en.pendingBadge).toBe('Pending');
    expect(en.pendingConfirmHeading).toBe('Confirm this contact?');
    expect(en.pendingConfirmButton).toBe('Confirm contact');
    expect(de.pendingBadge).toBe('Ausstehend');
    expect(de.pendingConfirmHeading).toBe('Diesen Kontakt bestätigen?');
    expect(de.pendingConfirmButton).toBe('Kontakt bestätigen');
  });
});
