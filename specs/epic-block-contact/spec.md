# Block Contact

**Status**: pre-implementation
**Source**: `specs/block-contact-spec-request.md` (requester decisions locked)

## Problem

Today the app has a **cosmetic "Hide contact"** action (internally `archiveContact`,
`app/src/lib/contacts.ts:115`; user-facing "Hide contact" / "Hidden",
`app/src/lib/i18n.ts`). Hiding only removes a contact from the default list view. It does
**nothing to stop that contact**: their DMs still arrive, decrypt, and persist; the
notification bell still rings (`incrementDirectMessage`,
`app/src/lib/directMessageNotifications.ts`); their full chat history stays readable.

This feature gives the existing hide/unhide mechanism teeth. After this change **hiding a
contact is a real block**: their DMs are filtered out entirely, their stored chat history is
deleted, the bell never rings for them, and you cannot send to them while they are blocked.
Unblocking (the existing "unhide") restores messaging — but on a **fresh, empty thread**,
because the old history was deleted.

## Solution

Overload the existing archive flag (`StoredContact.archivedAt`) as the single source of
truth for "blocked". A contact with `archivedAt != null` is **blocked**. Blocking = hiding;
unblocking = unhiding. No new state, no new toggle.

The block is a **deny-list that overrides the existing allow-list**. It is enforced at every
inbound and outbound DM gate as a logical AND: `allowed = isAllowedDmSender(...) AND NOT
isBlockedPeer(...)`. Deny wins over allow. Blocking also performs a targeted single-peer
history wipe, and the block/unblock action gains a confirmation dialog (block only) and new
"Block/Blocked/Unblock" copy.

The block is **entirely local** (`localStorage` `lp_contacts_v1` + local idb-keyval). No
public event of any kind is emitted — this is mandatory under the project privacy invariant
(`CLAUDE.md`).

## Scope

### In Scope
- Pure `isBlockedPeer(peerHex, blockedPeers)` predicate + block-set derivation from the
  contacts store; a composite gate `isAllowedDmSender(...) AND NOT isBlockedPeer(...)`.
- Applying the composite gate at every inbound and outbound DM enforcement site.
- Inbound bell/notification suppression for blocked peers (drop before `rememberContact` /
  `incrementDirectMessage`).
- Targeted single-peer history wipe on block (thread rows, edit/delete aux state, unread
  counters), draining in-flight writes first.
- Blocked-state detail view (banner + Unblock), replacing the composer while blocked.
- Gating **every** send path while blocked: text, image/attachment button, paste-to-send,
  drag-and-drop, reactions — plus the direct-URL route (`/contacts?id=<peerHex>`).
- Confirmation dialog before block (destructive); no confirmation on unblock.
- Relabel copy (en + de): Block / Blocked / Unblock, blocked detail notice, hidden-filter
  controls, and new confirm-dialog copy.

### Out of Scope
- **No group-level blocking.** Blocking affects 1:1 DMs only. A blocked contact who shares an
  MLS group still appears there and their group messages still render (DECISION 5).
- **No network broadcast.** No NIP-51 mute list (kind-10000), no kind-0, no public event of
  any kind (privacy invariant, §7).
- **No cross-device sync.** Block state is per-device, exactly like today's archive flag.
- **No blocking of strangers.** You can only block an existing contact.
- **No permanent blocked-stranger registry.** The contact record is retained (archived); only
  messages/counters are deleted.

## Constrained by ADRs

- **ADR-005 (Accepted)** — extends ever-known-peers trust to manually-added contacts; it
  explicitly anticipates "a block/revoke feature" as a future evolution. This epic is that
  feature. Block is a deny layer that sits *on top of* the trust ADR-005 established; it does
  not revoke known-peer status (§9: blocking does not remove the peer from `knownPeers`).
- **ADR-002 (Proposed)** — mutual contact graph / pull-only invitations. Touches
  `walledGarden.ts` but does not conflict: block is an additional AND-ed deny, never a change
  to the allow function.
- **ADR-007 (Proposed)** — gift-wrapped 1:1 direct-contact profile exchange. Its heal channel
  (`ProfileHealWatcher` / `dmProfile/receive.ts`) already gates on `archivedAt`, so a blocked
  contact is already suppressed there (see Technical Approach — enforcement surface).
- **ADR-008** — Block is a deny layer AND-ed at every peer-signal channel, keyed on `archivedAt`.

## Relationship to Other Epics

- `epic-direct-contact-profile-exchange` (ADR-007) — owns the fourth inbound channel this epic
  verifies is already block-suppressed; no changes to that epic's code are required.
