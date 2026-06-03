# DM Walled Garden — Restrict Direct Messages to Common-Group Members

> **Severity context.** Production is paused. The live site has been replaced
> with a single-file maintenance page (`maintenance/index.html`, served via
> `make maintenance`). Recovery path is roll-forward — the next `make deploy`
> after this epic ships restores the live app. The maintenance window is the
> deadline for this epic.

## Problem

Today, arbitrary Nostr pubkeys — pubkeys with whom the local user shares **no
MLS group** — can deliver direct messages to a Quizzl client and have them:

1. **Stored** in IndexedDB under `quizzl:messages:dm:<stranger-pubkey>`.
2. **Counted** on the notification bell as unread DMs.
3. **Promoted to the contact list** via `rememberContact()` so the stranger
   becomes a tappable conversation in the Contacts view from then on,
   surviving app restart.

This violates the walled-garden invariant of the product: a Quizzl user must
only be reachable by people they share a learning group with. Reachability
is defined by **common MLS group membership**, established via the in-app
group invitation flow. Anything else is unsolicited contact and must be
discarded before it touches storage, the bell, or the contact list.

The bug exists on both inbound paths: NIP-04 kind-4 plaintext DMs and
NIP-17 kind-1059 → kind-14 gift-wrapped DMs. It exists at both the global
bell watcher (`subscribeDirectMessageNotifications`) and the per-thread
ContactChat subscription. Source files and the leakage mechanism are
documented under `## Technical Approach` below.

Originating bug report:
[`bug-reports/dm-walled-garden-stranger-bypass.md`](../../bug-reports/dm-walled-garden-stranger-bypass.md).
This spec supersedes that report; the report itself stays in tree as
historical context (decided by spec-validator if it disagrees).

## Solution

Enforce the walled garden at every ingress and every persistence boundary:

- **Whitelist source of truth.** A single helper `isAllowedDmSender(peerHex)`
  computes the set of permitted correspondents from currently joined MLS
  groups. Every other module consults this helper rather than reasoning
  about group membership itself.
- **Ingress filtering.** Every inbound DM event — kind-4, kind-1059 → kind-14
  chat, and kind-1059 → kind-7 reaction — is checked against the helper
  *before* any side effect (IDB append, bell increment, contact remember,
  unread bump). Failing pubkeys are dropped silently.
- **Central `rememberContact` gate.** `rememberContact()` itself refuses any
  pubkey outside the whitelist. Defense in depth — even if a future caller
  forgets the ingress gate, the contact list cannot leak.
- **Retroactive purge.** On boot, after MLS group state hydrates, the client
  enumerates persisted DM threads (`quizzl:messages:dm:*` in idb-keyval),
  unread counters, reaction aggregates, and contact-list entries. Any state
  attributable to a pubkey outside the current whitelist is deleted. The
  purge re-runs on every group-membership change (join, leave, kick).
- **Reactivity.** The whitelist is computed from live group state, not a
  cached snapshot. Joining a group instantly extends reach; leaving (or
  being kicked from) a group instantly revokes it, and in-flight or
  relay-redelivered events from the now-former member are dropped.
- **No new relay traffic.** The fix is local-only filtering. Relays remain
  untrusted; the client is the enforcement boundary.

## Scope

### In Scope

- Whitelist helper module (single source of truth).
- Ingress gates on both inbound paths (kind-4 + kind-1059 wraps) at both
  watchers (global bell + per-thread ContactChat).
- Reaction-rumor gate (kind-7 inside DM threads).
- Central gate inside `rememberContact()`.
- Retroactive purge on boot (after group hydration) and on every
  group-membership-change event.
- Purge surface: IDB DM threads, unread counters, reaction aggregates, and
  contact-list entries.
- Reactivity to group join / leave / kick.
- Test surface as decided by `## Design Decisions ### DD-7` below (the
  Test-Case Debate).
- Inversion or removal of `app/tests/e2e/dm-third-party-inbound.spec.ts` —
  its current assertions encode the bug as expected behaviour.

### Out of Scope

- Replacing NIP-04 with NIP-17 in the codebase (both inbound paths continue
  to coexist; both must be filtered).
- Changing the contact list UI semantics (archived/visible).
- Changing how groups admit members.
- Sender reputation / per-relay trust.
- Restoring the live deploy. That is the operational follow-on (`make
  deploy` after the epic ships).
