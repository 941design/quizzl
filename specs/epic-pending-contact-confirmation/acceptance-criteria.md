# Pending Contact Confirmation for Contact-Card Pairing — Acceptance Criteria

## Terminology

- **pending contact** — a `StoredContact` (`app/src/lib/contacts.ts`) whose
  `pendingConfirmationSince` field is a non-null ISO timestamp.
- **confirmed contact** — a `StoredContact` whose `pendingConfirmationSince`
  is `null` (the default for every contact-add path except the one this
  epic changes).
- **issuer** — the person whose contact card was scanned by someone else;
  the passive side of the pairing handshake, and the only side that can end
  up with a pending contact under this epic.
- **scanner** — the person who actively scanned another's contact card;
  admitted immediately, unaffected by this epic.

## Known TAGs

- **STRUCT** — structural assertions about the `StoredContact` data model.
- **ADMIT** — admission-path assertions (who gets a pending contact and
  when).
- **CONFIRM** — the `confirmContact` action's own contract.
- **MSG** — message persistence/rendering assertions.
- **OBS** — notification-bell assertions.
- **UX** — contacts-list / contact-detail UI assertions.
- **GROUP** — group-invite contact-picker exclusion assertions.
- **SEC** — assertions guarding against unintended wire-level side effects.

## Data model (S1)

**AC-STRUCT-1** — `StoredContact` (`app/src/lib/contacts.ts`) MUST include an
optional `pendingConfirmationSince: string | null` field. `readStoredContacts`
(via `normalizeStoredContact`) MUST resolve this field to `null` for any
persisted entry that lacks it, including every contact stored before this
epic shipped.

**AC-STRUCT-3** — The pending-confirmation check MUST be exported as exactly
one pure predicate function, reading only from `readStoredContacts()` (or an
equivalent explicit parameter), and MUST be imported by every call site that
gates on it (the bell increment in `directMessageNotifications.ts`, the
chat-render gate in `ContactChat.tsx`) — no call site MUST re-derive the
`pendingConfirmationSince != null` check inline. This predicate MUST NOT be
folded into, or call, `isAllowedDmSenderComposite` /
`isAllowedDmSender` / `isBlockedPeer` (ADR-008 exception, spec.md Design
Decision 5).

## Admission gating (S1)

**AC-ADMIT-1** — `handlePairingAck` (`app/src/lib/pairing/pairingAck.ts`)
admitting a sender for which no `StoredContact` entry previously existed
MUST create that entry with `pendingConfirmationSince` set to a non-null
timestamp.

**AC-ADMIT-2** — `handlePairingAck` admitting a sender for which a
`StoredContact` entry already existed (re-pairing) MUST leave that entry's
existing `pendingConfirmationSince` value exactly as it was — a re-pairing
MUST NOT set a previously-`null` value to non-null, and MUST NOT clear an
already-pending value.

**AC-ADMIT-3** — `addContactByNpub` (`app/src/lib/contacts.ts`), the
scanner-side admission path reached via the `/add` card-link flow, MUST
continue to create a brand-new contact with `pendingConfirmationSince: null`.
Scanning a card MUST NOT produce a pending contact.

## Confirm action (S1)

**AC-CONFIRM-1** — A `confirmContact(pubkeyHex)` function MUST exist in
`app/src/lib/contacts.ts`. Calling it for a contact whose
`pendingConfirmationSince` is non-null MUST set that field to `null` and
MUST NOT modify any other field (`firstSeenAt`, `lastSeenAt`, `archivedAt`)
on that entry.

**AC-CONFIRM-2** — Calling `confirmContact(pubkeyHex)` for a pubkey with no
matching stored contact, or whose `pendingConfirmationSince` is already
`null`, MUST be a no-op — it MUST NOT throw and MUST NOT write to storage.

## Group-invite exclusion (S1)

**AC-GROUP-1** — `selectableContactsForGroup` (`app/src/lib/contacts.ts`)
MUST resolve a contact's `disabledReason` by the precedence
`'already_member'` > `'blocked'` > `'pending_confirmation'` > selectable. A
pending contact that is not a group member and not blocked MUST resolve to
`{ selectable: false, disabledReason: 'pending_confirmation' }`. A pending
contact that is ALSO blocked (`archivedAt != null`) MUST resolve to
`disabledReason: 'blocked'`, never `'pending_confirmation'` (spec.md Design
Decision 9). An already-member pending contact MUST still resolve to
`disabledReason: 'already_member'` regardless of blocked/pending state
(unchanged precedence).

## Wire-level side effects (S1)

**AC-SEC-1** — Neither `handlePairingAck`'s admission of a new pending
contact nor a later `confirmContact` call MUST publish a kind-0 metadata
event to any relay. The existing gift-wrapped profile-announce and
name-drop cache-write behavior already triggered at admission
(`pairingAck.ts` Steps 10–11) MUST fire identically whether or not the
newly-admitted contact is pending.

## Message hold (S2)

**AC-MSG-1** — A direct message received from a sender whose only
`StoredContact` entry is a pending contact MUST be persisted via the
existing chat-persistence path (`appendMessage` /
`app/src/lib/marmot/chatPersistence.ts`) exactly as for a confirmed
contact's message — persistence MUST NOT be gated on
`pendingConfirmationSince`.

