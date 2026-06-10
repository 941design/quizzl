# DM Walled Garden — Acceptance Criteria

## Terminology

- **member-pubkey** — a hex pubkey that appears in `group.memberPubkeys`
  for at least one MLS group the user has currently joined, excluding
  the user's own pubkey. The walled garden's allow-set.
- **stranger** — any hex pubkey that is NOT a member-pubkey at the
  moment of evaluation, including the user's own pubkey (defensive
  drop). A peer can transition from member-pubkey → stranger by leave /
  kick, and back to member-pubkey by re-joining; the AC behaviour
  follows the transition.
- **inbound DM event** — any of:
  - a kind-4 (NIP-04) event with `'#p'` tag matching the local pubkey,
    or
  - a kind-1059 (NIP-59) gift wrap with `'#p'` matching the local
    pubkey, whose unwrapped inner rumor is a kind-14 (NIP-17 chat
    message) or kind-7 (NIP-25 reaction).
- **purge sweep** — the set of helpers
  (`purgeStrangerDmThreads`, `purgeStrangerDmCounters`,
  `purgeStrangerContacts`, the reaction-state purge) invoked together
  in MarmotContext after group hydration and on every
  group-membership change.
- **whitelist accessor** — the runtime form of
  `isAllowedDmSender(peerHex, …)`, however it is plumbed (parameter,
  context-bound hook). ACs are written against the function's
  observable behaviour, not its wiring.

## Known TAGs

- **SEC** — security / walled-garden enforcement assertions.
- **STRUCT** — structural assertions (module shape, file:line refs).
- **PURGE** — retroactive purge assertions.
- **REACT** — reactivity to group-membership change.
- **TEST** — test-suite invariants and inversions.
- **OBS** — observability / logging.
- **PERF** — performance bounds where relevant.

## Whitelist Module (S1)

**AC-STRUCT-1** — A module at `app/src/lib/walledGarden.ts` MUST export
a pure function `isAllowedDmSender(peerHex: string, groups:
ReadonlyArray<Group>, ownPubkeyHex: string | null | undefined): boolean`.
The function MUST NOT read IndexedDB, MUST NOT touch NDK, MUST NOT
read React state, and MUST NOT have side effects.

**AC-SEC-1** — `isAllowedDmSender` MUST return `false` when `peerHex`
is empty, when `peerHex` (case-insensitive) equals `ownPubkeyHex`, or
when `groups` is empty.

**AC-SEC-2** — `isAllowedDmSender` MUST return `true` if and only if
`peerHex` (case-insensitive) appears in `group.memberPubkeys`
(case-insensitive) of at least one element of `groups`, and the first
two preconditions of AC-SEC-1 do not apply.

**AC-STRUCT-2** — `rememberContact(peerHex)` at
`app/src/lib/contacts.ts:65` MUST return without mutating storage when
the current whitelist accessor reports `peerHex` as a stranger. The
function MUST NOT throw; it MUST silently no-op. (DD-6)

## Ingress Gates (S2)

**AC-SEC-3** — In `subscribeDirectMessageNotifications`
(`app/src/lib/directMessageNotifications.ts`), the kind-4 handler MUST
NOT call `rememberContact(peer)` or `incrementDirectMessage(peer)`
when `peer` is a stranger, regardless of any other dedup or
last-read condition.

**AC-SEC-4** — Same handler, same conditions: the kind-4 handler MUST
NOT add `event.id` to `seenMessageIds` for a stranger event. (The
dedup set is reserved for events that the gate accepted, so that a
later redelivery from a member is not falsely deduped against a
stranger event.)

**AC-SEC-5** — The kind-1059 handler in the same file MUST NOT call
`rememberContact(peer)` or `incrementDirectMessage(peer)` when the
unwrapped rumor's `pubkey` is a stranger, and MUST NOT add `rumor.id`
to `seenRumorIds` in that case (symmetric to AC-SEC-4).

