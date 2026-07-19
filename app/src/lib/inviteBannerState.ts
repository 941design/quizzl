/**
 * Pure decision logic for the returning-user invite-link landing
 * (epic: invite-link-awaiting-landing, story S3).
 *
 * `app/pages/groups.tsx` and `InviteAwaitingBanner.tsx` are React
 * components with Chakra/Next imports — this repo has no jsdom/
 * @testing-library precedent, so the state-machine deciding which of the
 * five UX states to render is extracted here as a pure, dependency-free
 * function and unit-tested exhaustively (mirrors `freshIdentity.ts`'s
 * `deriveIsFreshIdentity` extraction and `groups.tsx`'s existing
 * `shouldOpenManageLinksOverlay`/`shouldRedirectToGroupsList` precedent).
 */

export type InviteBannerState =
  | 'none'
  | 'first-visit'
  | 'already-member'
  | 'loading'
  | 'awaiting'
  | 'invited';

export interface ResolveInviteBannerStateParams {
  /** True when the URL's `join`, `admin`, and `name` query params are all present. */
  hasJoinParams: boolean;
  /**
   * `useNostrIdentity().isFreshIdentity` — a genuine first-time visitor.
   * DD-5: takes precedence over every other state; the full-screen
   * JoinRequestCard/WelcomeInvite delegation (unchanged pre-S3 behavior)
   * owns this case, not the returning-user banner.
   */
  isFreshIdentity: boolean;
  /** Whether the requesting user is already a member of the target group. */
  isAlreadyMember: boolean;
  /**
   * Whether an unexpired `OutboundJoinRequestRecord` exists for the link's
   * nonce (S2's `getSnapshot()`/`useOutboundJoinRequests()` surface).
   */
  nonceHasUnexpiredRecord: boolean;
  /**
   * S2's `isOutboundJoinRequestsLoaded()` signal. AC-LAND-4: while the
   * async IDB load has not yet resolved, the state machine must not guess
   * "invited" (a false-empty read of the not-yet-loaded store would flash
   * the Invited banner even when a record already exists for the nonce).
   */
  loaded: boolean;
}

/**
 * Resolves which of the five landing/banner states to render.
 *
 * Priority order (highest first):
 *   1. `!hasJoinParams` -> 'none' (plain groups-list visit, no invite link).
 *   2. `isFreshIdentity` -> 'first-visit' (DD-5, AC-LAND-2 — unaffected by
 *      this story; the full-screen delegation owns this branch).
 *   3. `isAlreadyMember` -> 'already-member' (AC-BANNER-4) — independent of
 *      the outbound-store load state; group membership is a separate,
 *      already-available signal (`MarmotContext`), so there is no reason to
 *      wait on `loaded` for this case.
 *   4. `!loaded` -> 'loading' (AC-LAND-4 flash-avoidance) — render nothing/
 *      a placeholder rather than guessing Invited before the store answers.
 *   5. `nonceHasUnexpiredRecord` -> 'awaiting' (AC-BANNER-2, AC-LAND-4).
 *   6. otherwise -> 'invited' (AC-BANNER-1).
 */
export function resolveInviteBannerState(
  params: ResolveInviteBannerStateParams,
): InviteBannerState {
  const { hasJoinParams, isFreshIdentity, isAlreadyMember, nonceHasUnexpiredRecord, loaded } = params;

  if (!hasJoinParams) return 'none';
  if (isFreshIdentity) return 'first-visit';
  if (isAlreadyMember) return 'already-member';
  if (!loaded) return 'loading';
  if (nonceHasUnexpiredRecord) return 'awaiting';
  return 'invited';
}

/**
 * AC-LAND-3: computes the `router.replace` target after a successful
 * inline Request-to-join send — the bare `/groups` path with `join`,
 * `admin`, and `name` stripped, trailing-slash aware (this is a static-
 * export app with `trailingSlash: true`; a hardcoded '/groups' would not
 * match a visit that arrived via '/groups/', re-appending the slash on the
 * very next navigation and producing a double redirect/flash).
 *
 * Any OTHER query params present are preserved (defensive — this route
 * does not currently combine `join` with unrelated params, but stripping
 * only the three named keys rather than the whole query string avoids
 * silently discarding a future one).
 *
 * `asPath` is `router.asPath` — the literal path+query+hash currently
 * displayed, whichever trailing-slash form the user actually arrived
 * under.
 */
export function computeGroupsPathAfterJoinSend(asPath: string): string {
  const [pathAndQuery] = asPath.split('#');
  const [path, queryString] = pathAndQuery.split('?');
  if (!queryString) return path;

  const params = new URLSearchParams(queryString);
  params.delete('join');
  params.delete('admin');
  params.delete('name');

  const remaining = params.toString();
  return remaining ? `${path}?${remaining}` : path;
}