- `epic-contact-pairing-code` — the re-pairing path referenced by DD-9; a blocked contact who
  re-pairs stays blocked.
- `epic-dm-walled-garden` — owns the `isAllowedDmSender` allow layer this epic composes with.

## Design Decisions (locked by requester)

1. **DD-1 — Upgrade, don't add.** The existing hide/unhide mechanism *is* block/unblock.
   `archivedAt != null` ⇒ blocked. The internal identifier (`archivedAt`, `archiveContact`)
   stays; only surfaced copy and user-visible labels change.
2. **DD-2 — Full cut-off, both directions.** While blocked you cannot open the chat or send;
   none of their inbound DMs reach you.
3. **DD-3 — Delete history on block.** Blocking permanently deletes the locally stored DM
   history for that contact (rows removed from storage, not merely hidden).
4. **DD-4 — Reversible to a fresh thread.** Unblocking restores messaging but the deleted
   history does not return; the conversation restarts empty.
5. **DD-5 — DMs only.** Shared MLS group chats untouched.
6. **DD-6 — Confirm before blocking.** Block shows a confirmation dialog (destructive);
   unblock does not.
7. **DD-7 — Relabel to "Block".** "Hide/Hidden" → "Block/Blocked/Unblock" (en + de).
8. **DD-8 — Keep the allow function pure.** `isBlockedPeer` is a **separate** pure predicate;
   it must NOT be folded into `isAllowedDmSender` (that would break its storage-free invariant,
   AC-SEC-13). The `blockedPeers` set is computed by the caller from the contacts store, the
   same way `knownPeers` is threaded today (via a context/ref, per open question 2 — preferred
   for consistency with existing walled-garden wiring).
9. **DD-9 — Deny survives re-admission (re-pairing AND re-add-by-npub).** If a blocked contact
   later pairs again OR is re-added by npub, the block still wins until explicitly unblocked. No
   prompt (deny is explicit user intent). **This requires a code change**: `addContactByNpub`
   (`contacts.ts:329-337`) today calls `unarchiveContact` and returns `reactivated: true` when
   re-adding an archived (⇒ blocked) contact — that silent-unblock path must be removed. Re-add
   of a blocked contact must NOT clear `archivedAt`; instead the add-by-npub flow reports that
   the contact is blocked and directs the user to the explicit Unblock action. (Exact return
   shape is the architect's call; the observable is: `archivedAt` stays set, and no DM channel
   re-opens for that peer.) The pairing-ack re-admission path (`pairingAck.ts`) already preserves
   `archivedAt` via `rememberContact`, so it needs no change — only `addContactByNpub` does.
10. **DD-10 — `data-testid`s may keep archive identifiers** (`profile-archive`,
    `contact-archived-alert`) to avoid test churn; the naming mismatch is intentional and noted.
    `profile-archive` has one existing e2e consumer (`groups-contacts.spec.ts`); keeping the id
    stable avoids breaking it.
11. **DD-11 — Confirm dialog reuses the `LeaveGroupButton` pattern.** No shared confirm-dialog
    primitive exists in the codebase. The block confirmation reuses the established
    destructive-action pattern from `app/src/components/groups/LeaveGroupButton.tsx` (Chakra
    `Modal` + `useDisclosure`, danger-scheme confirm button), rather than introducing a new
    modal abstraction.
12. **DD-12 — History wipe is `clearMessages` + `clearDirectMessageContact`, two calls.**
    `clearMessages('dm:<peer>')` (`chatPersistence.ts:552-575`) already internally drains
    in-flight `appendMessage` writes AND clears edit/delete aux state
    (`clearMessageEditsStateForThread`) as one call. The block wipe therefore needs only
    `clearMessages(directConversationId(peer))` followed by `clearDirectMessageContact(peer)` —
    NOT three separate calls. The DM storage key must be derived via
    `directConversationId(peerPubkeyHex)` (`directMessages.ts:48`), never hand-built.

## Technical Approach

### The enforcement surface (where the block bites) — §4 of the request

Every one of these sites must apply the composite gate. Missing any one re-opens the leak.

**Inbound — notification watcher** (`app/src/lib/directMessageNotifications.ts`, wired via
`DirectMessageNotificationsWatcher.tsx`): kind-4 handler and kind-1059 gift-wrap handler. A
blocked sender must be dropped **before** `rememberContact` and `incrementDirectMessage` — no
persisted message, no bell increment, no `lastSeen` bump. The block set is injected via a ref
tracking the current contacts store (same pattern as the allow accessor).

