import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

describe('cancelPendingInvitation i18n keys', () => {
  it('English copy has all required keys with exact values', () => {
    const en = getCopy('en');
    expect(en.groups.cancelInviteButton).toBe('Cancel Invite');
    expect(en.groups.cancelInviteTitle).toBe('Cancel Pending Invitation');
    expect(en.groups.cancelInviteBody).toContain('removed from the group permanently');
    expect(en.groups.cancelInviteConfirm).toBe('Confirm');
    expect(en.groups.cancelInviteSuccess).toBe('Invitation cancelled');
    expect(en.groups.cancelInviteError).toBe('Failed to cancel invitation');
    expect(en.groups.cancelInviteRaceNotice).toBe(
      'Member just came online — cancellation no longer applies'
    );
    expect(typeof en.groups.cancelledByAnnouncement).toBe('function');
    expect(en.groups.cancelledByAnnouncement('Alice', 'Bob')).toBe(
      'Alice was uninvited by Bob'
    );
  });

  it('German copy has all required keys with exact values', () => {
    const de = getCopy('de');
    expect(de.groups.cancelInviteButton).toBe('Einladung zurückziehen');
    expect(de.groups.cancelInviteTitle).toBe('Ausstehende Einladung zurückziehen');
    expect(de.groups.cancelInviteBody).toContain('dauerhaft aus der Gruppe entfernt');
    expect(de.groups.cancelInviteConfirm).toBe('Bestätigen');
    expect(de.groups.cancelInviteSuccess).toBe('Einladung zurückgezogen');
    expect(de.groups.cancelInviteError).toBe('Einladung konnte nicht zurückgezogen werden');
    expect(de.groups.cancelInviteRaceNotice).toBe(
      'Mitglied ist gerade online — Einladung kann nicht mehr zurückgezogen werden'
    );
    expect(typeof de.groups.cancelledByAnnouncement).toBe('function');
    expect(de.groups.cancelledByAnnouncement('Alice', 'Bob')).toBe(
      'Alice wurde von Bob ausgeladen'
    );
  });
});
