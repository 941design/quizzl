# Pending Contact Confirmation for Contact-Card Pairing

## Problem

The contact-pairing-code flow (epic: `contact-pairing-code`) admits a contact
the instant the cryptographic handshake completes. When someone scans your
contact card, your app receives their gift-wrapped pairing acknowledgement
and immediately, automatically treats them as a fully trusted contact:
`handlePairingAck` (`app/src/lib/pairing/pairingAck.ts:439`) calls
`rememberContact` synchronously, with no intermediate state and no action
from you. From that instant, their messages render in your chat list and
ring your notification bell exactly like an existing contact's.

Nonce possession is a legitimate cryptographic signal that *someone* holding
your card scanned it, but it is not the same thing as *you* having looked at
who they are and decided you recognize or want to talk to them. Today there
is no step in between "the handshake succeeded" and "this person can message
me and interrupt me with notifications" — the request is to insert one.

## Solution

When your card is scanned and the pairing handshake completes, the new
contact is admitted into your local contact store in a **pending
confirmation** state rather than immediately final. You can see the pending
contact (so you know who scanned your card and can decide), but their
messages do not appear in your chat view and do not ring your notification
bell until you explicitly confirm them. Messages sent to you while a contact
is pending are not lost — they are received and stored normally, and become
visible, with the bell reflecting them, the moment you confirm.

This applies only to the **passive side** of the pairing handshake — the
person whose card was scanned. The person who actively chooses to scan
someone else's card has already expressed clear intent by doing so, and
continues to be admitted immediately, exactly as today.

## Scope

### In Scope

- A new `pendingConfirmationSince` state on a stored contact, set only when
  `handlePairingAck` admits a brand-new sender.
- A `confirmContact` action that finalizes a pending contact.
- Contacts-list and contact-detail UI that surfaces a pending contact and
  lets the user confirm it.
- Holding back chat rendering and notification-bell increments for a
  still-pending contact's messages, while still persisting those messages.
- Reconciling the notification bell for a contact's held messages at the
  moment of confirmation.
- Excluding a still-pending contact from the group-invite contact picker
  (epic: `invite-group-member-from-contacts`).

### Out of Scope

- Extending pending-confirmation to any contact-add path other than the
  issuer side of the pairing-code flow (e.g. group-membership sync stays
  immediate, per the existing scope decision this spec is built on).
- Any change to `ContactDetailView`'s existing archived/blocked UI beyond
  adding the new pending state alongside it.
- Making the notification bell accurate for a still-unopened, newly-confirmed
  contact's held messages (i.e. before the user has ever opened that
  contact's conversation). This would require `confirmContact` to trigger a
  historical relay fetch and persist the result, a materially larger change
  than this epic's render/bell-gate scope. Deferred to a follow-up (see
  Amendments, 2026-07-15).

## Design Decisions

1. **Only the passive (issuer) side gets a pending state.** The scanner's own
   admission (`addContactByNpub`, `app/src/lib/contacts.ts:415`, reached only
   via the card-link `/add` flow per `processContactInput.ts`'s own header
   doc) is untouched — scanning a card is itself an intentional action.
   Confirmed by product decision during spec drafting.
2. **New field, not a new enum.** `StoredContact` gets an optional
   `pendingConfirmationSince: string | null` (default `null`), mirroring the
   existing `archivedAt` null-means-normal convention
   (`app/src/lib/contacts.ts:9-14`). Two independent nullable-timestamp axes
   (`archivedAt` for blocked, `pendingConfirmationSince` for pending) compose
   more simply than a single combined status enum, and match how this module
   already reasons about `archivedAt`.
3. **Manual confirmation only — no auto-expiry.** Per product decision, the
   pending state persists indefinitely until the user explicitly confirms;
   there is no timer-based fallback.
4. **"Held back" is a render/notification-layer concern, not an
   ingestion-layer one.** `rememberKnownPeers` and the existing
   message-persistence path are untouched by this feature — a still-pending
   contact remains a "known peer" for walled-garden purposes
   (`isAllowedDmSender`), so their messages are received and stored exactly
   as today. This is what makes "queued, then delivered on confirm" possible
   without a separate holding buffer: the already-persisted history simply
   becomes visible once the render gate lifts.