- Re-architecting MarmotContext or the dual-listener pattern (separately
  tracked at `specs/marmot-application-rumor-dispatch.md`).

## Constrained by ADRs

- **ADR-001** — Gate DM reachability exclusively on live MLS group membership.

## Design Decisions

The bug report left four open questions. Each is encoded here as a
Design Decision with the recommendation pre-stated and the alternatives
preserved so spec validation surfaces them to the user before stories
are planned.

1. **DD-1 — Whitelist source.** The whitelist is the union of
   `group.memberPubkeys` across the user's currently joined MLS groups,
   minus the user's own pubkey. Refs:
   `app/src/lib/contacts.ts:83` (`rememberContactsFromGroups` already
   computes exactly this set; promote it to the canonical definition),
   `app/src/types/index.ts:170` (`Group.memberPubkeys`).
   **Recommendation: accept.** This is the existing notion of "people I
   share a group with" and matches the product's walled-garden definition.

2. **DD-2 — Pending join requests.** A pubkey that has *requested* to join
   one of the user's groups but is not yet a member is **NOT** in the
   whitelist. They become reachable only after the MLS Welcome has been
   processed and they appear in `group.memberPubkeys`.
   **Recommendation: accept.** Pre-admission contact is the exact attack
   surface the walled garden exists to close. <!-- DECIDED: confirmed at spec validation -->

3. **DD-3 — Removed-but-not-synced members.** When the user is removed
   from a group (or removes another member) but the local client has not
   yet processed the resulting MLS commit, the about-to-be-former member
   may briefly remain in the whitelist. As soon as the local
   `group.memberPubkeys` updates, any in-flight event from them is
   dropped. We do not pre-emptively block on a Remove proposal that has
   not yet been committed locally.
   **Recommendation: accept.** Avoids a divergence between the local
   "who can reach me" view and the local "who do I think is a member"
   view. <!-- DECIDED: confirmed at spec validation -->

4. **DD-4 — Historical DM threads with now-former group members.** When a
   peer leaves the whitelist (group leave, kick), their existing DM
   thread is **deleted by the retroactive purge** on the next sweep.
   History is not preserved — same treatment as a stranger who never
   shared a group.
   **Recommendation: accept (strict).** The product invariant is "no
   contact outside the walled garden." Historical contact with someone
   who is no longer in the garden is the same outcome and should be
   handled the same way. The alternative ("keep history, block new")
   is rejected because it creates a UX class of "ghost contacts" whose
   provenance and trust state is ambiguous. <!-- DECIDED: confirmed at spec validation -->

