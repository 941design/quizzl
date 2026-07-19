/**
 * Verifies the six removeMember* i18n keys (S6 of epic
 * invite-rescind-and-member-removal) are defined for both supported
 * languages with distinct, non-placeholder en/de copy. Framed for removing
 * an established member — deliberately not a calque of the cancelInvite*
 * (rescind-an-invitation) copy. Consumption in rendered UI is out of scope
 * for this story (S10); this test only pins the Copy contract itself.
 */
import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

describe('removeMember i18n keys (S6)', () => {
  it('English copy resolves all six removeMember* keys exactly', () => {
    const en = getCopy('en');
    expect(en.groups.removeMemberButton).toBe('Remove Member');
    expect(en.groups.removeMemberTitle).toBe('Remove Member');
    expect(en.groups.removeMemberBody).toBe(
      'Remove this member from the group? They will lose access to the group and its messages.'
    );
    expect(en.groups.removeMemberConfirm).toBe('Remove');
    expect(en.groups.removeMemberSuccess).toBe('Member removed');
    expect(en.groups.removeMemberError).toBe('Failed to remove member');
  });

  it('German copy resolves all six removeMember* keys exactly', () => {
    const de = getCopy('de');
    expect(de.groups.removeMemberButton).toBe('Mitglied entfernen');
    expect(de.groups.removeMemberTitle).toBe('Mitglied entfernen');
    expect(de.groups.removeMemberBody).toBe(
      'Dieses Mitglied aus der Gruppe entfernen? Es verliert den Zugriff auf die Gruppe und ihre Nachrichten.'
    );
    expect(de.groups.removeMemberConfirm).toBe('Entfernen');
    expect(de.groups.removeMemberSuccess).toBe('Mitglied entfernt');
    expect(de.groups.removeMemberError).toBe('Mitglied konnte nicht entfernt werden');
  });

  it('each key\'s en text is distinct from its de text (AC-LOCALE-1)', () => {
    const en = getCopy('en').groups;
    const de = getCopy('de').groups;
    const keys = [
      'removeMemberButton',
      'removeMemberTitle',
      'removeMemberBody',
      'removeMemberConfirm',
      'removeMemberSuccess',
      'removeMemberError',
    ] as const;
    for (const key of keys) {
      expect(en[key]).not.toBe(de[key]);
    }
  });
});