5. **New, additive gate — deliberately NOT folded into the existing
   block/deny composite, as a documented exception to ADR-008.** ADR-008
   ("Block is a deny layer AND-ed at every peer-signal channel") mandates
   that any signal tied to an individual peer compose through the single
   shared `isAllowedDmSenderComposite` (`app/src/lib/blockedPeers.ts:113`)
   — and names `pairingAck.ts` explicitly as a site it governs. This spec
   does not fold pending-confirmation into that composite, because doing so
   would gate the three `shouldIngestRumor` ingestion sites the composite
   already reaches, which would block *storage*, not just visibility —
   contradicting Design Decision 4 and the "queued, then delivered on
   confirm" requirement this epic exists to deliver. Blocking and pending
   have different storage semantics (block = full cutoff, no storage;
   pending = full storage, deferred visibility only), so they cannot share
   one predicate. What this spec DOES carry over from ADR-008's actual
   point — one predicate, one home, no per-call-site re-derivation — is the
   discipline itself: the new pending-check is a single pure function,
   exported from one module and imported by every render/bell call site,
   never re-derived inline (AC-STRUCT-3). This is a cited, deliberate
   exception to ADR-008's default composite, not an oversight — see
   `## Constrained by ADRs` below.
6. **Group-invite exclusion reuses the existing extension point.**
   `selectableContactsForGroup`'s `ContactSelectabilityEntry.disabledReason`
   (`app/src/lib/contacts.ts:258-262`) gains a third value,
   `'pending_confirmation'`, alongside the existing `'already_member'` and
   `'blocked'` — a still-pending contact cannot be invited into an MLS group
   before the user has actually confirmed the relationship. Full precedence
   (Design Decision 9 resolves the blocked/pending overlap): `already_member`
   > `blocked` > `pending_confirmation` > selectable.
