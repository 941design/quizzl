# Feature Specification Request: Block Contact (upgrade "Hide" to a real block)

> **Status:** request / pre-spec. Hand to `/base:feature` to produce the
> implementation spec + acceptance criteria.
>
> **Requester decisions are locked** (see §1.1). The single most important one:
> this feature **does not add a new concept** — it gives the *existing* "Hide
> contact" action teeth. "Hidden" becomes synonymous with "blocked" /
> "ignored". Search "DECISION:" for the specific locked choices.

## 1. Intent

Today the app has a **cosmetic "Hide contact"** action (internally `archiveContact`,
`app/src/lib/contacts.ts:115`; user-facing "Hide contact" / "Hidden",
`app/src/lib/i18n.ts:883`). Hiding only removes a contact from the default list
view — it is described to the user as exactly that: *"This contact is hidden
from the default list view until you unarchive them."* (`i18n.ts:845`).

Critically, **hiding does nothing to stop that contact**:

- their direct messages still arrive, decrypt, and persist to local storage;
- the notification bell still rings for them (`incrementDirectMessage`,
  `app/src/lib/directMessageNotifications.ts:88`/`131`);
- their full chat history remains readable.

This feature closes that gap. After this change, **hiding a contact is a real
block**: their DMs are filtered out entirely, their stored chat history is
deleted, the bell never rings for them, and you cannot send to them while they
are blocked. Unblocking (the existing "unhide") restores the ability to
converse — but on a **fresh, empty thread**, because the old history was
deleted.

### 1.1 Locked product decisions (from the requester)

1. **DECISION — Upgrade, don't add.** There is no new state or new toggle. The
   existing hide/unhide mechanism *is* the block/unblock mechanism. A contact
   with `archivedAt != null` is a **blocked** contact. Blocking = hiding;
   unblocking = unhiding.
2. **DECISION — Full cut-off, both directions.** While a contact is blocked you
   cannot open their chat or send them a DM, and none of their inbound DMs reach
   you. The conversation is closed in both directions.
3. **DECISION — Delete history on block.** Blocking permanently deletes the
   locally stored DM history for that contact. It is not merely hidden from
   view; the rows are removed from storage.
4. **DECISION — Reversible to a fresh thread.** Unblocking is allowed and
   restores messaging. Because history was deleted, the conversation restarts
   empty — old messages do **not** come back.
5. **DECISION — DMs only.** Blocking affects **1:1 direct messages only**.
   Shared MLS group chats are untouched: a blocked contact who is also a group
   member still appears in that group and their group messages still show. This
   feature never touches group membership, group invites, or group message
   rendering.
6. **DECISION — Confirm before blocking.** Because blocking irreversibly deletes
   history, the action shows a confirmation dialog first. (Unblocking needs no
   confirmation — it is non-destructive.)
7. **DECISION — Relabel to "Block".** The user-facing wording changes from
   "Hide contact" / "Hidden" to **"Block" / "Blocked" / "Unblock"** (English and
   German), because "Hide" no longer describes what the action does. The
   internal identifier (`archivedAt`, `archiveContact`) MAY stay as-is to
   minimise churn; only the surfaced copy and any user-visible `data-testid`
   labels need to reflect "block".

### 1.2 Outcome (behaviour)

- You block someone. Their conversation vanishes from your list and its history
  is erased from your device.
- From that moment, anything they send you is silently discarded — no message,
  no notification, no unread badge, no "last seen" bump on their contact card.
- You cannot re-open the chat or message them until you unblock.
- You unblock them. Messaging works again, starting from an empty thread. The
  erased history stays erased.

### 1.3 Non-goals (this iteration)

- **No group-level blocking.** Suppressing a person inside shared MLS groups,
  blocking group invites from them, or hiding their group messages is explicitly
  out of scope (DECISION 5).
- **No network broadcast of the block.** See §7 — the block is purely local. We
  do **not** publish a NIP-51 mute list (kind-10000) or any other public event.
  This is mandatory under the project privacy invariant (`CLAUDE.md`).
