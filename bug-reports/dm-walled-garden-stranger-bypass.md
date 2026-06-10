# Stranger DMs bypass the walled garden — Bug Report

> **Severity: Critical (production paused).** The live site has been replaced
> with a single-file maintenance page (see `maintenance/index.html` and the
> `make maintenance` target). All subpages and assets were wiped from the
> remote on 2026-06-02 at 14:59 UTC. Recovery path is roll-forward
> (`make deploy` once the fix is built); no rollback to the previous
> `index.html` is retained.

## Bug Description

Arbitrary Nostr users — pubkeys with whom the local user shares **no MLS
group** — can deliver direct messages to a Nostling client and have them:

1. **Stored** in IndexedDB under `quizzl:messages:dm:<stranger-pubkey>`.
2. **Counted** on the notification bell as unread DMs.
3. **Promoted to the contact list** via `rememberContact()` so the stranger
   becomes a tappable conversation in the Contacts view from then on, even
   if no further DM ever arrives.

This violates the walled-garden invariant of the product: a Nostling user must
only be reachable by people they share a learning group with. Reachability is
defined by **common MLS group membership**, established via the in-app group
invitation flow. Any other inbound DM — whether NIP-04 (kind 4) or NIP-17
gift-wrapped (kind 1059 → kind 14) — must be discarded before it touches
storage, the bell, or the contact list.

## Expected Behaviour

- **Whitelist source of truth.** The set of pubkeys allowed to DM the local
  user is the union of `memberPubkeys` across all the user's currently
  joined groups, minus the user's own pubkey. (See
  `app/src/lib/contacts.ts:83` — `rememberContactsFromGroups` already
  computes exactly this set; that function is the canonical definition.)
- **Inbound filter.** Every received kind-4 event and every successfully
  unwrapped kind-1059 → kind-14 rumor must be checked against the whitelist.
  Non-members are dropped silently *before*:
    - calling `appendMessage()` in IDB (`chatPersistence.ts:243`),
    - calling `rememberContact()` (`contacts.ts:65`),
    - calling `incrementDirectMessage()` (`unreadStore.ts`).
- **Retroactive purge.** On boot, after the group list is hydrated, the
  client must:
    - enumerate idb-keyval keys matching `quizzl:messages:dm:*`,
    - for each thread whose peer pubkey is not in the current whitelist,
      delete the entire thread and any related state (`unreadStore` entry,
      reaction aggregates keyed off that thread, contact-list entry
      created from a stranger DM — see “Contact-list provenance” below).
- **Contact list.** The contact list must only contain pubkeys derived
  from group membership. `rememberContact()` called from the DM watcher is
  the current leak path — the call site is wrong, but the function is also
  too permissive (it has no whitelist gate). Either the call site must be
  removed for stranger DMs, or `rememberContact()` must itself enforce
  the whitelist. We recommend the latter, so the invariant is centralized.
- **No re-ingestion.** The whitelist gate must run on every inbound
  event regardless of whether the rumor previously passed (e.g. user
  leaves a group → former group members lose DM reach immediately;
  in-flight or relay-redelivered events from them must be dropped).

## Actual Behaviour

The inbound DM paths have **no sender allowlist**. Two distinct watchers
exist, and both accept any sender:

### Path A — global notification watcher (`directMessageNotifications.ts`)

`subscribeDirectMessageNotifications()`
(`app/src/lib/directMessageNotifications.ts:52`) opens two `ndk.subscribe()`
filters:

- kind-4 with `'#p': [ownPubkeyHex]`
- kind-1059 with `'#p': [ownPubkeyHex]`

For each event the handler:

- skips self-sends and dedup-seen ids,
- calls `rememberContact(peer)` — peer is added to the contact list,
- calls `incrementDirectMessage(peer)` — bell badge bumps.

There is an explicit comment in the file acknowledging the design choice
that is now revealed to be the bug (`directMessageNotifications.ts:106`):

```ts
// Bell watcher accepts DMs from any sender (it has no peer to filter against).
// shouldIngestRumor is for thread-isolation in ContactChat, not here.
```

`shouldIngestRumor()` (`directMessages.ts:204`) is a *thread* isolation
helper — it checks that the inner rumor’s `pubkey` matches an *already known*
peer in a one-on-one ContactChat. It is not a walled-garden check; it is a
defense against forged-pubkey rumors inside the open thread.

### Path B — open thread (`ContactChat.tsx`)

When a contact chat is opened, `ContactChat.tsx` subscribes to:

- kind-4 incoming from `[peerPubkeyHex]` (`ContactChat.tsx:279`),
- kind-1059 to `'#p': [pubkeyHex]` (`ContactChat.tsx:295`).

Both handlers call `appendMessage(threadId, msg)` — committing the message
to IndexedDB under `quizzl:messages:dm:<peerPubkey>`. The only filter is
`shouldIngestRumor(rumor, peerPubkeyHex)`, which only constrains *which
thread* the message lands in. It does not check that `peerPubkeyHex` is
a permitted correspondent at all.

### Net effect

Any pubkey on the public Nostr network can:

- ring the bell of any Nostling user whose pubkey they know,
- inject persistent IDB state into that user’s app,
- appear in that user’s contact list as a tappable conversation that
  cannot be removed from the source (`rememberContact` writes,
  `archiveContact` only sets `archivedAt`, the stranger entry survives
  app restart).

## Reproduction (manual)

1. Run the app locally against the e2e strfry relay (`make e2e-up`).
2. Sign in as user *Alice* in browser context A.
3. From any external client (e.g. `nak event` against the same relay),
   publish a kind-4 NIP-04 DM **OR** a NIP-17 kind-1059 gift wrap from
   a freshly generated keypair *Mallory* addressed (`#p`) to Alice.
   Alice and Mallory have never shared a Nostling group.
4. Observe in Alice’s browser:
    - Notification bell increments to 1.
    - Mallory appears as a new entry in `/contacts`.
    - Opening Mallory’s thread shows the message bubble.
    - Reloading the page persists all of the above (IDB-backed).

Existing e2e `app/tests/e2e/dm-third-party-inbound.spec.ts` actually
asserts this faulty behaviour as expected — it should be inverted once the
fix lands (see “Reproduction tests” below).

## Impact

- **Severity:** Critical. Product-defining invariant violated.
- **Affected users:** every Nostling user with a discoverable pubkey on
  open relays (i.e. anyone who has ever published any event from this
  identity, which is all current users).
- **Affected workflows:** notification bell, contact list, DM chat, any
  feature that derives state from “people I’ve talked to”.
- **Privacy:** strangers can confirm that a pubkey runs the Nostling client
  by observing whether bell behaviour changes (out-of-band), and can pin
  arbitrary content into the user’s local IDB.
- **Abuse:** spam, harassment, phishing, scaling unsolicited contact
  outside the moderated group system.

## Constraints / Invariants the fix must preserve

- MLS epoch handling and the existing kind-1059 unwrap pipeline are
  correct (`unwrapAndOpen` performs the four-step seal authentication —
  do not regress that).
- Kind-7 reactions inside a DM thread must follow the same whitelist as
  kind-14 chat — a stranger must not be able to react to a known
  message either.
- The whitelist must update reactively: joining a new group must
  immediately make that group’s peers reachable; leaving a group must
  immediately revoke reach.
- The retroactive purge must not delete legitimate DMs with current
  group members. Identity of a thread is by `peerPubkeyHex`, not by
  message content.
- No new relay traffic — the fix is local-only filtering. Do not
  attempt server-side / relay-based filtering; relays are untrusted.

## Root-Cause Hypothesis

Two converging design decisions produced the gap:

1. **NIP-59 forces author-blind subscriptions.** The outer kind-1059
   uses a per-message ephemeral key, so `ndk.subscribe()` cannot use an
   `authors` filter. The team correctly inferred that *thread isolation*
   needs to happen post-unwrap (`shouldIngestRumor`), but only built
   thread isolation; the walled-garden gate was never added because the
   bell watcher had nothing to compare against and the file comment
   explicitly punted on it.
2. **Contact list is write-on-arrival.** `rememberContact` was designed
   to populate from groups and from any DM (so that a user who DM’d you
   first would show up under Contacts). With no walled-garden enforcement,
   that “any DM” path is the primary leak: the contact list is now an
   open inbox of every pubkey on the network.

The fix surface is therefore narrow:

- one central whitelist function (e.g. `isAllowedDmSender(peerHex)`
  reading group state),
- gates added at the two ndk handlers (`directMessageNotifications.ts`
  and `ContactChat.tsx`) and in `rememberContact`,
- a startup purge invoked from `MarmotContext` once groups are hydrated.

## Affected Code (paths and entry points)

- `app/src/lib/directMessageNotifications.ts:52` — global bell watcher;
  add whitelist gate before `rememberContact` and `incrementDirectMessage`
  in both `kind4Handler` and `kind1059Handler`.
- `app/src/components/contacts/ContactChat.tsx:282` (`handleKind4Event`),
  `:297` (`handleGiftWrapEvent`), `:236`
  (`handleHistoricalGiftWrapEvent`) — add whitelist gate before any
  `appendMessage()` call.
- `app/src/lib/contacts.ts:65` — `rememberContact()` should refuse to
  write when the pubkey is not in the whitelist (central enforcement).
- `app/src/lib/marmot/chatPersistence.ts` — add a thread-purge helper:
  enumerate keys via `idb-keyval#keys()`, drop those whose
  `peerPubkeyHex` portion of the key is not in the current whitelist.
- `app/src/context/MarmotContext.tsx` — call the purge once on boot
  after groups are hydrated, and re-run on group-membership change.
- `app/src/lib/unreadStore.ts` — purge unread counters for stranger
  threads as part of the same sweep.
- `app/src/lib/reactions/api.ts` — verify there is no stranger-reaction
  side-channel (reactions on stranger DMs).
- `app/src/types/index.ts` (`Group.memberPubkeys`) — source of truth
  for the whitelist; already exists.

## Out of scope for this fix

- Changing the contact list UI (archived/visible semantics) — that
  remains as today, but the underlying set will be group-derived only.
