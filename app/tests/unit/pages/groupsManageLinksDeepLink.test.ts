/**
 * Unit tests for the `manageLinks=1` deep-link's PURE decision logic
 * (epic: invite-link-lifecycle, story S4 — `app/pages/groups.tsx`'s
 * `shouldOpenManageLinksOverlay` / `shouldRedirectToGroupsList`).
 *
 * `groups.tsx` is a page component (Chakra/Next imports) — this repo has no
 * jsdom/@testing-library/renderHook precedent (see testing.md conventions
 * in exploration.json), so the deep-link decision worth testing directly is
 * extracted into two exported, dependency-injectable pure functions,
 * mirroring `profile.tsx`'s `planProfileAnnounceFanout` extraction
 * (`app/tests/unit/pages/profile-announce-fanout.test.ts`). Neither React
 * nor the groups page is mounted here.
 */
import { describe, it, expect } from 'vitest';
import { shouldOpenManageLinksOverlay, shouldRedirectToGroupsList, nextManageLinksGuard } from '@/pages/groups';

describe('shouldOpenManageLinksOverlay — AC-DEEPLINK-1', () => {
  it('does not open before the detail view has rendered, even with manageLinks=1', () => {
    expect(
      shouldOpenManageLinksOverlay({
        manageLinksParam: '1',
        groupResolved: false,
        alreadyHandled: false,
      }),
    ).toBe(false);
  });

  it('opens once the detail view has rendered (groupResolved true) and manageLinks=1', () => {
    expect(
      shouldOpenManageLinksOverlay({
        manageLinksParam: '1',
        groupResolved: true,
        alreadyHandled: false,
      }),
    ).toBe(true);
  });

  it('does not re-open once already handled (idempotent across re-renders)', () => {
    expect(
      shouldOpenManageLinksOverlay({
        manageLinksParam: '1',
        groupResolved: true,
        alreadyHandled: true,
      }),
    ).toBe(false);
  });

  it('does nothing when manageLinks is absent (AC-DEEPLINK-2\'s reload-recheck: stripped param must not re-open)', () => {
    expect(
      shouldOpenManageLinksOverlay({
        manageLinksParam: undefined,
        groupResolved: true,
        alreadyHandled: false,
      }),
    ).toBe(false);
  });

  it('does nothing for a non-"1" manageLinks value', () => {
    expect(
      shouldOpenManageLinksOverlay({
        manageLinksParam: 'true',
        groupResolved: true,
        alreadyHandled: false,
      }),
    ).toBe(false);
  });

  // Simulates the full mount sequence: group not yet in the admin's list at
  // mount (groupResolved=false), then arriving (groupResolved=true) —
  // proves the open call is gated on the transition, not merely eventual.
  it('sequence: group unresolved at mount then resolving — open fires only at the resolving step', () => {
    const atMount = shouldOpenManageLinksOverlay({
      manageLinksParam: '1',
      groupResolved: false,
      alreadyHandled: false,
    });
    expect(atMount).toBe(false);

    const afterResolve = shouldOpenManageLinksOverlay({
      manageLinksParam: '1',
      groupResolved: true,
      alreadyHandled: false,
    });
    expect(afterResolve).toBe(true);
  });

  // Gate-remediation regression (Finding 1): `GroupDetailView` is not
  // unmounted across client-side navigation between group detail URLs, so
  // its `manageLinksDeepLinkHandledRef` guard survives a group change. The
  // call site now keys that ref to the group `id`
  // (`manageLinksDeepLinkHandledRef.current === id`) rather than latching a
  // bare boolean, so a SECOND deep-link arrival for a DIFFERENT group still
  // opens the overlay. This test simulates that call-site computation
  // across two arrivals within the same (unmounted) page instance — a bare
  // `useRef(false)` would have latched `alreadyHandled` to `true` forever
  // after the first arrival and permanently suppressed every later one,
  // including for an unrelated group.
  it('a second deep-link for a DIFFERENT group id still opens, even though the ref was already set by an earlier deep-link for another group (Finding 1)', () => {
    // Mirrors groups.tsx's `manageLinksDeepLinkHandledRef` — a ref keyed to
    // the group id it last handled, not a bare boolean.
    let handledForRef: string | null = null;

    // First deep-link arrival: group A.
    const firstOpens = shouldOpenManageLinksOverlay({
      manageLinksParam: '1',
      groupResolved: true,
      alreadyHandled: handledForRef === 'group-a',
    });
    expect(firstOpens).toBe(true);
    handledForRef = 'group-a'; // what the fixed call site sets on open

    // Second deep-link arrival, same page instance (ref carries over —
    // GroupDetailView does not remount on client-side nav), a DIFFERENT
    // group id. Under the old `useRef(false)` scheme this ref would
    // already be latched `true` and this decision would wrongly be
    // `false`; keyed-by-id, it must still open for the new group.
    const secondOpensForDifferentGroup = shouldOpenManageLinksOverlay({
      manageLinksParam: '1',
      groupResolved: true,
      alreadyHandled: handledForRef === 'group-b',
    });
    expect(secondOpensForDifferentGroup).toBe(true);
  });
});