**AC-MSG-2** — A direct message received from a pending contact MUST NOT
appear in that contact's rendered chat thread (`ContactChat.tsx`) while the
contact remains pending. Once the contact is confirmed
(`pendingConfirmationSince` becomes `null`), every message persisted for
that contact — including messages received while pending — MUST render in
the thread without requiring a page reload.

## Notification bell (S2)

**AC-OBS-1** — *(Tightened 2026-07-15 — see spec.md `## Amendments`.)* A
direct message received from a pending contact MUST NOT increment that
contact's unread count in the notification-bell store
(`app/src/lib/unreadStore.ts`), at every writer capable of raising that
count: both the live per-event increment path (`directMessageNotifications.ts`
`kind4Handler`/`kind1059Handler`) at the time the message is received, and
the batch/startup reconciliation path (`unreadStore.ts#initDirectMessageCounts`)
when it recomputes counts from persisted history. A pending contact's
messages MUST be excluded from the count at both writers, not just the live
one — the guarantee is structural (verified by killing all mutants of the
exclusion filter), not merely a property of the common case.

**AC-OBS-2** — *(Amended 2026-07-15 — see spec.md `## Amendments`.)*
Confirming a pending contact (`confirmContact`) MUST NOT lose or hide any
message received from them while pending: every such message MUST become
visible in the contact's chat thread, and the notification-bell unread count
MUST correctly reflect them, the next time the user opens that contact's
conversation. This app persists a contact's message history to the device
only once their conversation has been opened at least once (a pre-existing,
out-of-epic-scope property of the DM pipeline); the bell reconciliation runs
against persisted history and therefore cannot show an accurate count before
that first open. Confirming MUST NOT require the user to leave and re-enter
the app to see this — opening the contact's conversation within the same
session is sufficient.

## Contacts UI (S2)

**AC-UX-1** — *(Tightened 2026-07-15 — see spec.md `## Amendments`.)* The
contacts list MUST render a pending contact with a visibly distinct
indicator (e.g. a badge), separate from the existing archived/blocked
indicator, and MUST offer an explicit confirm action for it — UNLESS the
contact is also blocked (`archivedAt != null`), in which case the list row
MUST show only the existing archived/blocked indicator and MUST NOT show
the pending badge or confirm action (spec.md Design Decision 9: blocked
always wins over pending). This is the same precedence AC-UX-2 already
requires of the detail view and AC-GROUP-1 requires of the group-invite
picker; the contacts-list row is the third site it must hold at.

**AC-UX-2** — Opening a pending contact's detail view MUST present a
confirmation prompt in place of the normal message thread, UNLESS the
contact is also blocked (`archivedAt != null`), in which case the existing
`epic-block-contact` Blocked banner MUST render instead — blocked always
wins over pending (spec.md Design Decision 9). For a pending, non-blocked
contact: after the user confirms via the prompt, the same view MUST render
the normal chat thread, including any messages received while pending
(AC-MSG-2), without requiring navigation away and back.

**AC-UX-3** — Every new user-facing string introduced by this epic (the
pending badge, the confirmation-prompt copy, and the confirm action label)
MUST have both an `en` and a `de` entry in `app/src/lib/i18n.ts`'s `Copy`
type and both language objects. No pending-confirmation string introduced by
this epic MUST be hardcoded in `app/pages/contacts.tsx` or any component it
renders.

## Cross-Cutting Invariants

**AC-STRUCT-2** — No existing `StoredContact` entry (blocked, archived, or
otherwise) persisted before this epic ships MUST have its resolved
`pendingConfirmationSince` be anything other than `null` after an upgrade —
this is purely additive to the data model (AC-STRUCT-1's default-to-`null`
resolution covers this).

**AC-STRUCT-4** — The pending-admission primitive (used by
`handlePairingAck`) and `confirmContact(pubkeyHex)` MUST resolve `pubkeyHex`
against `readStoredContacts()` entries case-insensitively, matching
regardless of the stored key's casing — mirroring `addContactByNpub`'s
existing `matchingKeys` pattern (`app/src/lib/contacts.ts`). A pending
contact stored under a differently-cased key MUST still be found, and MUST
still be clearable, by `confirmContact`.

## Manual Validation

None. Every *behavioral* AC above (admission gating, message hold, bell
delay, confirm reconciliation, UI states, blocked/pending precedence) is
deterministically observable via the existing two-browser-context Playwright
pattern this project already uses for pairing/DM e2e coverage
(`app/tests/e2e/dm-pairing-*.spec.ts`). AC-STRUCT-3's "single exported
predicate, no inline re-derivation" clause is a code-shape assertion, not a
black-box behavior — it is verified by code review and a unit test asserting
the predicate has exactly one export site, not by browser automation.
AC-STRUCT-4's case-insensitive-matching clause is verified by a unit test
that stores a contact under a mixed-case key and calls `confirmContact` with
the lowercase form (or vice versa), following this project's existing
hand-rolled-localStorage-mock `contacts.test.ts` convention — not by browser
automation, since the UI never surfaces raw key casing. AC-UX-3's
translation-completeness clause is verified by an `*.i18n.test.ts`-style
`REQUIRED_KEYS` assertion (this project's existing pattern, e.g.
`addPage.i18n.test.ts`) confirming both `en` and `de` resolve and differ for
each new key — not by browser automation.
