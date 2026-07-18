# Invite Link Lifecycle — Acceptance Criteria

## Terminology

- **DAY_MS** — the constant `86_400_000` (24 hours in milliseconds) exported by the invite-link storage module.
- **InviteLink** — the persisted record `{nonce, groupId, createdAt, expiresAt, usageCount, expiryNotified, expiryAcknowledged, label?, muted}` in the idb-keyval store `few-invite-links`.
- **effectiveExpiry** — `link.expiresAt ?? (link.createdAt + DAY_MS)`, the fallback-covered expiry timestamp `isExpired` consults.
- **migration time** — the wall-clock `now` argument passed to `migrateInviteLinks()` at the moment it runs.
- **the sweep** — the client-side routine (new, this epic — `app/src/lib/marmot/inviteExpirySweep.ts`, named in `spec.md`'s Technical Approach; confirmed absent today by exploration's `expiry` finding, "NONE exists on invite links today") that scans stored links, notifies newly-unnotified expired ones, and stamps `expiryNotified`.
- **the gate** — the incoming join-request check in `handleJoinRequest` that resolves a link by nonce and decides whether to persist a `PendingJoinRequest`.

## Known TAGs

- **STRUCT** — structural assertions about constants/types.
- **MODEL** — `InviteLink` record shape and storage-helper behavior.
- **MIGRATE** — one-shot migration behavior.
- **ENFORCE** — join-request gate expiry enforcement.
- **USAGE** — usage-count increment behavior.
- **UI** — manage-overlay rendering and interaction.
- **NOTIFY** — expiry bell slice and sweep.
- **DEEPLINK** — `manageLinks` query-param deep link.
- **INV** — cross-cutting, order-sensitive invariants.
- **LOCALE** — translation-completeness assertions.

## Link Model, Expiry & Migration (S1)

**AC-STRUCT-1** — The exported `DAY_MS` constant MUST equal `86_400_000`.

**AC-MODEL-1** — `isExpired(link, now)` MUST return `true` when `now >= (link.expiresAt ?? link.createdAt + DAY_MS)` and `false` otherwise, for both a record carrying `expiresAt` and a legacy record missing it (only `createdAt` set).

**AC-MODEL-2** — Persisting a link at creation (the `GenerateInviteLinkModal` copy/close path) MUST write a record whose `expiresAt` equals `createdAt + DAY_MS`, `usageCount` equals `0`, and `expiryNotified` and `expiryAcknowledged` both equal `false`.

**AC-MODEL-3** — `incrementInviteLinkUsage(nonce)` MUST increase the resolved record's `usageCount` by exactly `1` and persist the result, when `nonce` resolves to a stored record.

**AC-MODEL-4** — `incrementInviteLinkUsage(nonce)` MUST resolve without throwing and MUST NOT create a new record, when `nonce` does not resolve to any stored record.

**AC-MODEL-5** — `markInviteLinkExpiryNotified(nonce)` MUST set the resolved record's `expiryNotified` to `true` and persist it, leaving `expiryAcknowledged`, `usageCount`, and `expiresAt` unchanged.

**AC-MODEL-6** — `markInviteLinkExpiryAcknowledged(nonce)` MUST set the resolved record's `expiryAcknowledged` to `true` and persist it, leaving `expiryNotified`, `usageCount`, and `expiresAt` unchanged.

**AC-MIGRATE-1** — `migrateInviteLinks(now)` MUST set `expiresAt = createdAt + DAY_MS` on every stored record missing an `expiresAt` field, and MUST leave `expiresAt` unchanged on a record that already carries one (and is not `muted`, see AC-MIGRATE-5).

**AC-MIGRATE-2** — `migrateInviteLinks(now)` MUST default `usageCount` to `0` and `expiryNotified`/`expiryAcknowledged` to `false` on every record where those fields are missing, and MUST NOT overwrite an already-present value of any of them.

**AC-MIGRATE-3** — `migrateInviteLinks(now)` MUST set `expiryNotified = true` on every non-`muted` record whose post-backfill `expiresAt` is at or before the `now` argument.

**AC-MIGRATE-4** — `migrateInviteLinks(now)` MUST leave `expiryNotified` at `false` on every non-`muted` record whose post-backfill `expiresAt` is after the `now` argument.

**AC-MIGRATE-5** — `migrateInviteLinks(now)` MUST set `expiryNotified = true` and clamp `expiresAt = min(effectiveExpiry, now)` on every record carrying `muted: true`, regardless of whether that record's un-clamped `effectiveExpiry` is still in the future.