describe('shouldRedirectToGroupsList — AC-DEEPLINK-3', () => {
  it('redirects when the target groupId is absent from the admin\'s group list and ready', () => {
    expect(
      shouldRedirectToGroupsList({
        manageLinksParam: '1',
        ready: true,
        id: 'missing-group',
        groupIds: ['group-a', 'group-b'],
      }),
    ).toBe(true);
  });

  it('does not redirect when the target groupId IS present', () => {
    expect(
      shouldRedirectToGroupsList({
        manageLinksParam: '1',
        ready: true,
        id: 'group-a',
        groupIds: ['group-a', 'group-b'],
      }),
    ).toBe(false);
  });

  it('does not redirect while groups have not finished loading (ready=false) — cannot yet distinguish absent from not-loaded', () => {
    expect(
      shouldRedirectToGroupsList({
        manageLinksParam: '1',
        ready: false,
        id: 'missing-group',
        groupIds: [],
      }),
    ).toBe(false);
  });

  it('does not redirect without the manageLinks=1 deep-link param (plain ?id=<missing> keeps its existing not-found alert behavior)', () => {
    expect(
      shouldRedirectToGroupsList({
        manageLinksParam: undefined,
        ready: true,
        id: 'missing-group',
        groupIds: ['group-a'],
      }),
    ).toBe(false);
  });

  it('does not redirect when id is undefined', () => {
    expect(
      shouldRedirectToGroupsList({
        manageLinksParam: '1',
        ready: true,
        id: undefined,
        groupIds: ['group-a'],
      }),
    ).toBe(false);
  });
});

describe('nextManageLinksGuard — id-keyed guard with same-mount reset', () => {
  it('opens for a fresh arrival and records the id (guard was null)', () => {
    expect(
      nextManageLinksGuard({ manageLinksParam: '1', groupResolved: true, handledForId: null, id: 'A' }),
    ).toEqual({ open: true, handledForId: 'A' });
  });

  it('does not re-open within the same arrival while the param is still present (guard === id)', () => {
    // Transient re-render before router.replace strips the param: must not double-open.
    expect(
      nextManageLinksGuard({ manageLinksParam: '1', groupResolved: true, handledForId: 'A', id: 'A' }),
    ).toEqual({ open: false, handledForId: 'A' });
  });

  it('keeps the guard (no reset) when the param is present but the group has not resolved yet', () => {
    expect(
      nextManageLinksGuard({ manageLinksParam: '1', groupResolved: false, handledForId: 'A', id: 'A' }),
    ).toEqual({ open: false, handledForId: 'A' });
  });

  it('RESETS the guard to null once the param is absent (after strip) — the same-group reset signal', () => {
    expect(
      nextManageLinksGuard({ manageLinksParam: undefined, groupResolved: true, handledForId: 'A', id: 'A' }),
    ).toEqual({ open: false, handledForId: null });
  });

  it('re-opens for a SECOND same-group arrival after the guard was reset (Finding 2 regression)', () => {
    // 1) open for A → guard A. 2) param stripped → guard reset to null.
    const afterReset = nextManageLinksGuard({
      manageLinksParam: undefined,
      groupResolved: true,
      handledForId: 'A',
      id: 'A',
    });
    expect(afterReset.handledForId).toBeNull();
    // 3) a new expiry notification for the SAME group A arrives → must re-open.
    expect(
      nextManageLinksGuard({
        manageLinksParam: '1',
        groupResolved: true,
        handledForId: afterReset.handledForId,
        id: 'A',
      }),
    ).toEqual({ open: true, handledForId: 'A' });
  });

  it('opens for a DIFFERENT group even while the guard still holds the previous id (Finding 1 regression)', () => {
    expect(
      nextManageLinksGuard({ manageLinksParam: '1', groupResolved: true, handledForId: 'A', id: 'B' }),
    ).toEqual({ open: true, handledForId: 'B' });
  });

  it('never opens for a stripped URL even though the guard is null (AC-DEEPLINK-2 holds)', () => {
    expect(
      nextManageLinksGuard({ manageLinksParam: undefined, groupResolved: true, handledForId: null, id: 'A' }),
    ).toEqual({ open: false, handledForId: null });
  });
});