9. **Blocked always wins over pending.** A pending contact's only reject
   mechanism is the existing block/archive action (see Non-Goals) — there is
   no separate "decline" — so a contact can be both pending and blocked at
   once. Confirmed by product decision: blocking is treated as a terminal
   decision that supersedes an undecided pending state, everywhere the two
   would otherwise conflict. Concretely: the contact-detail view shows the
   existing `epic-block-contact` Blocked banner, never this epic's
   confirmation prompt, for a contact that is both blocked and pending
   (AC-UX-2); the group-invite picker resolves such a contact to
   `disabledReason: 'blocked'`, not `'pending_confirmation'` (AC-GROUP-1,
   Design Decision 6's precedence order).
7. **Outbound signals already fired at admission are unaffected.** The
   gift-wrapped profile-announce (`pairingAck.ts` Step 10) and the name-drop
   contact-cache write (Step 11) continue to fire on fresh admission exactly
   as today. Nonce possession remains the cryptographic trust decision for
   the handshake itself (see this module's existing header doc); this
   feature adds a local, user-facing confirmation gate on top of that
   decision — it does not revisit whether the handshake itself was
   trustworthy. This is deliberately different from the `block-contact`
   epic's precedent, where blocking *does* suppress these signals because
   blocking is a trust revocation, not a pending state.
8. **Bell catch-up needs an explicit reconciliation step, bounded by an
   out-of-scope pipeline property (amended 2026-07-15).**
   `incrementDirectMessage` (`app/src/lib/unreadStore.ts`) is a live,
   per-event increment — it is never recomputed from stored history. Simply
   lifting the render gate on confirm is not sufficient to make the bell
   reflect held messages; `confirmContact` triggers a reconciliation that
   counts persisted messages received after `getDirectMessageLastReadAt`
   for that peer. During S2 implementation this surfaced a pre-existing,
   out-of-scope property of the DM pipeline: a contact's message *content*
   is only persisted to the device once `ContactChat` has mounted for that
   peer at least once (a historical relay fetch on mount); the always-on
   bell watcher never persists content, only bumps counts. A pending
   contact's `ContactChat` never mounts while pending, so the reconciliation
   has nothing to count until the user opens that contact's conversation for
   the first time — at which point the messages load normally and the bell
   clears as part of the normal "read" flow. No message is ever lost. Product
   decision (2026-07-15): accept this — AC-OBS-2 is amended to describe the
   bell catching up on first open rather than on confirm itself. A follow-up
   making `confirmContact` trigger a historical fetch so the bell is accurate
   before the first open is deliberately out of scope for this epic (see
   Out of Scope).

## Constrained by ADRs

- **ADR-008** — Block is a deny layer AND-ed at every peer-signal channel,
  keyed on `archivedAt`. Names `pairingAck.ts` as a governed site. This spec
  documents a deliberate, cited exception (Design Decision 5): the new
  pending-confirmation gate is a second, orthogonal predicate — not folded
  into `isAllowedDmSenderComposite` — because it must not gate message
  ingestion the way the block composite does. It preserves ADR-008's
  underlying discipline (one predicate, one home, every call site imports
  it, never re-derived) for the new predicate itself.
- **ADR-002** — Mutual contact graph and pull-only invitations. Establishes
  `knownPeers` as the walled-garden trust basis. This spec does not touch
  `knownPeers` or `rememberKnownPeers` — pending-confirmation is a
  visibility/notification gate layered on top of, not a replacement for,
  the existing walled-garden admission decision (Design Decision 4).
- **ADR-005** — Extends `knownPeers` trust to manually-added contacts.
  Confirms that admission into `knownPeers` (which this spec leaves
  unchanged) is what makes two-way messaging work at all; pending-
  confirmation only affects what the local user *sees and is notified of*
  after that admission.
- **ADR-009** — Require issuer confirmation before admitting a scanned
  contact. Codifies this epic's core decision (bearer-credential
  rationale, the issuer/scanner asymmetry) as a cross-epic ADR, and
  records the deliberate supersession of `epic-contact-pairing-code`'s
  `AC-ADMIT-6`/`AC-PAIR-4` "immediately" clause.

## Technical Approach

### `app/src/lib/contacts.ts`

- Add `pendingConfirmationSince?: string | null` to `StoredContact`;
  `normalizeStoredContact` defaults it to `null` for any entry (including
  every existing/legacy stored contact) that lacks the field.
- Add a new admission primitive used only by `handlePairingAck` for a
  brand-new sender, setting `pendingConfirmationSince` to the admission
  timestamp. An existing sender re-pairing (entry already present) is bumped
  exactly like `rememberContact` does today — `pendingConfirmationSince` is
  never reset by a re-pairing, mirroring the existing `archivedAt`
  preservation precedent at `pairingAck.ts:454`.
- Add `confirmContact(pubkeyHex)`, clearing `pendingConfirmationSince` to
  `null`; a no-op for an unknown pubkey or one already confirmed.
- Extend `ContactListItem` with an `isPendingConfirmation` boolean, mirroring
  the existing `isArchived` derivation.
- Extend `ContactSelectabilityEntry.disabledReason` with
  `'pending_confirmation'` in `selectableContactsForGroup`.

### `app/src/lib/pairing/pairingAck.ts`

- `handlePairingAck`'s Step 9 admission (currently
  `rememberKnownPeers([senderHex]); rememberContact(senderHex);`) uses the
  new pending-admission primitive in place of `rememberContact` for this one
  call site. `rememberKnownPeers` is unchanged (Design Decision 4).
- Steps 10 (profile announce) and 11 (name-drop cache write) are unchanged
  (Design Decision 7).

### `app/src/lib/directMessageNotifications.ts`

- In both `kind4Handler` and `kind1059Handler`, after `rememberContact(peer)`,
  check whether `peer` is still pending confirmation before calling
  `incrementDirectMessage(peer)`; skip the bump while pending.

### `app/src/components/contacts/ContactChat.tsx`

- The four existing `shouldIngestRumor` ingestion sites are unchanged
  (Design Decision 4 — persistence is not gated).
- The render path gains a check so a still-pending contact's thread does not
  display received messages until confirmed (e.g. the detail view shows a
  confirmation prompt component in place of the normal thread while
  pending).

### `app/pages/contacts.tsx`

- Contact list rows and `ContactDetailView` surface the pending state (a
  distinct badge/copy, mirroring the existing archived-badge treatment) and
  wire the confirm action to `confirmContact`.