- Sender reputation / per-relay trust — relays remain untrusted, the
  filter is purely identity-based.
- Replacing NIP-04 with NIP-17 — both inbound paths must continue to
  work for group members, both must be filtered for strangers.
- Changing how groups themselves admit members.

## Reproduction tests (proposed — needs user confirmation, see Open Questions)

### Unit (Vitest)

- `app/src/lib/__tests__/walledGarden.test.ts` (new)
  - `isAllowedDmSender(peer, groups, ownPubkey)` returns true for any
    `peer` in `group.memberPubkeys` of any joined group; false otherwise;
    false for `ownPubkey`; false for empty groups.
- `directMessageNotifications.test.ts` (extend existing)
  - kind-4 from stranger → no `rememberContact`, no
    `incrementDirectMessage`.
  - kind-1059 → kind-14 from stranger → same.
  - kind-1059 from a current group member → bell increments, contact
    registered (sanity floor).
- `chatPersistence-purge.test.ts` (new)
  - Seed `quizzl:messages:dm:<strangerHex>` + `:<memberHex>`; run
    purge with whitelist = `[memberHex]`; assert stranger key is
    removed and member key intact.

### E2E (Playwright)

- `app/tests/e2e/dm-walled-garden-stranger-blocked.spec.ts` (new)
  - Alice signed in, no groups with Mallory. A second `browser.newContext()`
    signs in as Mallory and publishes a DM **through the app’s publish
    helper** (per the project rule that e2e must not raw-WebSocket the
    relay; see `CLAUDE.md` and memory note `feedback_e2e_no_direct_relay`).
  - Assert: Alice’s bell stays at 0, Mallory is not in `/contacts`,
    `/contacts/?id=<mallory>` does not render the message bubble,
    `idb-keyval` has no `quizzl:messages:dm:<mallory>` key.
- `app/tests/e2e/dm-walled-garden-group-member-allowed.spec.ts` (new
  or extend `groups-direct-chat-no-duplicates.spec.ts`)
  - Alice and Bob share a group. Bob DMs Alice via the app. Assert
    bell becomes 1, message renders. (Floor — confirms gate is not too
    tight.)
- `app/tests/e2e/dm-walled-garden-retroactive-purge.spec.ts` (new)
  - Pre-seed Alice’s IDB with a stranger DM thread. Boot the app.
    Assert the thread is gone, bell unchanged, Mallory not in contacts.
- Existing `app/tests/e2e/dm-third-party-inbound.spec.ts` must be
  **inverted** (or deleted) — its current expectations encode the bug.

## Open Questions (please confirm before we start)

1. **Whitelist source.** Confirm the whitelist is exactly “union of
   `memberPubkeys` of currently joined MLS groups, minus self”. Edge
   cases to confirm:
    - User has pending join requests → not in whitelist yet, right?
    - User has been removed from a group but the local state hasn’t
      caught up → drop messages as soon as we know.
    - Old DM thread with a former group member → purge it on the
      next sweep, or keep historical messages and only block new ones?
2. **Retroactive purge — strict or lenient?**
    - Strict: nuke the entire thread (messages, reactions, unread,
      contact entry) for any stranger as soon as we detect the gap.
    - Lenient: keep already-persisted messages read-only, only block
      new ones. (We recommend strict, given the “must not even be
      stored” wording in the report.)
3. **Reproduction-test surface.** Which combination do you want us
   to author before the fix? Proposed (please pick or amend):
    a. Three unit tests (whitelist function, watcher filter, purge) +
       three e2e specs (stranger-blocked, member-allowed,
       retroactive-purge), with the existing
       `dm-third-party-inbound.spec.ts` inverted.
    b. Unit-only floor: ship the unit tests first, defer e2e to the
       fix PR.
    c. E2E-only floor: trust the existing unit harness, just write the
       three e2e specs.
4. **Where should Mallory come from in the e2e?** Per the
   `feedback_e2e_no_direct_relay` rule, Mallory must publish through
   the app. That means Mallory needs a logged-in browser context
   *with* a Nostling identity but *without* any group with Alice. Is
   that acceptable, or do you want a narrow exception to publish a
   pure kind-1059 fixture (one of the project’s “events the app
   cannot produce” cases per `CLAUDE.md`) for the stranger path?

## Maintenance-page status

- Tracked template: `maintenance/index.html` (2506 bytes, JS-free,
  bilingual EN/DE). Tracked in git so future maintenance windows can
  reuse it.
- Make target: `make maintenance` (`lftp mirror -R --delete` of
  `maintenance/` onto `$(HOSTEUROPE_FTP_PATH)/`). After the target
  completes the remote tree contains exactly one file: `index.html`.
- Initial takedown completed 2026-06-02 at 14:59 UTC. Verified by
  re-downloading and diffing `index.html`, and by re-listing the
  remote root (single entry: `index.html`).
- Restore on fix-ship: re-build via `make build` and run `make deploy`
  (the existing `lftp mirror -R --only-newer` of `app/out/` repopulates
  the remote with the new bundle and overwrites the maintenance page).
  No rollback of the previous `index.html` is retained — recovery is
  roll-forward only.