**AC-MIGRATE-6** — Invoking `migrateInviteLinks(now)` a second time against a store it already migrated MUST NOT change any field of any record: the record set serialized before and after the second call MUST be deep-equal.

## Expiry & Usage Enforcement in the Join Flow (S2)

**AC-ENFORCE-1** — `handleJoinRequest` MUST return `null` (drop the request, persist nothing) when the resolved link's `isExpired(inviteLink, now)` is `true` — exactly as it does today for `inviteLink.muted === true`.

**AC-ENFORCE-2** — `handleJoinRequest` MUST persist a `PendingJoinRequest` for a request referencing a link whose `isExpired(inviteLink, now)` is `false` and `muted` is `false`, all other existing discard conditions being unmet.

**AC-USAGE-1** — `approveJoinRequest` MUST call `incrementInviteLinkUsage(request.nonce)` only after its `inviteByNpub(...)` call resolves `{ok: true}`; it MUST NOT call `incrementInviteLinkUsage` when `inviteByNpub` resolves `{ok: false, error}`.

**AC-USAGE-2** — `approveJoinRequest` MUST resolve `{ok: true}` and complete approval (delete the pending request, decrement the join-request badge) even when the referenced `InviteLink` no longer resolves (deleted or expired) — approval MUST NOT be gated on `getInviteLink` or `isExpired`.

**AC-USAGE-3** — For a pending request whose referenced link has been deleted, `approveJoinRequest` MUST NOT throw, and the eventual no-op inside `incrementInviteLinkUsage` (AC-MODEL-4) MUST be the only visible effect of the link's absence.

## Manage Overlay Redesign (S3)

**AC-UI-1** — Each row rendered by `ManageInviteLinksModal` MUST display the link's creation time and expiry time with time-of-day precision or an equivalent relative form (e.g. "expires in 3 h" / "expired 2 h ago") — not a bare calendar date — with both `en` and `de` copy present for whichever form is chosen.

**AC-UI-2** — Each row MUST display a usage-count string whose rendered `en` text contains "joined via this link" (and whose `de` counterpart is the natural translation), populated from `link.usageCount`.

**AC-UI-3** — A row whose `isExpired(link, now)` is `true` MUST render with a distinct "expired" treatment (a dedicated style/class and an "Expired" text marker) that a row with `isExpired(link, now) === false` does not receive.

**AC-UI-4** — `ManageInviteLinksModal`'s rendered output MUST NOT contain a `Switch` element (the former mute toggle); each row MUST instead render a trashcan icon-button.

**AC-UI-5** — Clicking a row's trashcan icon-button MUST first render a confirmation prompt ("Remove this link?" or the translated equivalent) and MUST NOT call `deleteInviteLink` before that confirmation is accepted.

**AC-UI-6** — Accepting the trashcan confirmation MUST call `deleteInviteLink(nonce)` and remove that row from the modal's rendered list without requiring the modal to be closed and reopened.

**AC-UI-7** — When `loadInviteLinks(groupId)` resolves to an empty array, the modal body MUST render a non-blank, translated empty-state string.

**AC-UI-8** — While the modal is open, a rendered row whose link crosses its expiry boundary MUST transition to the AC-UI-3 expired treatment without the modal being closed and reopened (driven by the sweep tick or an equivalent periodic re-render).

## Expiry Notification & Deep-Link (S4)

**AC-NOTIFY-1** — `initInviteExpiries` MUST compute, per `groupId`, a count equal to the number of that group's stored links satisfying `isExpired(link, now) && link.expiryNotified === true && link.expiryAcknowledged === false`.

**AC-NOTIFY-2** — The sweep MUST call `markInviteLinkExpiryNotified(nonce)` and increment the `inviteExpiries` slice for a link's `groupId` when that link is expired and `expiryNotified === false`, and MUST NOT act on a link whose `expiryNotified` is already `true`.

**AC-NOTIFY-3** — `NotificationBell` MUST render one row per `groupId` with a non-zero `inviteExpiries` count, each row linking to `/groups?id=<groupId>&manageLinks=1`.

**AC-NOTIFY-4** — Activating an invite-expiry bell row MUST call the `inviteExpiries` mark-read function for that `groupId`, after which that `groupId`'s `inviteExpiries` count MUST read `0`.

**AC-DEEPLINK-1** — On `/groups?id=<id>&manageLinks=1`, the manage-links overlay's open call MUST fire only after the detail view for the group identified by `id` has rendered — not on initial page mount before the group resolves.

**AC-DEEPLINK-2** — After the overlay opens via the `manageLinks=1` deep-link, the `manageLinks` query parameter MUST be stripped from the URL (`router.replace`), so reloading the resulting URL does not re-open the overlay.