- `ContactDetailView` (`contacts.tsx:236-362`) already branches
  `contact.isArchived ? <BlockedBanner/> : <ContactChat/>`, re-derived
  reactively on a `blockedPeersRevision` counter bumped by `MarmotContext`.
  This spec's three-way branch (blocked banner / pending-confirm prompt /
  `ContactChat`, per Design Decision 9's precedence) needs an analogous
  reactive counter for pending state — there is no existing
  `pendingConfirmationRevision` equivalent — so `confirmContact` must bump
  one, and `ContactDetailView`'s `contact` `useMemo` must depend on it, for
  the "no navigation away and back" requirement (AC-UX-2) to hold within a
  single mounted session. `ContactChat` is not mounted at all while pending
  (matching the existing archived-branch pattern), which also means
  `markDirectMessagesRead` (which fires from inside `ContactChat` on mount)
  correctly does not fire for a still-pending contact.

### `app/src/lib/i18n.ts`

- New `Copy` keys for the pending badge, the confirmation prompt copy, and
  the confirm action, added to both `en` and `de` per this project's
  translation convention.

### Bell reconciliation (Design Decision 8)

- `confirmContact`'s caller (or `confirmContact` itself) triggers a
  reconciliation of the unread count for that peer, sourced from persisted
  chat history created after `getDirectMessageLastReadAt(peer)`. *(Amended
  2026-07-15 — see `## Amendments`.)* This reconciliation call no-ops in the
  common case, because nothing is persisted for a peer whose conversation
  has never been opened (Design Decision 8's amended text) — the bell
  actually catches up the next time the user opens that contact's
  conversation, via the existing `markDirectMessagesRead` mount effect in
  `ContactChat`, not via this reconciliation call in isolation. See
  `## Out of Scope` for the deferred relay-fetch-on-confirm follow-up that
  would make the reconciliation call itself accurate before first open.
- `app/src/lib/unreadStore.ts`'s existing `initDirectMessageCounts` (`:331`)
  already implements exactly this recompute — per-peer IDB read filtered by
  `createdAt > lastRead && sender !== own` — as a batch/init-time operation.
  Reuse it directly with a one-element peer array
  (`initDirectMessageCounts([peer], ownPubkeyHex)`) rather than
  hand-duplicating the count logic; this also gets the existing
  live-increment race protection (`reconcileInit`, `:71`) for free. Read the
  persisted thread via `directConversationId(peerHex)`
  (`app/src/lib/directMessages.ts:48`) + `chatPersistence.ts#loadMessages`,
  the canonical read path, rather than the raw `few:messages:dm:<peer>`
  string key `initDirectMessageCounts` currently builds inline.
  *(Superseded 2026-07-15 — see `## Amendments`.)* This directive — route the
  confirm-time reconciliation through the canonical `loadMessages` read path
  — turned out to be unsafe and was reverted in implementation.
  `chatPersistence.ts#loadMessages` self-heals a DM thread only ONCE per
  session: its first call for a given thread marks it "healed" and returns
  real `refetchIds` for malformed/non-canonical rows for the caller to
  enqueue a relay repair-refetch; every later call to that same thread
  short-circuits to `refetchIds: []`. `reconcileConfirmedContactDirectMessageCount`
  runs on every confirm (including the still-live detail-view confirm path,
  `PendingConfirmationPrompt.tsx`) and discards `refetchIds` entirely, so it
  can easily be the FIRST caller to touch `loadMessages` for a thread —
  permanently and silently consuming the one-time repair opportunity before
  `ContactChat`'s own later `loadMessages` call (the one that actually acts
  on `refetchIds`) ever gets a chance to see it. `reconcileConfirmedContactDirectMessageCount`
  now reads via a raw, side-effect-free `idb-keyval` `get()` against the
  `few:messages:dm:<peer>` key instead — the exact same pattern
  `initDirectMessageCounts` itself uses (and was already reverted to, for the
  identical reason, earlier in this epic's S2 gate-remediation). A
  reconciliation-only caller must never be the first to trigger a one-time
  repair signal it has no way to consume. This sacrifices "reads via the
  canonical `chatPersistence.ts` read path" in favor of correctness; the
  amended AC-OBS-2 wording (bell/messages catch up on first open) is
  unaffected — it describes observable behavior, not the read mechanism that
  computes the interim count.

## Stories

- **S1 — Pending admission core** — `StoredContact` field, `handlePairingAck`
  admission gating, `confirmContact`, group-invite exclusion, the shared
  pending predicate. Covers AC-STRUCT-1, AC-STRUCT-2, AC-STRUCT-3 (defined
  here; also verified at S2's call sites), AC-STRUCT-4, AC-ADMIT-1,
  AC-ADMIT-2, AC-ADMIT-3, AC-CONFIRM-1, AC-CONFIRM-2, AC-GROUP-1, AC-SEC-1.
- **S2 — Message hold, bell delay, and UI** — chat-render gating, bell-bump
  gating, bell reconciliation on confirm, contacts-list/detail UI, i18n.
  Covers AC-UX-1, AC-UX-2, AC-UX-3, AC-MSG-1, AC-MSG-2, AC-OBS-1, AC-OBS-2,
  and verifies AC-STRUCT-3 (no inline re-derivation) at its own call sites.

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## Relationship to Other Epics

- **epic-contact-pairing-code** — this epic modifies the admission step
  (`handlePairingAck`, `pairingAck.ts:439`) that epic added; the nonce/ack
  cryptographic handshake itself is unchanged.
- **epic-block-contact** — this epic follows the same pure-predicate,
  read-from-`readStoredContacts()` shape that epic established
  (`isBlockedPeer`), as a pattern to imitate, not a function to reuse or
  modify — pending and blocked remain independent, composable states.
- **epic-invite-group-member-from-contacts** — this epic's consumer,
  `selectableContactsForGroup`, must not offer a still-pending contact for
  group invites; this spec extends that epic's `disabledReason` enum.
- **epic-direct-contact-profile-exchange** — the profile-announce and
  name-drop cache-write side effects that epic added at admission are
  explicitly left unaffected by pending state (Design Decision 7).

## Non-Goals

- No automatic time-based expiry or fallback confirmation of a pending
  contact.
- No "reject" mechanism distinct from the existing archive/block action —
  declining a pending contact reuses the existing block/archive flow.
- No change to the scanner-side admission (`addContactByNpub`) or to the
  cryptographic nonce/ack trust decision itself.
- No suppression of the gift-wrapped profile-announce or name-drop cache
  write already triggered at admission time.

## Amendments

- **2026-07-15** — Tightened `AC-OBS-2`. Source: Stage-1 code review during
  S2 implementation, confirmed by product decision. Rationale: the original
  wording required the bell to reflect held messages immediately on
  `confirmContact`, sourced from persisted history. Implementation revealed
  this app only persists a contact's message content once their conversation
  has been opened at least once (out-of-scope pre-existing DM-pipeline
  property) — so no persisted history exists to reconcile against until
  first open. The AC now describes the achievable, still-lossless behavior:
  held messages and the bell both catch up correctly on first open, not on
  confirm itself. A relay-fetch-on-confirm follow-up is noted in `## Out of
  Scope` as a deliberately deferred, separate-scope enhancement.
- **2026-07-15 (gate-remediation, second round)** — Reverted the "Bell
  reconciliation (Design Decision 8)" directive to read
  `reconcileConfirmedContactDirectMessageCount` via the canonical
  `chatPersistence.ts#loadMessages` path. Source: structural bug found and
  escalated during gate-remediation, then fixed in this same round. Rationale:
  `loadMessages` runs a DM-thread self-heal pass exactly once per thread per
  session (first caller marks the thread "healed" and receives real
  `refetchIds`; every later caller for that thread gets `refetchIds: []`).
  `reconcileConfirmedContactDirectMessageCount` runs on every confirm action
  and discards `refetchIds`, so it could be the first caller to touch a
  thread's `loadMessages` — permanently and silently discarding a genuine
  message-repair opportunity for that thread before `ContactChat`'s own
  later `loadMessages` call ever got to act on it. Fixed by switching
  `reconcileConfirmedContactDirectMessageCount` to the same raw,
  side-effect-free `idb-keyval` read `initDirectMessageCounts` already uses
  (see "Bell reconciliation (Design Decision 8)" above for the full
  rationale). This is an implementation-mechanism correction only — AC-OBS-2's
  amended wording (bell/messages catch up on first open) is unaffected and
  still holds.

- **2026-07-15 (pre-ship e2e gate)** — Recorded that this epic **deliberately
  supersedes the `contact-pairing-code` epic's `AC-ADMIT-6` and `AC-PAIR-4`**.
  Source: the pre-ship e2e gate (which had not run before the epic was
  committed) surfaced two failing specs —
  `app/tests/e2e/dm-pairing-single-scan-mutual.spec.ts` (AC-ADMIT-6, that
  epic's self-described "anchor scenario") and
  `app/tests/e2e/dm-pairing-multi-use.spec.ts` (AC-PAIR-4). Both were
  confirmed genuine behavior changes, not flakes, by running them against the
  pre-epic baseline (`6ce9cfd`), where both pass. Neither this spec nor spec
  validation had noticed the collision.

  **The conflict.** `AC-ADMIT-6` promised that after B scans A's card once,
  *both* DM directions work immediately with no second scan. This epic makes
  that false on A's side by design: A holds B as pending until A confirms.

  **Product decision (rationale).** The supersession is intended, and the
  reason is security, not convenience. **A contact card is a bearer
  credential: anyone who obtains a leaked card can pair with the issuer.**
  Under the old auto-admit behavior that pairing succeeds *silently and
  permanently*, so a leak is undetectable at worst — the issuer never learns
  it happened. Requiring the card issuer to confirm incoming contact requests
  converts an invisible, irreversible pairing into a visible, declinable
  prompt. That is the better pattern, and it is worth the cost of
  `AC-ADMIT-6`'s immediate-both-directions promise.

  **Why the asymmetry is principled.** Only the party who *provided* the card
  confirms. The scanner is unaffected and still admits immediately, because
  scanning is itself an intentional act that expresses consent; the issuer
  performed no such act — someone simply presented their card. This is the
  same reasoning as Design Decision 9 (an explicit decision supersedes an
  undecided pending state), applied to admission rather than blocking.

  **Scope of the supersession.** `AC-ADMIT-6`'s "no second scan" guarantee
  still holds in full — no rescan is ever required, and a confirm tap is not
  a scan. What is superseded is only the "both directions work *immediately*"
  clause, which now reads "both directions work once the card issuer
  confirms". The two e2e specs above were updated in this round to drive the
  confirm step and assert the new behavior; their headers now cite this
  amendment.

- **2026-07-15 (curator, post-ship)** — Tightened `AC-OBS-1`. Source:
  pre-ship review + mutation-testing gate (`epic-state.json` `gate_runs`)
  found and closed a real gap in `unreadStore.ts#initDirectMessageCounts`
  (the batch/startup recompute path) that could re-light a pending
  contact's bell count on a full state rebuild, even though the live
  increment path (`directMessageNotifications.ts`) already excluded it. The
  original AC-OBS-1 text ("at the time it is received") described only the
  live half of this guarantee. `initDirectMessageCounts` now carries the
  same exclusion, with all 5 mutants of the exclusion filter killed
  (`app/tests/unit/unreadStore.test.ts`, describe block "`initDirectMessageCounts`
  — pending contacts never light the bell (AC-OBS-1, gate-remediation finding
  C)"). AC-OBS-1 now names both writers explicitly so a future contributor
  reading the AC alone knows the guarantee is structural, not
  luck-of-the-live-path.

- **2026-07-15 (curator, post-ship)** — Tightened `AC-UX-1`. Source:
  gate-remediation (`app/pages/contacts.tsx:200-215`, comment "finding B")
  found the contacts-list row's pending badge/confirm button was not
  originally gated on Design Decision 9's blocked-wins-over-pending
  precedence, which AC-UX-2 (detail view) and AC-GROUP-1 (group picker)
  already required. Fixed by gating the list row on
  `contact.isPendingConfirmation && !contact.isArchived`, guarded by a
  source-scan unit test
  (`app/tests/unit/contacts.test.ts`, "the pending-badge/confirm-button
  block is gated on `contact.isPendingConfirmation && !contact.isArchived`").
  AC-UX-1 now states the precedence explicitly as the third site it must
  hold at, alongside AC-UX-2 and AC-GROUP-1.