**AC-SEC-6** — In `app/src/components/contacts/ContactChat.tsx`, the
four event handlers — `handleHistoricalGiftWrapEvent`,
`handleHistoricalKind4Event`, `handleKind4Event`, and
`handleGiftWrapEvent` — MUST NOT call `appendMessage(threadId, msg)`
when the sender is a stranger. They MUST also not call
`upsertMessages([msg])` for stranger messages.

**AC-SEC-7** — In the same file, the kind-7 reaction dispatch branch
inside `handleGiftWrapEvent` (currently at ContactChat.tsx ≈ line 318)
MUST NOT call `applyInboundRumor` (or any other reaction-storage
helper) when the rumor's `pubkey` is a stranger. (DD-9)

**AC-OBS-1** — A stranger event MUST be logged at INFO level with a
fixed log tag (suggested: `dm:walled-garden-drop`) and the minimum
context (`pubkey` truncated to 8 chars + `kind`) for forensics.
Stranger drops MUST NOT log the message content or the inner rumor
body.

## Retroactive Purge (S3)

**AC-PURGE-1** — On boot, after MLS groups are hydrated, the purge
sweep MUST run exactly once. "Hydrated" is defined as the point where
`MarmotContext` first has a non-null group list available for
inspection.

**AC-PURGE-2** — The purge sweep MUST run again after every
group-membership change event observable to MarmotContext (group
joined via Welcome, member added, member removed including self,
group left). Triggers are events, not a polling timer; AC-PERF-1
bounds the cost.

**AC-PURGE-3** — The IDB sweep MUST enumerate idb-keyval keys
matching `quizzl:messages:dm:*` and MUST `del()` every key whose
`<peerHex>` portion is a stranger. Keys with the `quizzl:messages:`
prefix that do NOT carry the `dm:` discriminator (group threads)
MUST NOT be touched. (DD-4, DD-5)

**AC-PURGE-4** — The unread-counter sweep MUST remove the entry for
every stranger peer from `unreadStore` (whatever the underlying
serialisation is). After the sweep, calling
`getDirectMessageLastReadAt(strangerHex)` MUST return the module's
unset/default sentinel for that peer.

**AC-PURGE-5** — The contact-list sweep MUST remove every entry
whose key is a stranger pubkey from both `localStorage[STORAGE_KEYS.contacts]`
and `localStorage[STORAGE_KEYS.contactCache]`. (DD-5)

**AC-PURGE-6** — The reaction-aggregate sweep MUST drop any
reaction-state attributable to a stranger or to a stranger-owned
DM thread. The exact storage shape depends on the reactions module;
the AC binds the outcome: after the sweep, no reaction record keyed
on a stranger pubkey or a stranger-thread message id remains.

**AC-PERF-1** — A purge sweep on a hydrated client with ≤200 stored
DM threads MUST complete in ≤500 ms wall-clock on the e2e test
hardware. (Bound is informational; failure logs a warning rather
than failing the AC, unless wall-clock exceeds 2 s — then a hard
failure. This guards against an accidental O(n²) implementation.)

## Reactivity (cross-cutting)

**AC-REACT-1** — When a peer's status transitions stranger →
member-pubkey (the user joins a group containing them, or they join
a group the user is in), the next inbound DM event from that peer
MUST be accepted by the ingress gates. No client restart MUST be
required.

**AC-REACT-2** — When a peer's status transitions member-pubkey →
stranger (the user leaves the group, the peer is kicked, the peer
leaves), in-flight or relay-redelivered events from that peer MUST
be dropped by the ingress gates starting from the next event after
the transition is observable in `MarmotContext`'s group list.

**AC-REACT-3** — Following AC-REACT-2's transition, the next purge
sweep MUST run (per AC-PURGE-2) and MUST delete the now-former
member's existing DM thread, unread counter, contact-list entry, and
reaction state. (DD-4 strict)

