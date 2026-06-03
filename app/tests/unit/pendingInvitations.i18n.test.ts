/**
 * i18n tests for pending invitations copy keys (S2, AC-STRUCT-3).
 * Verifies that both en and de have the required keys with non-empty values.
 */

import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

describe('pendingInvitations i18n keys', () => {
  it('English copy has all pendingInvitations keys', () => {
    const en = getCopy('en');
    const pi = en.groups.pendingInvitations;
    expect(pi.heading).toBe('Pending Invitations');
    expect(pi.acceptBtn).toBe('Accept');
    expect(pi.declineBtn).toBe('Decline');
    expect(pi.empty).toBe('No pending invitations');
    expect(pi.acceptError).toBe('This invitation is no longer valid');
    expect(pi.migrationNotice.body).toContain('contact privacy');
    expect(pi.migrationNotice.dismissBtn).toBe('Got it');
  });

  it('German copy has all pendingInvitations keys', () => {
    const de = getCopy('de');
    const pi = de.groups.pendingInvitations;
    expect(pi.heading).toBe('Ausstehende Einladungen');
    expect(pi.acceptBtn).toBe('Annehmen');
    expect(pi.declineBtn).toBe('Ablehnen');
    expect(pi.empty).toBe('Keine ausstehenden Einladungen');
    expect(pi.acceptError).toBe('Diese Einladung ist nicht mehr gültig');
    expect(pi.migrationNotice.body).toContain('Kontaktdatenschutz');
    expect(pi.migrationNotice.dismissBtn).toBe('Verstanden');
  });
});