**AC-DEEPLINK-3** — When `/groups?id=<id>&manageLinks=1` targets a `groupId` absent from the admin's current group list, the page MUST render the groups list (not the detail view) and MUST call the `inviteExpiries` clear function for that `groupId`.

**AC-DEEPLINK-4** — Wherever the code path that clears a group's invite links on leave/abandon runs, it MUST also clear that group's `inviteExpiries` slice, in the same call.

## Cross-Cutting Invariants

**AC-INV-1** — For any interleaving of sweep invocations against a link that is expired and not yet `expiryNotified` — generator: the space of {number of concurrent/rapid sweep calls (2–5), call ordering, whether a StrictMode double-invoke or an overlapping 60-second interval tick triggers the second call} — the sweep MUST notify that link (bump `inviteExpiries` and call `markInviteLinkExpiryNotified`) exactly once across the whole interleaving; any run where the count is `0` or `>1` fails the property.
Spans modules: notifications, inviteLinkStorage.

**AC-INV-2** — For any sequence where the sweep notifies link `L` and then the app reloads before `L`'s notification is acknowledged — generator: the space of {reload happening immediately after the sweep's IDB write vs. after a delay; zero or more additional non-`L` links present} — `initInviteExpiries` MUST derive `L`'s contribution to the unread count solely from `L`'s persisted `expired && expiryNotified && !expiryAcknowledged` flags, producing the identical count pre- and post-reload; a run where post-reload state diverges from the persisted-flag computation fails the property.
Spans modules: notifications, inviteLinkStorage.

**AC-INV-3** — For any invite-link record set migrated by `migrateInviteLinks(now)` — generator: the space of link mixes {already-expired non-muted, not-yet-expired non-muted, muted-regardless-of-computed-expiry} in arbitrary combination and order — the resulting `expiryNotified` value MUST be `true` for exactly the already-expired-at-`now` and `muted` records and `false` for every other record; no non-suppressed expired record may be left `expiryNotified: false` (silently skipped) and no not-yet-expired, non-muted record may be stamped `true`.
Spans modules: inviteLinkStorage, notifications.

**AC-INV-4** — For any single link's sweep-then-notify sequence interrupted at an arbitrary point — generator: the space of interruption points between "compute expired" and "bump the in-memory `inviteExpiries` counter" — a subsequent `initInviteExpiries` computation MUST never read as "shown" (contributed to the count) for a link whose `expiryNotified` was not yet persisted at the interruption point; the persisted stamp MUST be written no later than the in-memory bump for every observed interruption point, so recovery after interruption yields "stamped-not-yet-shown" (recoverable next init) rather than "shown twice" or "shown-but-not-stamped".
Spans modules: notifications, inviteLinkStorage.

**AC-INV-5** — For any two concurrent `approveJoinRequest` calls that both reference the same link's `nonce` and both resolve `inviteByNpub` with `{ok: true}` — generator: the space of interleavings of their respective load→modify→save cycles on `usageCount` — the link's final `usageCount` MUST reflect both increments (increase by exactly `2` relative to its pre-call value); no interleaving may result in a lost update.
Spans modules: joinFlow, inviteLinkStorage.

**AC-INV-6** — For any number of sequential or concurrent invocations of `migrateInviteLinks(now)` against the same store, optionally racing a concurrent `loadInviteLinks`, sweep run, or modal-open read — generator: the space of {invocation count (1–4), interleaving with a concurrent reader} — the resulting persisted record set MUST be identical to the record set produced by exactly one `migrateInviteLinks(now)` call; no invocation after the first may change any field, and no concurrent reader may observe a partially-migrated record with some but not all of `expiresAt`/`usageCount`/`expiryNotified`/`expiryAcknowledged` backfilled.
Spans modules: inviteLinkStorage.

**AC-LOCALE-1** — Every new `Copy` key introduced by this epic (expiry/relative-time strings, usage-count copy, expired marker, empty-state string, trashcan confirmation, bell row copy) MUST have both a non-empty `en` value and a non-empty `de` value in `i18n.ts`; a key present in one language object and absent (or `undefined`) in the other fails this AC.

## Manual Validation

| MV id | Behavioral intent | Owner | Blocked on |
|-------|-------------------|-------|------------|
| MV-1  | The `de` relative-expiry phrasing ("läuft in 3 Std. ab" / "vor 2 Std. abgelaufen" or equivalent) reads as natural German to a native speaker, not a mechanical word-for-word translation | admin | AC-UI-1 |
| MV-2  | The expired-row visual treatment (AC-UI-3) is legible and clearly distinct from a live row under the app's light and dark themes | admin | AC-UI-3 |