**Inbound — chat-view live/historical subscriptions**
(`app/src/components/contacts/ContactChat.tsx`, four ingestion sites: historical kind-4,
historical kind-1059, live kind-4, live kind-1059). Defensive: a blocked `ContactChat` is
normally never mounted, but these sites must still apply the composite gate so no path can
persist a blocked peer's message.

**Outbound / view — chat closed while blocked** (`app/pages/contacts.tsx` `ContactDetailView`
and the direct-URL route): render a **Blocked state** (banner + Unblock button, mirroring the
archived-notice) instead of the `ContactChat` composer. **Every send affordance must be
gated** — text send, image/attachment button, paste-to-send, drag-and-drop, reactions — per
the hard-won lesson in project memory `feedback_channel_reused_chat_gating`.

**Inbound — DM-profile heal channel (already gated; no change required).**
`app/src/components/ProfileHealWatcher.tsx` runs its own kind-1059 gift-wrap subscription
(inner rumor kinds 21061/21062), a fourth live inbound channel separate from the three above.
It **already** suppresses archived contacts via `passesDisclosureGate` /
`isActiveNonArchivedContact` (`app/src/lib/dmProfile/receive.ts:95-113`), built for ADR-007's
disclosure boundary. Since DD-1 makes `archivedAt` the single source of truth for "blocked,"
this channel is already correctly suppressed for a blocked contact — **no code change is
needed here.** It is named explicitly so the enforcement enumeration is exhaustive by
verification, not by accident. A story MUST include a defensive/regression assertion that a
blocked peer's heal-channel rumor is not persisted.

**Outbound — contact-establishment / pairing-echo path (added after S1 review).** Re-adding a
blocked contact by npub, or re-scanning their pairing card, must NOT emit any outbound signal
to the blocked peer. Today `processContactInput` treats the DD-9 `already_exists` result as a
returning contact: it imports the card profile and, for v2 pairing cards, emits a `pairingEcho`
that `pages/add.tsx` sends in the background — a gift-wrapped ack toward the blocked peer. Both
the per-story Opus reviewer and Codex (P1) independently flagged this as a live leak. Blocking
must suppress the profile import AND the pairing echo for a blocked peer (propagate the
`blocked: true` flag from `addContactByNpub`, or branch on the block-set). This enforces DD-2
(full cut-off, both directions) and §7 (blocked peer receives no signal). Owned by S4.

**View — history render** (`loadMessages`/`filterVisibleMessages` → `ChatBox`): after a block
the thread is deleted, so nothing renders; the render path must also treat a blocked peer as
"no visible history" defensively.

### History deletion on block — §5

Targeted single-peer wipe. Per DD-12, this is **two calls**, because `clearMessages`
(`chatPersistence.ts:552-575`) already internally drains in-flight `appendMessage` writes and
clears edit/delete aux state:
1. **Delete DM thread rows + aux state** — `clearMessages(directConversationId(peer))`. This
   drains in-flight writes (so a mid-flight write cannot resurrect the key), deletes
   `few:messages:dm:<peer>`, and clears edit/delete aux state, as one call.
2. **Clear unread counters + last-read** — `clearDirectMessageContact(peer)`.
3. **Retain the contact record** with `archivedAt` set (listable + unblockable).

The wipe must complete (or be safely queued) as part of the block action, not lazily. If the
history-delete write fails (storage unavailable/quota), the block must still take effect for
filtering — log, do not crash (mirror existing silent-failure handling in `contacts.ts`).

### Unblock (fresh thread) — §6

`unarchiveContact` clears `archivedAt`. The composite gate passes again; new inbound DMs flow,
ring, and persist normally. The deleted history does **not** return — unblock must not
re-fetch or resurrect old messages. No confirmation dialog.

### Relabeling (i18n) — §8

Update both `en` and `de` in `app/src/lib/i18n.ts` (no hardcoded strings):
`contacts.archiveAction` → "Block contact" / "Kontakt blockieren";
`contacts.unarchiveAction` → "Unblock contact" / "Kontakt entsperren";
`contacts.hiddenBadge` → "Blocked" / "Blockiert";
`contacts.archivedDetailNotice` → destructive-blocked notice;
hidden-filter controls (`hiddenFilterLabel`, `hideHiddenOption`, `showHiddenOption`,
`hiddenOnlyBody`) → "Blocked contacts" phrasing; **new** confirm-dialog copy (title + body +
confirm/cancel).

### Interaction with existing systems — §9

- Block is an additional deny layer AND-ed at each call site; never modifies the allow
  function. Deny overrides allow (a blocked peer who shares a group is still DM-filtered).