- **No cross-device sync.** Block state lives in `localStorage` (`lp_contacts_v1`),
  per device, exactly like today's archive flag. A block set on device 1 does
  not propagate to device 2. Stated as a known limitation, not a surprise.
- **No blocking of strangers.** You can only block an existing contact (the
  action lives on a contact/profile you already have). Genuine strangers are
  already filtered by the inbound walled garden (`isAllowedDmSender`) and need
  no separate block.
- **No "delete but keep as blocked-stranger forever" registry.** The contact
  entry itself is retained (archived), so the person remains listable under
  "show hidden/blocked" and can be unblocked. Only their *messages/counters* are
  deleted, not their contact record.

---

## 2. Behaviour changes & consequences (read first)

Overloading the existing "Hide" with destructive blocking semantics has
first-order consequences the requester has accepted, and they must be visible in
the eventual UI:

| Before this change | After this change |
|---|---|
| "Hide contact" declutters the list only. | "Block" filters DMs, deletes history, silences the bell, and cuts off sending. |
| Hiding is instant and safe (reversible with no data loss). | Blocking is instant but **destructive**; a confirmation dialog guards it. |
| A hidden contact's chat is still openable and their DMs still flow. | A blocked contact's chat is not openable; their DMs are dropped. |
| Unhide fully restores the prior state. | Unblock restores messaging but **not** the deleted history (fresh thread). |
| Label: "Hide contact" / "Hidden". | Label: "Block" / "Blocked" / "Unblock". |

Anyone who used "Hide" purely to tidy their list will find the action now cuts
the person off and erases the conversation. That is the intended new meaning
(DECISION 1). The confirmation dialog (DECISION 6) and relabel (DECISION 7) exist
specifically so this is not a silent surprise.

---

## 3. Terminology

- **Blocked contact** — a contact whose stored record has `archivedAt != null`.
  Synonyms used interchangeably in the original request: *ignored*, *hidden*.
  The single source of truth is the `archivedAt` field on `StoredContact`
  (`app/src/lib/contacts.ts:9`).
- **Block set** — the set of lowercase-hex pubkeys of all currently blocked
  contacts, derived from the contacts store. Used as a synchronous deny-list at
  every inbound and outbound gate (§4).
- **DM thread id / storage key** — `dm:<peerHexLower>` →
  `few:messages:dm:<peerHexLower>` in idb-keyval
  (`directConversationId`, `app/src/lib/directMessages.ts:48`;
  `storageKey`, `app/src/lib/marmot/chatPersistence.ts:48`).

---

## 4. The enforcement surface (where the block bites)

The block is a **deny-list that overrides the existing allow-list**. The current
inbound gate is `isAllowedDmSender` (`app/src/lib/walledGarden.ts:53`), a pure,
synchronous, storage-free function (its purity is a hard invariant — AC-SEC-13).
Blocking must **not** be folded into that function's body (it would break the
storage-free invariant). Instead:

- **DD-1.** Add a separate pure predicate, e.g. `isBlockedPeer(peerHex,
  blockedPeers: ReadonlySet<string>)`, and a composite gate used at every call
  site: **allowed = `isAllowedDmSender(...)` AND NOT `isBlockedPeer(...)`**. Deny
  wins over allow. The `blockedPeers` set is computed by the caller from the
  contacts store (the same shape as `knownPeers` is threaded today), keeping the
  pure functions pure.

Every one of the following sites must apply the composite gate. Missing any one
re-opens the leak.

### 4.1 Inbound — notification watcher (bell rings even with no chat open)

`app/src/lib/directMessageNotifications.ts` — the always-on pipeline behind
`DirectMessageNotificationsWatcher`:

- kind-4 handler (`:79`–`:95`), gate currently at `:85`.
- kind-1059 gift-wrap handler (`:107`–`:143`), gate currently at `:126`.

A blocked sender must be dropped **before** `rememberContact` and
`incrementDirectMessage` — so: no persisted message, no bell increment, no
`lastSeen` bump. The block set is injected the same way the allow accessor is
today (`DirectMessageNotificationsWatcher.tsx:54`), via a ref that tracks the
current contacts store.

