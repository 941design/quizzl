# Architecture — Invite Link Lifecycle

## Paradigm

Modular monolith, package-by-feature. The app is a Next.js static export (client
only). Persistent state is device-local (idb-keyval / localStorage); nothing in
this epic transits a relay. UI is React + Chakra; reactive stores use the
`useSyncExternalStore` module-level pattern already established in
`unreadStore.ts`.

## Module Map

| Module | Purpose | Location | Owned data |
|--------|---------|----------|------------|
| inviteLinkStorage | Invite-link record model, expiry/usage helpers, one-shot migration | `app/src/lib/marmot/inviteLinkStorage.ts` | idb-keyval store `'few-invite-links'`; `InviteLink` shape |
| joinFlow | Enforce expiry on the incoming request gate; increment usage on approval | `app/src/lib/marmot/joinRequestHandler.ts`, `app/src/context/MarmotContext.tsx` (`approveJoinRequest`) | reads/writes `InviteLink.usageCount` via inviteLinkStorage; owns `PendingJoinRequest` |
| manageOverlay | Manage-links UI: dates, usage count, trashcan, expired styling, empty state; set expiry at creation | `app/src/components/groups/ManageInviteLinksModal.tsx`, `app/src/components/groups/GenerateInviteLinkModal.tsx` | none (renders inviteLinkStorage state) |
| notifications | Expiry bell slice, client-side expiry sweep, deep-link param | `app/src/lib/unreadStore.ts`, `app/src/components/NotificationBell.tsx`, `app/src/lib/marmot/inviteExpirySweep.ts` (new), `app/pages/groups.tsx` | `inviteExpiries` slice (per groupId, derived from links) |
| i18n | User-facing strings (en/de) | `app/src/lib/i18n.ts` | Copy keys |

## Boundary Rules

- No direct idb-keyval access to the `'few-invite-links'` store outside
  `inviteLinkStorage`. joinFlow, manageOverlay, and the sweep go through its
  exported helpers (`getInviteLink`, `loadInviteLinks`, `isExpired`,
  `incrementInviteLinkUsage`, `deleteInviteLink`, `markInviteLinkExpiryNotified`,
  `markInviteLinkExpiryAcknowledged`, `migrateInviteLinks`).
- The bell slice lives in `unreadStore.ts` and follows the exact
  init/increment/mark-read/clear/hook shape of the `joinRequests` slice. Other
  modules interact with it only through those exported functions.
- No user-visible string is hardcoded in a component; all go through
  `useCopy()` + `i18n.ts` (en + de).

## Seams

- **inviteLinkStorage ↔ everything**: `isExpired(link, now)` is the single
  expiry predicate, with the `expiresAt ?? createdAt + DAY_MS` fallback. Every
  read site (gate, UI, sweep) uses it — no site recomputes expiry inline.
- **joinFlow ↔ inviteLinkStorage**: usage increment is `incrementInviteLinkUsage(nonce)`,
  a no-op when the nonce is gone; called only after `inviteByNpub` returns ok.
- **notifications ↔ inviteLinkStorage**: the `inviteExpiries` slice is *derived*
  from stored link flags (`expired && expiryNotified && !expiryAcknowledged`) at
  init; the sweep is the only writer of `expiryNotified`; mark-read is the only
  writer of `expiryAcknowledged`.
- **notifications ↔ groups page**: deep-link via `manageLinks=1` query param,
  consumed once the detail view for `id` renders, then stripped.

## Implementation Constraints

- Static export: dynamic data via query params, not path segments (`/groups?id=…`).
- Multi-device by construction: gift-wrapped join requests arrive on all of the
  admin's sessions, but a device without the link's record drops the request at
  `getInviteLink` → undefined. So pending requests, approvals, usage counts, and
  expiry notifications are all confined to the link-creating device. There is no
  creator field and none is needed — do not add "created by this user" filtering
  to the sweep; it processes all locally-stored links.
- `vitest` unit tests only (no jsdom/@testing-library); hooks tested via exported
  pure functions. Time-dependent logic (`isExpired`, sweep) takes an injectable
  `now` so it is unit-testable without wall-clock.
- e2e must publish through the app; time control via Playwright clock or seeded
  `createdAt`.

## Order-Sensitive Composition

This epic composes several order/concurrency-sensitive flows. Downstream gates
(mutation, review) should treat the following modules as order-sensitive:

- **Flow: expiry notification (sweep → derive → acknowledge).**
  - Modules: `notifications` (`app/src/lib/marmot/inviteExpirySweep.ts`,
    `app/src/lib/unreadStore.ts`), `inviteLinkStorage`
    (`app/src/lib/marmot/inviteLinkStorage.ts`).
  - Whole-flow guarantees that must hold across orderings/interleavings:
    (a) each link notifies **at most once** despite React StrictMode
    double-effects and overlapping interval ticks — enforced by a module-level
    in-flight latch, not just idempotent adjectives; (b) a notification
    **survives reload** — the badge is derived from persisted flags, never an
    in-memory-only counter; (c) the migration's `expiryNotified` back-stamp
    suppresses the retroactive-expiry flood, and no non-migrated link is ever
    silently skipped; (d) IDB stamp precedes the in-memory counter bump so a
    crash errs toward "stamped-not-shown" (recovered on next init), never
    "shown twice".

- **Flow: usage counting under concurrent approvals.**
  - Modules: `joinFlow` (`app/src/context/MarmotContext.tsx`),
    `inviteLinkStorage` (`app/src/lib/marmot/inviteLinkStorage.ts`).
  - Guarantee: `incrementInviteLinkUsage` is a load-modify-save on idb-keyval;
    two rapid approvals must not lose an increment (serialize the read-modify-
    write, or the AC must explicitly accept the loss). Increment happens only
    after `inviteByNpub` succeeds; a missing nonce is a silent no-op that never
    blocks approval.

- **Flow: retroactive-expiry migration idempotency.**
  - Modules: `inviteLinkStorage` (`app/src/lib/marmot/inviteLinkStorage.ts`).
  - Guarantee: `migrateInviteLinks()` fills only missing fields and is safe to
    run concurrently with `loadInviteLinks`, the sweep, and the modal opening;
    re-running produces no change.