- Blocking does **not** remove the peer from `knownPeers` (keeps unblock simple).
- Stranger-purge sweeps key off `isAllowedDmSender` and are orthogonal — verify they neither
  delete a blocked-but-retained contact record nor resurrect a blocked peer's thread.

### Edge cases — §10

Mid-flight decrypt (drain before wipe); block while `ContactChat` open (transition to Blocked
state, tear down live subs); same-tick inbound (drop if blocked at ingestion; accept the race,
block-time wipe cleans up); unblock-then-receive (persists + rings); blocked peer in shared
group (group messages remain); confirm cancelled (no change); storage unavailable (filter
still takes effect).

### Privacy invariant (mandatory) — §7

No kind-0, no kind-10000, no public event as a side effect of block/unblock. Block state lives
only in `localStorage`; deleted history only ever existed in local idb-keyval. Before
implementation, confirm no added code path leaks the block set or deleted history to any
unaddressed audience.

## Stories (suggested split — planner finalizes)

1. **Block core: predicate + composite gate + block-set derivation + re-add guard.** Pure
   `isBlockedPeer`, block-set derivation from the contacts store, composite gate wrapper, and
   the DD-9 `addContactByNpub` change (stop auto-unblocking a blocked contact on re-add).
   Unit-testable foundation; keeps `isAllowedDmSender` pure. Owning module:
   walled-garden / blocklist / contacts.
2. **Inbound suppression at the notification watcher.** Apply the composite gate in
   `directMessageNotifications.ts` (both handlers) + inject the block set via
   `DirectMessageNotificationsWatcher.tsx`. Drop before remember/increment. Owning module:
   direct-message notifications.
3. **History wipe on block.** Single-peer wipe helper (thread rows + aux state + unread
   counters) with in-flight drain; wired into the block action. Storage-failure resilient.
   Owning module: chat persistence / block action.
4. **Blocked view, send-path gating, defensive ingestion, confirm dialog + action.** Blocked
   detail state, gate all five send paths + direct-URL route, defensive gates at the four
   ContactChat ingestion sites, confirmation dialog, `handleArchiveToggle` in `profile.tsx`.
   Owning module: contacts UI.
5. **Relabel (i18n).** en + de copy for block/blocked/unblock, blocked notice, hidden-filter
   controls, and confirm-dialog copy. Owning module: i18n.

## Non-Goals

- Group-level blocking, muting inside groups, or hiding group messages (DD-5).
- Any network broadcast of the block (NIP-51 mute list, kind-0, or any public event).
- Cross-device sync of block state.
- Blocking strangers (only existing contacts are blockable).
- A permanent blocked-stranger registry — only messages/counters are deleted, never the
  contact record.


## Amendments

**2026-07-14 — Enforcement surface completed after pre-commit cross-model (Fable) review.**
The independent whole-tree review found three outbound signals to a blocked peer that the
per-story reviews (scoped to each story's diff) could not see, because they live on
CROSS-EPIC seams. The DM-only §4 enumeration was therefore incomplete. All are now gated on
the block (§7 / DD-2 — a blocked peer receives no signal):
- **Pairing-ack issuer push** (`pairingAck.ts` Step 10/11) — `sendProfileAnnounce` + name-cache
  on re-pairing admission now skipped for a blocked sender (admission itself unchanged).
- **Pending pairing-echo drain** (`pendingIntent.ts` `processIntentCore`) — now checks the
  block set at SEND time (not just queue time) and drops a `droppedBlocked` intent (TOCTOU fix).
- **Feedback route** (`feedback.tsx`) — a second, previously-ungated `ContactChat` mount for the
  maintainer; now renders the Blocked notice when the maintainer is blocked.

**DD-12 amended:** the wipe is now THREE deletions — `clearMessages` + `clearDirectMessageContact`
+ `clearDmReactionsForPeer` (deletes `few:reactions:dm:<peer>`). DM reaction aggregates are DM
history under DD-3 and must not survive a block.

**AC-VIEW-14 hardened:** the ingestion gate (`shouldIngestDmFromSender`) now consults
`loadBlockedPeers()` directly as a synchronous authoritative backstop, closing the
effect-flush ref-staleness race deterministically (not merely near-zero).

**Migration cohort (requester decision 2026-07-14):** contacts hidden BEFORE this epic keep
their DM history (no retroactive wipe) — the old Hide promised no data loss. Only new blocks
wipe. Stale-unread-badge cleanup for that cohort is a tracked follow-up (BACKLOG:
one-time-migration-clear-stale-unread). Incoming CALLS are intentionally NOT block-gated this
epic (BACKLOG: gate-incoming-calls-with-block-deny); calls are currently disabled.
