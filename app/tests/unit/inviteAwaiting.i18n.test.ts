/**
 * i18n tests for the returning-user invite-link awaiting-landing copy keys
 * (epic-invite-link-awaiting-landing, S1, AC-I18N-1/2/3).
 * Mirrors pendingInvitations.i18n.test.ts: asserts exact EN and exact DE
 * string values for all four new groups.* keys, including that the two
 * function-valued keys are invoked with a group name and interpolate it.
 */

import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

describe('invite-awaiting-landing i18n keys', () => {
  it('English copy has all invite-awaiting keys with exact strings', () => {
    const en = getCopy('en');
    expect(en.groups.inviteAwaitingBanner('Book Club')).toBe(
      "You've been invited to join Book Club.",
    );
    expect(en.groups.awaitingApprovalBanner('Book Club')).toBe(
      'Waiting for the admin to approve your request to join Book Club.',
    );
    expect(en.groups.awaitingBadgeLabel).toBe('Awaiting');
    expect(en.groups.cancelOutboundRequestLabel).toBe('Cancel Request');
  });

  it('German copy has all invite-awaiting keys with exact strings', () => {
    const de = getCopy('de');
    expect(de.groups.inviteAwaitingBanner('Buchclub')).toBe(
      'Du wurdest eingeladen, der Gruppe Buchclub beizutreten.',
    );
    expect(de.groups.awaitingApprovalBanner('Buchclub')).toBe(
      'Warte darauf, dass der Admin deine Anfrage zum Beitritt zu Buchclub genehmigt.',
    );
    expect(de.groups.awaitingBadgeLabel).toBe('Ausstehend');
    expect(de.groups.cancelOutboundRequestLabel).toBe('Anfrage zurückziehen');
  });

  it('both function-valued keys are callable and interpolate the passed group name', () => {
    for (const lang of ['en', 'de'] as const) {
      const copy = getCopy(lang);
      expect(typeof copy.groups.inviteAwaitingBanner).toBe('function');
      expect(typeof copy.groups.awaitingApprovalBanner).toBe('function');
      expect(copy.groups.inviteAwaitingBanner('Unique-Group-Name-42')).toContain(
        'Unique-Group-Name-42',
      );
      expect(copy.groups.awaitingApprovalBanner('Unique-Group-Name-42')).toContain(
        'Unique-Group-Name-42',
      );
    }
  });
});