### 4.2 Inbound — chat-view live/historical subscriptions

`app/src/components/contacts/ContactChat.tsx` — four ingestion sites
(historical kind-4 `:492`, historical kind-1059 `:559`, live kind-4 `:649`, live
kind-1059 `:690`). In normal operation a blocked contact's `ContactChat` is
never mounted (the chat is not openable, §4.3), but these sites must still apply
the composite gate defensively so no path can persist a blocked peer's message.

### 4.3 Outbound / view — the chat is closed while blocked

When a contact is blocked, the app must not let you open or send:

- **Route/detail gate.** `ContactDetailView` (`app/pages/contacts.tsx:255`) and
  the direct-URL route (`/contacts?id=<peerHex>`): if the contact is blocked,
  render a **"Blocked" state** (banner + Unblock button, mirroring the existing
  archived-notice at `contacts.tsx:350`) instead of the `ContactChat` composer.
- **Every send path gated, not just the text box.** Per prior hard-won
  experience (project memory `feedback_channel_reused_chat_gating`), when a chat
  view is reused for a restricted channel, *every* send affordance must be
  gated, or a bypass slips through: the text send, the **image/attachment
  button**, **paste-to-send**, **drag-and-drop**, and **reactions**. The
  acceptance criteria must enumerate each one, plus the direct-URL entry.

### 4.4 View — history render

`loadMessages`/`filterVisibleMessages` feeding `ChatBox`. After a block the
thread is deleted (§5), so there is nothing to render; but the render path must
also treat a blocked peer as "no visible history" defensively.

---

## 5. History deletion on block

Blocking a contact performs a **targeted, single-peer wipe** — the per-peer
analogue of the existing stranger-purge sweep (`purgeStrangerDmThreads`,
`chatPersistence.ts:611`, which already documents the correct in-flight-write
drain + aux-state cleanup pattern). Concretely, on block:

1. **Delete the DM thread rows.** `clearMessages('dm:<peerHexLower>')`
   (`chatPersistence.ts:553`) — removes `few:messages:dm:<peer>` from idb-keyval.
   Must drain in-flight `appendMessage` writes first (the sweep at `:634`–`:648`
   shows the required ordering) so a mid-flight write cannot resurrect the key.
2. **Delete edit/delete aux state.** `clearMessageEditsStateForThread(...)`
   (`chatPersistence.ts:660`) — a blocked peer's buffered edit/delete signals
   must not survive (privacy-relevant, same rationale as the sweep at `:650`).
3. **Clear unread counters + last-read.** `clearDirectMessageContact(peer)`
   (`app/src/lib/unreadStore.ts:367`-area) so no stale badge lingers on the bell.
4. **Retain the contact record**, with `archivedAt` set — so the contact stays
   listable under "show blocked" and is unblockable. Only messages/counters are
   deleted, never the contact entry itself (§1.3).

This wipe must complete (or be safely queued) as part of the block action, not
lazily, so history is gone immediately from the user's perspective.

---

## 6. Unblock (fresh thread)

Unblocking = `unarchiveContact` (`contacts.ts:127`) clears `archivedAt`.
Consequences:

- The composite gate now passes for that peer again (they are no longer in the
  block set; they remain in `knownPeers`/groups as before, so `isAllowedDmSender`
  still admits them).
- Their new inbound DMs flow, ring the bell, and persist normally.
- **The deleted history does not return.** The thread starts empty. Unblock must
  not attempt to re-fetch or resurrect old messages.
- No confirmation dialog (non-destructive).

---

## 7. Privacy invariant (mandatory)

Per `CLAUDE.md`, profile/state must never be broadcast to public relays. The
block is **entirely local**:

- No NIP-51 mute list (kind-10000) is published. No kind-0. No public event of
  any kind is emitted as a side effect of blocking or unblocking.