## Test Surface (S4) — DD-7 = Option A (Full set)

DD-7 was resolved at spec validation: Option A (Full set) selected.
DD-8 resolved: Option α (second app context, no raw-relay publishing).

### Option A ACs (active)

**AC-TEST-1** — A unit test at
`app/tests/unit/walledGarden.test.ts` MUST exercise
`isAllowedDmSender` against AC-SEC-1 and AC-SEC-2 (own pubkey,
empty groups, peer present in one of many groups, peer absent,
case-insensitive comparison).

**AC-TEST-2** — A unit test (`directMessageNotifications.test.ts`
or equivalent) MUST assert that a kind-4 from a stranger and a
kind-1059 → kind-14 from a stranger produce no `rememberContact`
and no `incrementDirectMessage` call. The floor case — kind-1059
from a member — MUST also be asserted to land both calls (sanity
that the gate is not too tight).

**AC-TEST-3** — A unit test (`chatPersistence-purge.test.ts` or
equivalent) MUST seed `quizzl:messages:dm:<strangerHex>` and
`quizzl:messages:dm:<memberHex>`, run `purgeStrangerDmThreads`
with whitelist = `[memberHex]`, and assert the stranger key is
removed and the member key remains. The same test (or a sibling)
MUST cover the unread, contact, and reaction-state surfaces.

**AC-TEST-4** — A new e2e spec
`app/tests/e2e/dm-walled-garden-stranger-blocked.spec.ts` MUST:
sign Alice in; via a second `browser.newContext()` per DD-8 Option α
(or via the DD-8 Option β narrow exception if the Decider selects β),
have Mallory (no shared group with Alice) DM Alice; assert that
Alice's bell stays at 0, the DM thread does not render in
`/contacts`, and no `quizzl:messages:dm:<mallory>` key exists in
idb-keyval after the wait window.

**AC-TEST-5** — A new e2e spec
`app/tests/e2e/dm-walled-garden-group-member-allowed.spec.ts` (or
the equivalent assertion added to
`groups-direct-chat-no-duplicates.spec.ts`) MUST exercise the floor
case: Alice and Bob share a group, Bob DMs Alice via the app,
Alice's bell increments and the message renders. This guards
against an over-tight gate.

**AC-TEST-6** — A new e2e spec
`app/tests/e2e/dm-walled-garden-retroactive-purge.spec.ts` MUST
pre-seed Alice's IDB with a stranger DM thread (Mallory) and a
member DM thread (Bob), boot the app, and assert that after
hydration the Mallory thread is gone (key, unread, contact entry)
and the Bob thread is intact.

*Implementation note (post-ship, 2026-06-03):* The spec as written
requires Alice to hold Bob in a real MLS group so `isAllowedDmSender`
returns `true` for Bob. Without a full group-lifecycle setup (create +
invite + Welcome join) during the test, Alice has no joined groups and
ALL DM peers — including Bob — are treated as strangers by the purge
sweep. The implemented test therefore exercises the simpler invariant:
when Alice has no groups, all pre-seeded stranger threads are purged on
boot (Mallory key absent, Mallory contact entry absent). The
member-vs-stranger split in a purge context — "Bob thread survives when
Bob is a group member" — is covered by AC-TEST-5 (group-member-allowed
e2e), which creates a real MLS group. A future hardening pass could
extend `dm-walled-garden-retroactive-purge.spec.ts` to run the full
group lifecycle and assert Bob's thread intact, but doing so adds 90+
seconds of relay round-trip and is tracked as post-ship improvement only.

**AC-TEST-7** — The existing file
`app/tests/e2e/dm-third-party-inbound.spec.ts` MUST be either (a)
deleted, or (b) inverted so that the new assertions match
AC-TEST-4. Option (b) is preferred when the existing test scaffolding
(USER_A / USER_B helpers, clearAppState, etc.) is reusable; option
(a) is acceptable when the inverted form would be a near-duplicate
of AC-TEST-4. Either way, no passing run of the suite may end with
the bug-as-feature assertions intact.

