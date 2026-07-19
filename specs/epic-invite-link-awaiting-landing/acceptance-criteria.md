# Invite-link awaiting landing — Acceptance Criteria

## Terminology

- **Returning user** — a user with an existing local identity (and, usually, one or more
  joined groups) opening a group invite link, as distinct from a genuine first-time
  visitor (out of scope, DD-5).
- **Invited state** — the banner/UX state shown when the URL carries `?join=&admin=&name=`
  for a nonce with no existing `OutboundJoinRequestRecord`.
- **Awaiting state** — the banner/UX state shown when an unexpired `OutboundJoinRequestRecord`
  exists for a nonce (whether reached via the link's own query params or a prior visit).
- **Outbound join-request record** — the `OutboundJoinRequestRecord` persisted in the
  `few-outbound-join-requests` IndexedDB store by `saveOutboundJoinRequest`
  (`app/src/lib/marmot/outboundJoinRequests.ts`), carrying `nonce`, `adminPubkeyHex`,
  `groupName`, `sentAt`.
- **Nonce** — the `join` query-param value; the correlation key for an outbound record and
  the invite link that produced it.

## Known TAGs

- **LAND** — groups-page landing/route-branch assertions.
- **BANNER** — invited/awaiting info-banner assertions.
- **CARD** — awaiting-card + Cancel assertions.
- **STORE** — reactive outbound-record read path + persistence + expiry assertions.
- **REACT** — reactive UI transition assertions (no manual refresh).
- **I18N** — copy-parity assertions.
- **E2E** — end-to-end flow assertions.
- **OBS** — cross-cutting whole-flow property assertions.

## Landing / Route Branch (S3)

**AC-LAND-1** — When a returning user's URL query carries `join`, `admin`, and `name` all
present, `GroupsPage()` (`app/pages/groups.tsx`) MUST render the groups list view (existing
group cards, offline/backup banners, `PendingInvitations` section) instead of returning
`<JoinRequestCard>` as a full-page replacement.

**AC-LAND-2** — The branch that renders the first-visit welcome screen for a genuine
first-time visitor on the same `?join=&admin=&name=` route MUST remain unchanged and MUST
still take precedence over the returning-user list-view branch (DD-5).

**AC-LAND-3** — After a successful inline Request-to-join send, `GroupsPage()` MUST call
`router.replace` to the bare `/groups` path (trailing-slash aware, matching both `/groups`
and `/groups/`), removing `join`, `admin`, and `name` from the URL.

**AC-LAND-4** — When an unexpired outbound record already exists for the link's `nonce` at
the time the page opens, the page MUST render the Awaiting state immediately; it MUST NOT
render the Invited state or offer a "Request to join" action for that nonce.

**AC-LAND-5** — The existing `?id=` group-detail branch (`<GroupDetailView>`) MUST remain
reachable and unaffected by the returning-user invite-link branch change.

## Info Banner (S3)

**AC-BANNER-1** — When no outbound record exists for the link's `nonce`, an `info`-status
banner MUST render above the groups list naming the group from the `name` query param and
MUST expose a "Request to join" action.

**AC-BANNER-2** — When an unexpired outbound record exists for a `nonce`, an `info`-status
banner MUST render above the groups list stating that the request to join the named group
is awaiting admin approval, and MUST NOT expose a "Request to join" action for that nonce.

**AC-BANNER-3** — The inline "Request to join" action MUST gate the visible name-entry
field using the same `isWelcomeJoinRequestDisabled` predicate `JoinRequestCard` already
applies, so a nameless user is blocked identically in both surfaces.

**AC-BANNER-4** — When the requesting user is already a member of the target group, the
banner MUST render `JoinRequestCard`'s existing already-member state
(`JoinRequestCard.tsx:113`) instead of an actionable Invited or Awaiting banner.

**AC-BANNER-5** — The invited/awaiting banner and its associated awaiting card MUST render
as a section visually distinct from the `PendingInvitations` section (inbound Welcomes); the
two MUST NOT be merged into one list or one heading.

## Awaiting Card + Cancel (S4)

**AC-CARD-1** — For every unexpired outbound join-request record, a dimmed card carrying an
"awaiting" badge MUST render among the groups list's joined-group cards.

**AC-CARD-2** — The awaiting card MUST NOT be a navigable link to a group-detail view (no
`?id=` navigation on click), since no MLS group has been joined yet for that record.

**AC-CARD-3** — The awaiting card's Cancel action MUST call `cancelOutboundJoinRequest(nonce)`
(the `outboundJoinRequests.ts`-exported action, never `idb-keyval` directly) and MUST NOT
attempt to retract or otherwise signal the already-sent join-request rumor (DD-4).

## Reactive Outbound-Record Read Path (S2)

**AC-STORE-1** — `app/src/lib/marmot/outboundJoinRequests.ts` MUST export a `subscribe(listener): () => void`
function and a synchronous `getSnapshot(): OutboundJoinRequestRecord[]` function; `getSnapshot()`
MUST return the same array reference across repeated calls until the underlying record set
actually changes.

**AC-STORE-2** — `getSnapshot()` MUST exclude any record older than the 7-day TTL already
enforced by `loadUnexpiredOutboundJoinRequestsForAdmin`, evaluated at snapshot-compute time.

**AC-STORE-3** — The store MUST expose a loaded-state signal that distinguishes "not yet
loaded from IndexedDB" from "loaded and empty," so a consumer can render a placeholder
instead of a false-empty state before the initial async load resolves.

**AC-STORE-4** — Every call to `saveOutboundJoinRequest` and every call to
`deleteOutboundJoinRequest` MUST invoke the change-notification emitter exactly once per
call, recomputing the cached snapshot before notifying listeners.

**AC-STORE-5** — `outboundJoinRequests.ts` MUST export a `cancelOutboundJoinRequest(nonce)`
action that calls `deleteOutboundJoinRequest(nonce)`, so UI consumers never call
`deleteOutboundJoinRequest` directly and never import `idb-keyval` themselves.

## Reactive Transitions (S4)

**AC-REACT-1** — When `welcomeSubscription.ts`'s auto-accept path
(`welcomeSubscription.ts:553`) calls `deleteOutboundJoinRequest`, the awaiting card and
banner for that nonce MUST disappear from the rendered groups page without a manual reload.

**AC-REACT-2** — When the user taps Cancel on an awaiting card, that card and the awaiting
banner MUST disappear from the rendered groups page without a manual reload.

**AC-REACT-3** — After a successful inline Request-to-join send resolves (the outbound
record is saved), the banner MUST switch from the Invited state to the Awaiting state
without a manual reload.

## i18n Copy Parity (S1)

**AC-I18N-1** — `app/src/lib/i18n.ts` MUST define a `groups.*` copy key for the Invited
banner text and a `groups.*` copy key for the Awaiting banner text, each present under both
the `en` and `de` `Copy` objects, each accepting the group name as a function argument.

**AC-I18N-2** — `app/src/lib/i18n.ts` MUST define a `groups.*` copy key for the "awaiting"
badge label, present under both the `en` and `de` `Copy` objects.

**AC-I18N-3** — `app/src/lib/i18n.ts` MUST define a `groups.*` copy key for the Cancel
control label, present under both the `en` and `de` `Copy` objects.

## E2E Coverage (S5)

**AC-E2E-1** — A `groups-*.spec.ts` Playwright spec MUST drive, through the running app (no
raw WebSocket), a returning user opening an invite link, observing the Invited banner and
then, after tapping Request to join, the Awaiting banner and awaiting card — and MUST assert
the awaiting card is still present after a page reload.

**AC-E2E-2** — A `groups-*.spec.ts` Playwright spec MUST drive Cancel on the awaiting card
and assert the awaiting card and Awaiting banner are removed without a `reload()` call
(live UI update, matching the `groups-join-request-live.spec.ts` no-reload pattern).

**AC-E2E-3** — A `groups-*.spec.ts` Playwright spec MUST drive, via a second
`browser.newContext()` signed in as the admin, an approval of the join request and assert
that the awaiting card disappears and the real joined group card appears in the requesting
user's session without a `reload()` call.

**AC-E2E-4** — The e2e suite MUST reference `data-testid` values for the awaiting banner,
the awaiting card (keyed by the same pubkey/nonce-prefix convention as `pending-request-row-*`),
and the Cancel action, and those `data-testid` attributes MUST be present in the rendered
DOM at the corresponding component.

## Cross-Cutting Invariants

**AC-OBS-1** — For any interleaving of {the async initial snapshot load, a `save`, a
`Cancel`-triggered delete, an auto-accept-triggered delete} touching a given nonce, once a
delete for that nonce has been applied to the `few-outbound-join-requests` store, no
subsequent call to `getSnapshot()` — including one triggered by an async load that started
before the delete but resolves after it — MUST include a record for that nonce.

Spans modules: Outbound-join-request store, Groups page, welcomeSubscription.ts (auto-accept path)

**AC-OBS-2** — Across any interleaving of the `MarmotContext` `groups` array update and the
`deleteOutboundJoinRequest` call that together constitute one auto-accept transition for a
given nonce:
- (strong, enforced) there MUST NOT exist a rendered frame in which both the awaiting card
  and the corresponding real joined-group card are simultaneously visible; and
- (bounded) the transition MUST NOT leave a *lasting* state in which neither is visible: the
  real joined-group card MUST become visible within a bounded window after the awaiting card
  disappears. A brief transitional frame in which neither is shown — inherent to the async,
  network-backed join (the auto-accept path advances the MLS group and refreshes
  `MarmotContext.groups` asynchronously) — is permitted.

*Amended (Decider RETRY, 2026-07-19): the original "never neither" half was an epic-derived
candidate invariant (see architecture.md `## Order-Sensitive Composition`), not a DD
requirement. The shipped auto-accept path (`MarmotContext.onGroupJoined → void reloadGroups()`,
fire-and-forget) is async by construction; a neither-visible frame was observed zero times in
11/11 e2e runs and has no data/correctness impact (the record IS deleted and the group IS
joined). Hardening it would require reordering prior-epic auto-accept code for a never-observed
cosmetic frame — disproportionate risk. The "never BOTH" half stays fully enforced and tested.*

Spans modules: Outbound-join-request store, Groups page, welcomeSubscription.ts (auto-accept path)

**AC-OBS-3** — For any ordering in which a user's Cancel (local delete of the outbound
record) precedes a later-arriving admin-approval Welcome for the same nonce, the Welcome
MUST NOT be silently dropped: it MUST still surface via the existing manual Accept/Decline
pending-invitations path.

Spans modules: Outbound-join-request store, Groups page, welcomeSubscription.ts (auto-accept path)

## Manual Validation

None. Every AC above is enforceable via Vitest unit tests (store/emitter/i18n, pure-function
extraction per project convention) or Playwright e2e specs in the `groups-*` relay bucket; no
AC in this file requires an un-automatable human check.