- The blocked person receives **no signal** that they were blocked (Nostr has no
  delivery receipt; their gift-wrapped events are simply ignored on arrival).
- Block state lives only in `localStorage` (`lp_contacts_v1`) and the deleted
  history only ever existed in local idb-keyval.

Before implementation, confirm no code path added by this feature publishes,
syncs, or leaks the block set or the deleted history to any unaddressed
audience.

---

## 8. Relabeling (i18n)

Update **both** `en` and `de` (`app/src/lib/i18n.ts`) — no hardcoded strings in
components (project rule). At minimum:

- `contacts.archiveAction` "Hide contact" → **"Block contact"** / de: "Kontakt
  blockieren".
- `contacts.unarchiveAction` "Unarchive contact" → **"Unblock contact"** / de:
  "Kontakt entsperren".
- `contacts.hiddenBadge` "Hidden" → **"Blocked"** / de: "Blockiert".
- `contacts.archivedDetailNotice` → a **destructive-blocked** notice, e.g.
  "You have blocked this contact. Their messages are filtered and your
  conversation history was deleted." (+ de).
- The hidden-filter controls (`hiddenFilterLabel`, `hideHiddenOption`,
  `showHiddenOption`, `hiddenOnlyBody`) → "Blocked contacts" phrasing (+ de).
- **New**: confirmation-dialog copy (title + body + confirm/cancel) warning that
  blocking deletes the conversation history and blocks the person (+ de).

`data-testid`s referenced by e2e (`profile-archive`, `contact-archived-alert`)
MAY keep their identifiers to avoid churning tests, but the eventual spec should
decide whether to rename them to `-block` for clarity; if kept, note the naming
mismatch so it is intentional, not accidental.

---

## 9. Interaction with existing systems

- **Walled garden (`isAllowedDmSender`).** Block is an *additional* deny layer,
  applied as a logical AND at each call site (§4, DD-1). It never modifies the
  allow function. Deny overrides allow: a blocked peer who shares a group (and
  would otherwise be allowed) is still filtered on the DM channel.
- **Known-peers registry (`lp_knownPeers_v1`).** Blocking does **not** remove the
  peer from `knownPeers`. This keeps unblock simple (they remain a known peer, so
  DMs flow again immediately after unblock). It also means blocking is not a way
  to make someone a permanent stranger — it is a reversible deny, matching the
  reversible hide it replaces.
- **Stranger-purge sweeps.** The existing sweeps
  (`purgeStrangerContacts`, `purgeStrangerDmCounters`, `purgeStrangerDmThreads`)
  key off `isAllowedDmSender` and are orthogonal — they garbage-collect
  *strangers*, not *blocked contacts* (a blocked contact is retained by design,
  §5.4). Verify the sweeps do not accidentally delete a blocked-but-retained
  contact record, and do not accidentally *resurrect* a blocked peer's thread.
- **Contact pairing / walled-garden admission.** If a blocked contact later
  pairs again (e.g. scans a fresh pairing code), the block (a set deny) still
  wins until explicitly unblocked. The eventual spec should state whether a new
  pairing silently stays blocked (recommended — deny is explicit user intent) or
  surfaces a prompt. Default: stays blocked, no prompt.

---

## 10. Edge cases to resolve in the spec

1. **Block while a message from them is mid-flight / mid-decrypt.** The in-flight
   write must be drained before the thread delete (§5.1) so it cannot re-create
   the thread after wipe.
2. **Block while their `ContactChat` is open** (you block from the profile with
   the chat mounted elsewhere, or via the detail view). The open view must
   transition to the "Blocked" state and tear down its live subscriptions.
3. **Incoming DM arrives in the same tick as the block toggles.** The gate reads
   the current block set; define that a message is dropped if the peer is blocked
   at ingestion time. Accept the inherent race (a message decrypted one tick
   before the block lands may persist); the block-time wipe (§5.1) removes it.
4. **Unblock then immediately receive.** New inbound after unblock must persist
   and ring — verifies the gate re-opens and no stale suppression lingers.
