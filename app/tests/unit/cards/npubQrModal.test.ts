/**
 * Unit tests for NpubQrModal's validity-hint gate (epic: contact-pairing-code,
 * story S5, AC-UI-1).
 *
 * Because the vitest environment does not include a DOM renderer or
 * @testing-library/react (see memberListAdminUi.test.ts's precedent), this
 * exercises the extracted, exported render-gate predicate
 * (`shouldShowValidityHint`) directly rather than rendering the component.
 * DOM-level assertions (the hint text actually appearing in the share
 * modal) are covered by the e2e suite (S6) via the `npub-qr-modal-
 * validity-hint` data-testid this predicate gates.
 */
import { describe, it, expect } from 'vitest';
import { shouldShowValidityHint } from '@/src/components/groups/NpubQrModal';

describe('shouldShowValidityHint (AC-UI-1)', () => {
  it('shows the hint when both shareUrl and validityHint are present (the pairing share-card case)', () => {
    expect(shouldShowValidityHint('https://few.chat/add#c=abc', 'This code works for about 30 minutes.')).toBe(true);
  });

  it('does not show the hint for a bare-npub display (no shareUrl) even with validityHint provided', () => {
    expect(shouldShowValidityHint(undefined, 'This code works for about 30 minutes.')).toBe(false);
  });

  it('does not show the hint when the caller omits validityHint (e.g. group-invite QR reusing shareUrl-shaped display)', () => {
    expect(shouldShowValidityHint('https://few.chat/add#c=abc', undefined)).toBe(false);
  });

  it('does not show the hint when neither is present', () => {
    expect(shouldShowValidityHint(undefined, undefined)).toBe(false);
  });

  it('does not show the hint for an empty-string shareUrl or validityHint', () => {
    expect(shouldShowValidityHint('', 'hint')).toBe(false);
    expect(shouldShowValidityHint('https://few.chat/add#c=abc', '')).toBe(false);
  });
});
