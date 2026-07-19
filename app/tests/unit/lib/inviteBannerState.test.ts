/**
 * Unit coverage for the returning-user invite-link landing state machine
 * (epic: invite-link-awaiting-landing, story S3).
 *
 * Plain vitest, no jsdom — both functions are pure and dependency-free.
 * `resolveInviteBannerState` is exercised exhaustively across its full
 * priority order (VQ-S3-004): AC-LAND-1/2/4, AC-BANNER-1/2/4.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveInviteBannerState,
  computeGroupsPathAfterJoinSend,
  type ResolveInviteBannerStateParams,
} from '@/src/lib/inviteBannerState';

const BASE: ResolveInviteBannerStateParams = {
  hasJoinParams: true,
  isFreshIdentity: false,
  isAlreadyMember: false,
  nonceHasUnexpiredRecord: false,
  loaded: true,
};

describe('resolveInviteBannerState', () => {
  // AC-LAND-1: no join/admin/name -> 'none', regardless of every other flag
  // (a plain groups-list visit must never show first-visit/banner UI).
  it("returns 'none' when join params are absent, regardless of other flags", () => {
    expect(resolveInviteBannerState({ ...BASE, hasJoinParams: false })).toBe('none');
    expect(
      resolveInviteBannerState({
        hasJoinParams: false,
        isFreshIdentity: true,
        isAlreadyMember: true,
        nonceHasUnexpiredRecord: true,
        loaded: false,
      }),
    ).toBe('none');
  });

  // AC-LAND-2 (DD-5): a genuine first-time visitor takes precedence over
  // every returning-user state, including already-member and awaiting.
  it("returns 'first-visit' whenever isFreshIdentity is true and join params are present, taking priority over already-member/awaiting", () => {
    expect(resolveInviteBannerState({ ...BASE, isFreshIdentity: true })).toBe('first-visit');
    expect(
      resolveInviteBannerState({
        ...BASE,
        isFreshIdentity: true,
        isAlreadyMember: true,
        nonceHasUnexpiredRecord: true,
        loaded: false,
      }),
    ).toBe('first-visit');
  });

  // AC-BANNER-4: already-a-member renders the already-member state instead
  // of an actionable Invited/Awaiting banner — and does so even before the
  // outbound store has loaded, since membership is a separate signal.
  it("returns 'already-member' when the user is already a member, even while the outbound store has not loaded yet", () => {
    expect(resolveInviteBannerState({ ...BASE, isAlreadyMember: true })).toBe('already-member');
    expect(
      resolveInviteBannerState({ ...BASE, isAlreadyMember: true, loaded: false }),
    ).toBe('already-member');
  });

  // AC-LAND-4: while the outbound store has not resolved its initial async
  // load, never guess 'invited' — render the loading placeholder instead,
  // so a record that DOES exist for this nonce never flashes as Invited.
  it("returns 'loading' when the outbound store has not finished its initial load (not already-member, not first-visit)", () => {
    expect(resolveInviteBannerState({ ...BASE, loaded: false })).toBe('loading');
    expect(
      resolveInviteBannerState({ ...BASE, loaded: false, nonceHasUnexpiredRecord: true }),
    ).toBe('loading');
  });

  // AC-BANNER-2 / AC-LAND-4: once loaded, an unexpired record for this nonce
  // renders Awaiting immediately — no Invited flash.
  it("returns 'awaiting' once loaded and an unexpired record exists for the nonce", () => {
    expect(resolveInviteBannerState({ ...BASE, loaded: true, nonceHasUnexpiredRecord: true })).toBe(
      'awaiting',
    );
  });

  // AC-BANNER-1: the default returning-user case — loaded, no record yet,
  // not already a member.
  it("returns 'invited' once loaded with no unexpired record and not already a member", () => {
    expect(resolveInviteBannerState({ ...BASE, loaded: true, nonceHasUnexpiredRecord: false })).toBe(
      'invited',
    );
  });

  // Sequence: simulates the real AC-REACT-3 transition — the same
  // hasJoinParams/isFreshIdentity/isAlreadyMember/loaded inputs, only
  // nonceHasUnexpiredRecord flips true after a successful send resolves.
  it('sequence: invited -> awaiting as nonceHasUnexpiredRecord flips true (AC-REACT-3 transition), all other inputs held constant', () => {
    const before = resolveInviteBannerState({ ...BASE, nonceHasUnexpiredRecord: false });
    expect(before).toBe('invited');
    const after = resolveInviteBannerState({ ...BASE, nonceHasUnexpiredRecord: true });
    expect(after).toBe('awaiting');
  });
});

describe('computeGroupsPathAfterJoinSend — AC-LAND-3', () => {
  it('strips join/admin/name from a bare (no trailing slash) /groups URL', () => {
    expect(
      computeGroupsPathAfterJoinSend('/groups?join=abc123&admin=npub1x&name=My%20Group'),
    ).toBe('/groups');
  });

  it('strips join/admin/name from a trailing-slash /groups/ URL, preserving the trailing slash', () => {
    expect(
      computeGroupsPathAfterJoinSend('/groups/?join=abc123&admin=npub1x&name=My%20Group'),
    ).toBe('/groups/');
  });

  it('preserves an unrelated query param while stripping join/admin/name', () => {
    expect(
      computeGroupsPathAfterJoinSend('/groups?join=abc123&admin=npub1x&name=My%20Group&foo=bar'),
    ).toBe('/groups?foo=bar');
  });

  it('is a no-op when there is no query string at all (bare path)', () => {
    expect(computeGroupsPathAfterJoinSend('/groups')).toBe('/groups');
  });

  it('is a no-op when there is no query string, trailing-slash form', () => {
    expect(computeGroupsPathAfterJoinSend('/groups/')).toBe('/groups/');
  });

  it('strips a hash fragment defensively (not expected in this app, but must not corrupt the path)', () => {
    expect(
      computeGroupsPathAfterJoinSend('/groups?join=abc123&admin=npub1x&name=My%20Group#section'),
    ).toBe('/groups');
  });
});
