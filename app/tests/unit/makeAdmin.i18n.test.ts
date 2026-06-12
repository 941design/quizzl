/**
 * Verifies that the i18n keys consumed by handleMakeAdmin (groups.tsx S6 wiring)
 * are defined for all supported languages. The toast feedback logic maps
 * ALL non-ok results from grantAdmin to `makeAdminError` — no per-code branching.
 * DOM-level integration coverage lives in S7 e2e tests.
 */
import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

describe('makeAdmin i18n keys (S6 handleMakeAdmin toast feedback)', () => {
  it('English copy has makeAdminSuccess and makeAdminError', () => {
    const en = getCopy('en');
    expect(en.groups.makeAdminSuccess).toBe('Admin granted');
    expect(en.groups.makeAdminError).toBe('Failed to grant admin. Please try again.');
  });

  it('German copy has makeAdminSuccess and makeAdminError', () => {
    const de = getCopy('de');
    expect(de.groups.makeAdminSuccess).toBe('Admin-Rechte erteilt');
    expect(de.groups.makeAdminError).toBe(
      'Admin-Rechte konnten nicht erteilt werden. Bitte erneut versuchen.'
    );
  });

  it('leavePendingBadge is defined (used for ALL pending-removal states, including admin-side removals)', () => {
    const en = getCopy('en');
    expect(en.groups.leavePendingBadge).toBe('Departed, cleanup pending');
    // removalPendingBadge is reserved for a future cause-distinction increment.
    // It is defined but not rendered by any component today (S6 decision: PendingRemoval
    // has no cause field; all pending removals render as leavePendingBadge).
    expect(en.groups.removalPendingBadge).toBe('Removal pending');
  });
});
