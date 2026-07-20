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
    expect(pi.badge).toBe('Invitation');
    expect(pi.invitedBy('Alice')).toBe('Invited by Alice');
    expect(pi.unknownGroupFallback).toBe('Group invitation');
    expect(pi.adminLabel).toBe('Group admins');
    expect(pi.acceptBtn).toBe('Accept');
    expect(pi.declineBtn).toBe('Decline');
    expect(pi.acceptError).toBe('This invitation is no longer valid');
  });

  it('German copy has all pendingInvitations keys', () => {
    const de = getCopy('de');
    const pi = de.groups.pendingInvitations;
    expect(pi.badge).toBe('Einladung');
    expect(pi.invitedBy('Alice')).toBe('Eingeladen von Alice');
    expect(pi.unknownGroupFallback).toBe('Gruppeneinladung');
    expect(pi.adminLabel).toBe('Gruppen-Admins');
    expect(pi.acceptBtn).toBe('Annehmen');
    expect(pi.declineBtn).toBe('Ablehnen');
    expect(pi.acceptError).toBe('Diese Einladung ist nicht mehr gültig');
  });
});