5. **DD-5 — Purge mode (strict).** When the purge identifies a thread
   attributable to a non-whitelisted peer, it deletes:
   - The IDB key `quizzl:messages:dm:<peerHex>` (entire thread).
   - The unread-counter entry for that peer in `unreadStore`.
   - Any reaction-aggregate state keyed off that thread.
   - The contact-list entry for that peer in `localStorage[STORAGE_KEYS.contacts]`.
   - The contact-cache entry for that peer in
     `localStorage[STORAGE_KEYS.contactCache]` (nickname, avatar) if any.

   The originating bug report wording ("must be filtered immediately
   when fetched, and must not even be stored", "already fetched messages
   must be removed") is strict-purge and is preserved here verbatim as
   the spec's intent.
   **Recommendation: accept.** The lenient alternative ("keep
   already-persisted messages read-only; only block new") was rejected
   because it leaves the original leak visible to users and contradicts
   the bug report wording. <!-- DECIDED: confirmed at spec validation -->

6. **DD-6 — Central whitelist gate inside `rememberContact()`.**
   `rememberContact(pubkeyHex)` itself enforces the whitelist — it
   returns early without writing when the pubkey is not in
   `isAllowedDmSender(peerHex)`. The call sites still get the ingress
   gate (the watcher path stops earlier and saves work), but the
   function-level gate is the durable invariant.
   **Recommendation: accept.** Single chokepoint — future regressions
   in any caller cannot reintroduce the leak. Refs:
   `app/src/lib/contacts.ts:65`.

7. **DD-7 — Test-Case Debate.** Q3 of the
   originating bug report. The spec must commit to a test surface
   before stories are planned, because the surface drives the story
   split. The four candidate options, with trade-offs preserved:

   - **Option A — Full set (recommended in the bug report).** Three new
     unit tests (whitelist helper, watcher filter, retroactive purge) +
     three new e2e specs (stranger-blocked, group-member-allowed,
     retroactive-purge), and the existing
     `app/tests/e2e/dm-third-party-inbound.spec.ts` is inverted (or
     deleted) — its current assertions encode the bug. This option
     gives the broadest regression net and the strongest sign-off
     evidence. It also produces the heaviest e2e wall-clock and
     requires the most fixture engineering.
   - **Option B — Unit floor first.** Ship only the unit tests as
     reproduction now; defer the e2e specs to a follow-up. Faster
     red-bar, lighter ceremony. Weakness: the bell + IDB + contacts
     pipeline only gets covered end-to-end after the fix lands. The
     existing `dm-third-party-inbound.spec.ts` would still need to be
     inverted in this epic (otherwise the e2e gate at Step 5.8 fails).
   - **Option C — E2E only.** Trust the existing unit harness. Three
     new e2e specs + invert the bug-as-feature spec. Closest to the
     user-visible bug. Slowest signal; no fast unit-test feedback
     during fix iteration.
   - **Option D — Minimal floor.** One unit test for the whitelist
     helper + one e2e for stranger-blocked. Retroactive purge and
     member-allowed floor are covered implicitly by the fix. Smallest
     scope, weakest evidence.

   **Recommendation: Option A (Full set).** The walled garden is a
   product-defining invariant and the cost of a regression here is the
   same maintenance-page state we are in right now. The wall-clock
   cost is worth the regression net. <!-- DECIDED: Option A (Full set) selected at spec validation -->

8. **DD-8 — E2E stranger publisher.**
   Q4 of the originating bug report. When DD-7 selects A, B, or C, the
   e2e suite needs a "stranger" peer to publish DMs that the local
   client receives. Two options:

   - **Option α — Second app context, no shared group (recommended).**
     A second `browser.newContext()` is signed in as a Quizzl identity
     with no group in common with Alice. That context publishes via
     the app's own DM publish helpers
     (`publishDirectMessage` / gift-wrap send). Honours the
     publish-via-app rule (`CLAUDE.md` and memory note
     `feedback_e2e_no_direct_relay`). Weakness: needs two contexts and
     fixture wiring for Mallory's identity.
   - **Option β — Narrow exception (raw kind-1059 fixture).** Treat
     this as one of `CLAUDE.md`'s documented narrow exceptions and
     hand-craft a kind-1059 gift wrap that is published to the relay
     directly. Faster, single-context. Weakness: trades off the
     publish-via-app rule and the fixture becomes brittle if NIP-59
     formatting evolves.

   **Recommendation: Option α.** The publish-via-app rule was codified
   specifically because raw-WebSocket tests pass even when the app's
   signer, NDK config, or retry/dedupe is broken — exactly the kind of
   silent regression this walled-garden epic is trying to prevent.
   <!-- DECIDED: Option α (second app context) selected at spec validation -->

9. **DD-9 — Reaction-rumor coverage.** Kind-7 (NIP-25) reaction rumors
   addressed at messages inside a DM thread are gated by the same
   whitelist. A non-member cannot react to a known message.
   **Recommendation: accept.** Closes the side-channel where a stranger
   cannot DM but could still surface in the UI via a reaction
   notification. Refs: `app/src/components/contacts/ContactChat.tsx:318`
   (kind-7 dispatch), `app/src/lib/reactions/api.ts`,
   `app/src/lib/reactions/rumor.ts`.

10. **DD-10 — Self-DMs are out of band.** A pubkey equal to the user's
    own is dropped on every ingress path before any other check (matches
    existing behaviour at
    `app/src/lib/directMessageNotifications.ts:74,109`). The walled
    garden does not change that. **Recommendation: accept.**

## Technical Approach

### `app/src/lib/walledGarden.ts` (new)

A small module that owns the whitelist computation. Single export:

```ts
export function isAllowedDmSender(
  peerHex: string,
  groups: ReadonlyArray<Group>,
  ownPubkeyHex: string | null | undefined,
): boolean
```

Semantics (DD-1, DD-2, DD-3, DD-10):

- `peerHex === ownPubkeyHex` → `false` (defensive).
- `peerHex` appears in any `group.memberPubkeys` where the group is
  currently joined → `true`.
- Otherwise → `false`.

This module has zero IDB, zero NDK, zero React dependencies — purely
a function over the current group snapshot, so it is trivially unit-
testable and reusable from the watcher, ContactChat, the purge sweep,
and `rememberContact`.

### `app/src/lib/contacts.ts:65` (`rememberContact`)

Per DD-6, the central gate. `rememberContact(peerHex)` becomes a no-op
when `isAllowedDmSender(peerHex, currentGroups, ownPubkey)` is `false`.
The function needs access to the current group snapshot and own pubkey;
the cleanest path is for callers to pass a `getWhitelist()` accessor in
(parameterised) or for the module to expose a context-bound version
(`rememberContact` consumed via a hook in React paths and via an
injected accessor in non-React paths). Choice between these is left to
the architect agent; the AC is on the behaviour, not the wiring.

### `app/src/lib/directMessageNotifications.ts:52` (global bell watcher)

Both handlers (`kind4Handler` and `kind1059Handler`) must call
`isAllowedDmSender` before:

- `rememberContact(peer)` (line ~79 and ~117).
- `incrementDirectMessage(peer)` (line ~80 and ~118).
- Adding to `seenMessageIds` / `seenRumorIds` (so a redelivery from a
  member later won't be falsely deduped).

The comment at `directMessageNotifications.ts:106` that says "Bell
watcher accepts DMs from any sender" gets deleted — it documents the
bug.

### `app/src/components/contacts/ContactChat.tsx`

Four handlers need the gate before any `appendMessage()` call:

- `handleHistoricalGiftWrapEvent` (historical kind-1059 batch).
- `handleHistoricalKind4Event` (historical kind-4 batch — added during
  the pre-commit review; AC-SEC-8 caught the missing fourth path).
- `handleKind4Event` (live kind-4).
- `handleGiftWrapEvent` (live kind-1059) — and the kind-7 dispatch
  branch (DD-9).

`shouldIngestRumor()` at `directMessages.ts:204` stays — it is the
thread-isolation barrier and still does its (different) job. The
walled-garden gate runs before it.

### `app/src/lib/marmot/chatPersistence.ts`

A new exported helper `purgeStrangerDmThreads(getWhitelist)`:

- `keys()` from `idb-keyval` (already imported).
- Filter keys matching `quizzl:messages:dm:<peerHex>`.
- For each: if `isAllowedDmSender(peerHex, …)` is `false`, `del(key)`.

Storage-key pattern reference: `chatPersistence.ts:31`
(`storageKey(groupId)` → `quizzl:messages:${groupId}`).

### `app/src/lib/unreadStore.ts`

Companion helper `purgeStrangerDmCounters(getWhitelist)` that removes
unread entries for non-member peers. Exact shape depends on the store's
current API; architect to inspect.

### `app/src/lib/reactions/api.ts` and friends

Per DD-9, both the inbound dispatcher (`applyInboundRumor` for `kind:
'dm'`) and any local persistence helpers must gate on
`isAllowedDmSender`. The reaction aggregates in storage attributable to
non-member peers are dropped in the same purge sweep as the thread.

### `app/src/context/MarmotContext.tsx`

Wires it together:

- After group hydration on boot, invoke the purge sweep (chat + unread
  + reactions + contact entries).
- On every group-membership change (`onMembersChanged`,
  `subscribeNewGroups` welcome handler, leave / kick callbacks), re-run
  the purge sweep. Whitelist changes are events that drive purges.

### `app/src/lib/contacts.ts` — contact-list / contact-cache purge

A helper `purgeStrangerContacts(getWhitelist)` that walks both
`STORAGE_KEYS.contacts` and `STORAGE_KEYS.contactCache` (lines 26, 45)
and removes entries whose pubkey is not in the whitelist. Same trigger
points as the IDB purge.

### `app/tests/e2e/dm-third-party-inbound.spec.ts` (inverted or removed)

Today asserts:
- Alice's bell badge becomes 1 after Bob (no shared group) DMs her.
- The DM thread renders.

Both assertions encode the bug. The S-tests story (see DD-7) either
inverts them to "must not bell, must not render, must not persist" or
removes the spec entirely depending on the Decider's choice. Either way,
the file as it exists today does not survive this epic.

## Stories

A four-story split that matches the recommended scope. The planner
(`base:story-planner` Modes 1-3) may refine but should not collapse
below this count without surfacing the trade-off.

- **S1 — Whitelist module + central `rememberContact` gate.** New
  `walledGarden.ts` module per `## Technical Approach`. `rememberContact`
  refuses non-member pubkeys (DD-6). Covers AC-SEC-1, AC-SEC-2,
  AC-STRUCT-1, AC-STRUCT-2.

- **S2 — Ingress gates on inbound DM paths.** Bell watcher
  (`directMessageNotifications.ts`) kind-4 + kind-1059 handlers + 
  ContactChat (`ContactChat.tsx`) historical-1059, kind-4 in/out, live
  kind-1059, and kind-7 reaction dispatch. No `rememberContact`, no
  `incrementDirectMessage`, no `appendMessage`, no reaction storage for
  non-member peers. Covers AC-SEC-3 … AC-SEC-7, AC-OBS-1.

- **S3 — Retroactive purge.** `purgeStrangerDmThreads`,
  `purgeStrangerDmCounters`, `purgeStrangerContacts`, and the
  reaction-state purge. Wired into MarmotContext: runs once after group
  hydration on boot, and on every group-membership change. Covers
  AC-PURGE-1 … AC-PURGE-6, AC-REACT-1.

- **S4 — Test surface (per DD-7).** Resolved at spec validation;
  story scope is whatever DD-7 selects (A: full set; B: unit floor;
  C: e2e only; D: minimal). The existing `dm-third-party-inbound.spec.ts`
  inversion or removal is in scope regardless of DD-7 choice — its
  current assertions encode the bug and the e2e gate (Step 5.8) will
  fail otherwise. Covers AC-TEST-1 … AC-TEST-N (N depends on DD-7).

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## Relationship to Other Epics

- `specs/marmot-application-rumor-dispatch.md` — describes the
  dual-listener consolidation between MarmotContext and ChatStoreContext.
  That epic is independent but touches the same MarmotContext hydration
  surface; the purge wiring landed here must remain correct after that
  consolidation. The architect should read its current state and call
  out any collision in `architecture.md`.

- `specs/epic-member-profile-discovery-and-relay-on-behalf/` — also
  consults `group.memberPubkeys`. The whitelist helper introduced here
  should be the only authoritative reader of that field for "who can
  reach me" decisions; profile discovery is unaffected.

## Non-Goals

- Inferring the whitelist from any source other than current MLS group
  membership (no NIP-02 follow lists, no reputation, no manual
  allowlist UI).
- Surfacing "you have a pending DM from someone outside your groups"
  as a UI affordance. The DM is dropped silently; there is no
  notification of suppression.
- Preserving stranger DMs in a quarantine area for later review.
- Migrating the DM transport from NIP-04/NIP-17 to anything else.
- Restoring the production deploy (operational follow-on, see Problem).

## Amendments

- **2026-06-03 — AC-SEC-6 extended to four handlers.** Pre-commit review
  (substep 3.45) discovered that the historical kind-4 fetch in
  `ContactChat.tsx` was an unenumerated fourth inbound DM path
  (`fetchEventsWithTimeout` → `ingestEvent` → `appendMessage`). AC-SEC-8
  caught the gap. A `handleHistoricalKind4Event` helper was added that
  mirrors the kind-1059 historical pattern, and `## Technical Approach`
  was updated to list four handlers instead of three. See
  `acceptance-criteria.md ## Amendments` for the AC patch.

- **2026-06-03 — AC-TEST-6 implementation constraint documented.** The
  `dm-walled-garden-retroactive-purge.spec.ts` test cannot assert "Bob
  thread intact" without a full MLS group-lifecycle setup during the test
  (create + invite + Welcome join adds 90+ seconds of relay round-trip).
  Without a joined group, all DM peers including Bob are strangers from
  Alice's perspective. The test was adapted to assert the simpler
  invariant: all pre-seeded threads purged when Alice has no groups. The
  member-vs-stranger split in purge context is covered by AC-TEST-5
  (`dm-walled-garden-group-member-allowed.spec.ts`). See
  `acceptance-criteria.md ## Amendments` for the full AC-TEST-6 note
  (post-ship implementation note added by project-curator, 2026-06-03).