5. **Blocked contact also in a shared group.** Their group messages remain
   visible; only the 1:1 DM channel is filtered (DECISION 5). Explicit test.
6. **Confirmation dialog dismissed/cancelled.** No state change, no deletion.
7. **Storage unavailable / quota.** Block must still take effect for filtering
   even if the history-delete write fails; log, do not crash (mirror existing
   silent-failure handling in `contacts.ts`).

---

## 11. Acceptance-criteria seeds (E2E must publish *through the app*)

Per the project e2e rule (`CLAUDE.md`, project memory
`feedback_e2e_no_direct_relay`), peer sends must go through the app's publish
helpers (`publishDirectMessage`), never raw WebSocket to strfry. Seed scenarios:

- **AC — Block wipes history.** A and B exchange DMs (both via the app). A blocks
  B. Assert: A's `few:messages:dm:<B>` thread is gone from idb; the chat is not
  openable; B's unread badge is cleared from the bell.
- **AC — Inbound filtered, no bell.** With B blocked, B sends a DM via the app.
  Assert: A's bell does **not** increment; nothing is persisted for B; B's
  contact `lastSeen` is unchanged.
- **AC — Send cut off (all paths).** With B blocked, A cannot send via text,
  image button, paste, drop, or reactions, and the direct URL
  `/contacts?id=<B>` shows the Blocked state, not a composer.
- **AC — Unblock → fresh thread.** A unblocks B. Assert: thread is empty (old
  history did not return); B sends a new DM via the app → it is delivered, rings
  the bell, and appears in the thread.
- **AC — Confirmation guards block.** Triggering block shows the confirm dialog;
  cancelling makes no change; confirming performs the wipe.
- **AC — DMs-only scope.** A and B share a group. A blocks B. Assert: B's group
  messages still render in the group; only the 1:1 DM is filtered.
- **AC — Relabel.** English and German surfaces show "Block" / "Blocked" /
  "Unblock" wording, not "Hide" / "Hidden".
- **AC — No broadcast.** Blocking/unblocking publishes no kind-0, no kind-10000,
  and no public event (privacy invariant).

---

## 12. Affected files (map for the implementer)

| Concern | File(s) |
|---|---|
| Block state (data model) | `app/src/lib/contacts.ts` (`StoredContact.archivedAt`, `archiveContact`/`unarchiveContact`; add block-set derivation + `isBlockedPeer` helper — or a new small `blocklist.ts`) |
| Composite gate | `app/src/lib/walledGarden.ts` (keep pure; add composite wrapper OR new predicate module) |
| Inbound bell suppression | `app/src/lib/directMessageNotifications.ts`, `app/src/components/DirectMessageNotificationsWatcher.tsx` |
| Inbound chat ingestion (defensive) | `app/src/components/contacts/ContactChat.tsx` |
| History wipe on block | `app/src/lib/marmot/chatPersistence.ts` (`clearMessages`, `clearMessageEditsStateForThread`), `app/src/lib/unreadStore.ts` (`clearDirectMessageContact`) |
| Blocked view + send-path gating | `app/pages/contacts.tsx` (`ContactDetailView`), `app/src/components/contacts/ContactChat.tsx` (composer, image, paste, drop, reactions) |
| Block/unblock action + confirm dialog | `app/pages/profile.tsx` (`handleArchiveToggle`, button at `:583`; add confirmation) |
| Copy | `app/src/lib/i18n.ts` (en + de) |

---

## 13. Open questions for the spec author

1. **`data-testid` rename?** Keep `profile-archive` / `contact-archived-alert`
   (less test churn) or rename to `-block` (clarity)? Default: keep, note the
   mismatch as intentional.
2. **Block-set plumbing.** Derive the block set inline at each call site from the
   contacts store, or thread it through a context/ref like `knownPeers` is today?
   Prefer the latter for consistency with the existing walled-garden wiring.
3. **Confirmation component.** Is there an existing confirm-dialog primitive to
   reuse, or does one need adding? (Check the components used elsewhere for
   destructive actions before introducing a new modal.)