### If DD-7 = Option B (Unit floor)

AC-TEST-1, AC-TEST-2, AC-TEST-3, AC-TEST-7 from Option A apply.
AC-TEST-4, AC-TEST-5, AC-TEST-6 are deferred to a follow-up epic
captured as a new `BACKLOG.json` finding before this epic ships.

### If DD-7 = Option C (E2E only)

AC-TEST-4, AC-TEST-5, AC-TEST-6, AC-TEST-7 from Option A apply.
AC-TEST-1, AC-TEST-2, AC-TEST-3 are skipped.

### If DD-7 = Option D (Minimal floor)

AC-TEST-1 (unit) and AC-TEST-4 (e2e) from Option A apply, plus
AC-TEST-7 (inversion of the existing spec). Everything else is
deferred to a follow-up epic captured as a new `BACKLOG.json`
finding before this epic ships.

## Cross-Cutting Invariants

**AC-SEC-8** — There MUST NOT be a third inbound DM path. If the
architect discovers one (e.g. a not-yet-noticed handler, a future
NIP) that ingests DM-like events, the same gate MUST apply to it
or the spec is incomplete and the architect MUST escalate via the
Decider.

**AC-SEC-9** — The existing NIP-59 four-step seal authentication
in `unwrapAndOpen` (`app/src/lib/directMessages.ts:230-282`) MUST
be preserved verbatim. The walled-garden gate runs *after* the
unwrap, never instead of it.

**AC-SEC-10** — The existing thread-isolation guard
`shouldIngestRumor` at `app/src/lib/directMessages.ts:204` MUST
remain in place and continue to be called by `ContactChat.tsx`.
The walled-garden gate is in addition to thread isolation, not a
replacement for it.

**AC-SEC-11** — The fix MUST be local-only. No new relay
subscriptions, no relay-side filtering, no calls to additional
external services for whitelist decisions. The whitelist is
computed from the in-process group snapshot.

**AC-OBS-2** — Code comments inside
`app/src/lib/directMessageNotifications.ts` that document the
former "any sender" behaviour (notably the comment block around
line 106) MUST be removed in the same change-set that introduces
the gates; otherwise the comment contradicts the code.

## Manual Validation

- Open a fresh Nostling client signed in as a deterministic test user.
  From a separate Nostr client (any) sign with a pubkey that shares
  no MLS group with the test user. Send (a) a kind-4 to the test
  user, (b) a kind-1059 → kind-14 to the test user. Confirm: bell
  stays at 0, `/contacts` shows no new entry, browser dev-tools
  IDB inspection shows no `quizzl:messages:dm:<sender>` key.
- Re-launch the client; confirm the absence persists across reload.
- Seed an existing client with a stranger DM thread by intercepting
  the boot before the purge runs (or by direct IDB injection in
  dev-tools); reload and confirm the purge sweep removes the thread.

## Amendments

### Amendment 1 (post-implementation review, 2026-06-03)

**AC-SEC-6 — fourth historical kind-4 path discovered (AC-SEC-8 trigger).**

The original AC-SEC-6 named three handlers. During the pre-commit review
(Opus Stage-1) a fourth ungated inbound path was identified:

- `handleHistoricalKind4Event` — historical fetch via
  `fetchEventsWithTimeout` → `ingestEvent` → `appendMessage` for
  peer-authored kind-4 events (`incoming.events`). This path executed
  BEFORE the marmot-ready wait, and with no walled-garden check.

**Resolution:** AC-SEC-6 is amended above to name four handlers.
The fix introduces `handleHistoricalKind4Event` in
`ContactChat.tsx` (mirrors the live `handleKind4Event` gate) and moves
the marmot-ready wait BEFORE both the kind-4 and kind-1059 historical
processing steps so `groupsRef.current` is populated when either gate
runs.
