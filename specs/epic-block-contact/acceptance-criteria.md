# Block Contact — Acceptance Criteria

## Terminology

- **`StoredContact`** — the persisted contact record shape in `lp_contacts_v1` (`app/src/lib/contacts.ts`), with fields `pubkeyHex`, `firstSeenAt`, `lastSeenAt`, `archivedAt`.
- **Blocked** — a `StoredContact` whose `archivedAt` is non-null (DD-1). "Block" and "archive" refer to the same underlying state after this epic; "Unblock" and "unarchive" likewise.
- **`blockedPeers`** — the `ReadonlySet<string>` of lowercase-hex pubkeys derived from every `StoredContact` with a non-null `archivedAt`, re-derived on each block/unblock (block-revision bump).
- **Composite gate** — `isAllowedDmSender(peerHex, groups, knownPeers, ownPubkeyHex) AND NOT isBlockedPeer(peerHex, blockedPeers)`, applied at every inbound/outbound DM enforcement site (DD-8).
- **Block action** — the user-triggered flow (post-confirmation) that calls `archiveContact`, wipes the peer's DM history, and bumps the block revision.
- **Direct-URL route** — `/contacts?id=<peerHex>` (query-param based per the project's static-export convention).
- **Five send affordances** — text send (Enter/send-button), image/attachment button, paste-to-send, drag-and-drop, reactions — the five paths enumerated in `feedback_channel_reused_chat_gating`.

## Known TAGs

- **CORE** — pure predicate, composite gate, block-set derivation, re-add guard.
- **INBOUND** — notification-watcher inbound suppression.
- **WIPE** — single-peer history deletion on block.
- **VIEW** — Blocked detail state, send-path gating, defensive ingestion.
- **CONFIRM** — block confirmation dialog.
- **UNBLOCK** — fresh-thread behavior on unblock.
- **PRIV** — no public broadcast (privacy invariant).
- **COPY** — en/de relabel copy.
- **SCOPE** — DMs-only; groups untouched.

## Block Core: Predicate, Composite Gate, Block-Set Derivation, Re-Add Guard (S1)

**AC-CORE-1** — `isBlockedPeer(peerHex, blockedPeers)` MUST return `true` when the lowercased `peerHex` is a member of `blockedPeers`, and `false` otherwise. Its body MUST NOT read `localStorage`, IDB, or any React state.

**AC-CORE-2** — The block-set reader MUST derive `blockedPeers` as the set of lowercase `pubkeyHex` values from every `StoredContact` in `readStoredContacts()` whose `archivedAt` is non-null. A contact newly archived via `archiveContact` MUST appear in the next derivation; a contact newly unarchived via `unarchiveContact` MUST NOT.

**AC-CORE-3** — The composite gate `isAllowedDmSender(peerHex, groups, knownPeers, ownPubkeyHex) AND NOT isBlockedPeer(peerHex, blockedPeers)` MUST evaluate to `false` for a peer that is simultaneously an allowed sender (shares a group or is in `knownPeers`) and present in `blockedPeers` — deny overrides allow.

**AC-CORE-4** (AC-SEC-13 preservation) — `isAllowedDmSender` MUST remain synchronous and free of any IDB, NDK, React, or `localStorage` access inside its own body after this epic. `isBlockedPeer` MUST be exported as a separate function and MUST NOT be called from within `isAllowedDmSender`'s body (DD-8) — the composite is assembled only at call sites.

**AC-CORE-5** (DD-9 re-add guard) — Calling `addContactByNpub(npub, ownPubkeyHex)` for an npub that decodes to an existing `StoredContact` with `archivedAt != null` MUST NOT clear that contact's `archivedAt`: a subsequent `readStoredContacts()` call MUST show `archivedAt` unchanged from its pre-call value, and the result MUST NOT report `reactivated: true` for this case. The composite gate MUST continue to return `false` for that peer immediately after the call — no DM channel MUST become reachable (no `ContactChat` mount, no direct-URL route serving the composer) as a consequence of the re-add.

**AC-CORE-6** — Block-set derivation MUST lowercase-normalize every candidate pubkey defensively, without relying on `lp_contacts_v1` keys or `StoredContact.pubkeyHex` already being lowercase. A contact record stored under a mixed-case key with `archivedAt` set MUST still be represented in `blockedPeers` in lowercase form, and `isBlockedPeer` lookups MUST match regardless of the input pubkey's case.

## Inbound Suppression — Notification Watcher (S2)

**AC-INBOUND-1** — For a kind-4 DM event whose sender (case-insensitive) is in `blockedPeers`, the kind4Handler inside `subscribeDirectMessageNotifications` (`app/src/lib/directMessageNotifications.ts`) MUST return before calling `rememberContact` or `incrementDirectMessage`. After the event is processed: the peer's unread/notification-bell count MUST NOT increment, and the peer's `lastSeenAt` in `lp_contacts_v1` MUST NOT change.

**AC-INBOUND-2** — The same suppression MUST hold for the kind-1059 gift-wrap handler: for an unwrapped rumor whose sender is in `blockedPeers`, the handler MUST return before calling `rememberContact` or `incrementDirectMessage` — no bell increment, no `lastSeenAt` change.

**AC-INBOUND-3** — The `isAllowedSender` callback injected into `subscribeDirectMessageNotifications` via `DirectMessageNotificationsWatcher.tsx` MUST be the composite gate (`isAllowedDmSender AND NOT isBlockedPeer`), sourced from a ref that refreshes on block-revision change. A peer blocked while the watcher is already mounted MUST be suppressed on the very next inbound event for that peer, without requiring the watcher to unmount/remount or the page to reload.

**AC-INBOUND-4** (heal-channel regression) — `ProfileHealWatcher`'s kind-1059 subscription (inner rumor kinds 21061/21062) MUST NOT persist a rumor from a peer with `archivedAt != null`. `passesDisclosureGate` / `isActiveNonArchivedContact` (`app/src/lib/dmProfile/receive.ts:95-113`) MUST continue to return `false` for such a peer after this epic — verified by a regression test that archives a contact and asserts `passesDisclosureGate` rejects a rumor from that contact's pubkey.

## History Wipe on Block (S3)

**AC-WIPE-1** — The block action MUST call `clearMessages(directConversationId(peerPubkeyHex))`. After a successful block, the idb-keyval record at key `few:messages:dm:<peerHexLower>` MUST be absent (a `readIdbRecord` lookup on `keyval-store`/`keyval` returns null/undefined).

**AC-WIPE-2** — The block action MUST call `clearDirectMessageContact(peerPubkeyHex)`. After a successful block, the unread counter and last-read timestamp for that peer MUST be cleared, and the notification-badge count attributable to that peer MUST be zero.

**AC-WIPE-3** — The block action MUST NOT delete the `StoredContact` record. After block, `readStoredContacts()` MUST still contain an entry for `peerPubkeyHex`, with `archivedAt` set to a non-null timestamp.

**AC-WIPE-4** — The history wipe MUST derive its storage key exclusively via `directConversationId(peerPubkeyHex)`. No code path introduced by this epic MUST hand-build a `dm:<peer>`-shaped string literal for the wipe.

**AC-WIPE-5** (storage-failure resilience) — If `clearMessages` or `clearDirectMessageContact` throws (simulated storage-quota failure), the block action MUST still set `archivedAt` on the contact record, and the composite gate MUST still return `false` for that peer immediately afterward — a wipe failure MUST NOT prevent the block from taking filtering effect, and MUST NOT throw out of the block action.

**AC-WIPE-6** (in-flight drain) — An `appendMessage` write in flight for `dm:<peer>` at the moment block is triggered MUST NOT resurrect the thread key after `clearMessages` completes. After the block action settles, the idb-keyval record for that thread MUST remain absent even if the in-flight write resolves after the clear call started.

## Blocked View, Send-Path Gating, Defensive Ingestion (S4)

**AC-VIEW-1** — `ContactDetailView` (`app/pages/contacts.tsx`) for a contact with `archivedAt != null` MUST render a Blocked banner (mirroring `contact-archived-alert`, DD-10) in place of `ContactChat`'s composer. The composer's text input, send button, and image-attachment button MUST NOT be present in the rendered output.

**AC-VIEW-2** (text send path) — While a contact is blocked, no user interaction with the (absent) composer's text input or send button MUST result in `sendMessage` being invoked — no new kind-14/kind-1059 DM event MUST be published to that peer.

**AC-VIEW-3** (image/attachment send path) — While a contact is blocked, the image/attachment button MUST NOT be reachable in the rendered view — `sendImageMessage` MUST NOT be invocable, and no image-attachment event MUST be published.

**AC-VIEW-4** (paste-to-send path) — While a contact is blocked, a paste event targeting the contact detail view MUST NOT invoke `handlePaste`'s send path — no image message MUST be published as a result.

**AC-VIEW-5** (drag-and-drop path) — While a contact is blocked, a drop event targeting the contact detail view MUST NOT invoke `handleDrop`'s send path — no image message MUST be published as a result.

**AC-VIEW-6** (reactions path) — While a contact is blocked, no reaction affordance (`EmojiReactionPicker`, `ReactionBadgeRow`) MUST be rendered, and `handleReact` MUST NOT be invocable from the rendered view.

**AC-VIEW-7** (direct-URL route) — Navigating directly to `/contacts?id=<blockedPeerHex>` (no prior in-app navigation) MUST render the same Blocked state as AC-VIEW-1 on first render — the composer and all five send affordances (AC-VIEW-2 through AC-VIEW-6) MUST be absent immediately, not only after a subsequent re-render.

**AC-VIEW-8** (defensive ingestion — historical kind-4) — `ContactChat`'s historical kind-4 ingestion handler MUST NOT persist a message via `ingestEvent` when the composite gate rejects the sender, even if `ContactChat` is somehow mounted for a blocked peer.

**AC-VIEW-9** (defensive ingestion — historical kind-1059) — The same non-persistence MUST hold for `ContactChat`'s historical gift-wrap ingestion handler: a rumor from a peer the composite gate rejects MUST NOT be applied via `applyInboundRumor`/`upsertMessages`.

**AC-VIEW-10** (defensive ingestion — live kind-4) — The same non-persistence MUST hold for `ContactChat`'s live kind-4 subscription handler.

**AC-VIEW-11** (defensive ingestion — live kind-1059) — The same non-persistence MUST hold for `ContactChat`'s live gift-wrap subscription handler.

**AC-VIEW-12** (history render) — After a contact is blocked and its history wiped (AC-WIPE-1), `loadMessages`/`filterVisibleMessages` for that peer MUST return zero visible messages, and `ChatBox` MUST render no message rows for that peer even if a stray write occurs.

## Confirmation Dialog (S4)

**AC-CONFIRM-1** — Clicking the block action button MUST open a confirmation modal (Chakra `Modal` + `useDisclosure`, mirroring `LeaveGroupButton`'s destructive-action pattern, DD-11) before `archiveContact` is called — `archiveContact` MUST NOT be invoked as a direct result of the initial button click alone.

**AC-CONFIRM-2** — Confirming the modal's destructive confirm button MUST invoke `archiveContact`, followed by the history wipe (AC-WIPE-1, AC-WIPE-2) and the block-revision bump. Cancelling the modal (or dismissing it) MUST leave `archivedAt` unchanged and MUST NOT invoke `clearMessages` or `clearDirectMessageContact`.

## Cross-Cutting Invariants

**AC-UNBLOCK-1** — Calling `unarchiveContact(peerPubkeyHex)` MUST clear `archivedAt` to `null`. After unblock, the composite gate MUST return the same value `isAllowedDmSender` alone would return for that peer (deny no longer applies).

**AC-UNBLOCK-2** — Unblock MUST NOT re-fetch, restore, or resurrect any message deleted at block time. After unblock, `loadMessages` for that peer MUST return an empty thread until a new message is sent or received.

**AC-UNBLOCK-3** — After unblock, the next inbound DM from that peer MUST be persisted and MUST increment the notification bell — the composite gate no longer rejects the peer, so `rememberContact`/`incrementDirectMessage` MUST run for that event.

**AC-UNBLOCK-4** — Unblock MUST NOT show a confirmation dialog. Clicking Unblock MUST call `unarchiveContact` directly, with no intermediate confirm step (DD-6).

**AC-PRIV-1** — Blocking a contact MUST NOT publish a kind-0 event. A publish-call spy attached during the block action MUST record zero kind-0 publishes.

**AC-PRIV-2** — Neither blocking nor unblocking a contact MUST publish a kind-10000 (NIP-51 mute list) event. A publish-call spy attached during either action MUST record zero kind-10000 publishes.

**AC-PRIV-3** — Neither block nor unblock MUST publish any Nostr event of any kind to any relay. A publish-call spy attached across both actions MUST record zero calls; the only observable side effects MUST be `localStorage` writes to `lp_contacts_v1` and local idb-keyval deletions (AC-WIPE-1, AC-WIPE-2).

**AC-SCOPE-1** — A contact who shares an MLS group with the local user and is also blocked (`archivedAt != null`) MUST still appear as a member in that group's view, and messages that contact sends into the shared group MUST still render in the group chat.

**AC-SCOPE-2** — Blocking a contact MUST NOT remove that peer from `knownPeers`. `knownPeers` set membership MUST be unchanged immediately after a block action (§9).

**AC-SCOPE-3** — `purgeStrangerContacts`, `purgeStrangerDmCounters`, `purgeStrangerDmThreads`, and `purgeStrangerDmReactions` MUST NOT delete a blocked-but-retained `StoredContact` record, and MUST NOT resurrect a blocked peer's deleted DM thread. A sweep run immediately after a block action MUST leave the `StoredContact` entry (with `archivedAt` set) intact and the wiped thread key absent, not repopulated.

**AC-VIEW-13** (outbound pairing-echo / profile-import suppression; added after S1 cross-vendor review — Opus + Codex P1) — Re-adding a blocked contact by npub, OR re-scanning that blocked contact's pairing card, MUST NOT emit any outbound Nostr event to the blocked peer and MUST NOT import their card profile. Concretely: when `addContactByNpub` returns `blocked: true` (the DD-9 `already_exists` archived-match branch), `processContactInput` MUST NOT import the card profile and MUST NOT produce a `pairingEcho`, and `pages/add.tsx` MUST NOT dispatch `attemptOrQueuePairingEcho` for that peer. A publish-call spy attached across the re-add/re-scan flow MUST record zero outbound publishes toward the blocked peer, and `archivedAt` MUST remain set. This enforces DD-2 (full cut-off, both directions) and §7 (no signal to the blocked peer).

**AC-VIEW-14** (post-block wipe race; added after S3 review — Opus sev-4) — A DM from the just-blocked peer arriving immediately AFTER the block action's history wipe MUST NOT resurrect the wiped thread. The block action MUST order operations so the composite gate is live before/atomic with the wipe: set `archivedAt` and bump the block revision (and, if the peer's `ContactChat` is mounted, transition it to the Blocked state tearing down its live subscriptions) BEFORE or atomically with `wipeSinglePeerHistory`, so no post-wipe `appendMessage` for the blocked peer can be enqueued. Verified by an integration/e2e assertion: block a peer with an inbound message racing the block; after settle, `few:messages:dm:<peer>` MUST be absent.


**AC-PRIV-4** (pairing-ack issuer push, added 2026-07-14 post-review) — When a BLOCKED contact re-pairs and their ack is admitted, `handlePairingAck` MUST NOT call `sendProfileAnnounce` to that sender and MUST NOT persist their submitted name to contactCache. A publish/announce spy MUST record zero outbound events toward the blocked sender; admission (archivedAt preserved) is unchanged.

**AC-PRIV-5** (pending pairing-echo drain, added 2026-07-14 post-review) — A pending pairing-echo intent whose issuer is blocked at SEND time (blocked after the intent was queued) MUST be dropped (`droppedBlocked`) and MUST NOT dispatch `sendPairingAck` (echo + profile announce). A publish spy MUST record zero outbound events toward the blocked issuer, including while the intent was still nameless.

**AC-VIEW-15** (feedback route, added 2026-07-14 post-review) — The `/feedback` route MUST render a Blocked notice (not the `ContactChat` composer) when `MAINTAINER_ACTIVE_PUBKEY_HEX` is blocked, reactive to block-revision. No send affordance (text/image/paste/drop/reactions) MUST be reachable to a blocked maintainer via the feedback route.

**AC-WIPE-7** (reaction-aggregate deletion, added 2026-07-14 post-review) — `wipeSinglePeerHistory` MUST delete the DM reaction aggregate `few:reactions:dm:<peerHexLower>` (via `clearDmReactionsForPeer`) in addition to the thread rows and unread counters. After a block, that key MUST be absent from idb. The deletion MUST be independently try/caught (never throws out of the wipe).

## Relabel Copy (S5)

**AC-COPY-1** — `copy.profile.archiveAction` MUST resolve to `"Block contact"` in `en` and `"Kontakt blockieren"` in `de`, replacing the prior `"Hide contact"` / `"Kontakt ausblenden"` strings.

**AC-COPY-2** — `copy.profile.unarchiveAction` MUST resolve to `"Unblock contact"` in `en` and `"Kontakt entsperren"` in `de`, replacing the prior `"Unarchive contact"` / `"Kontakt wieder einblenden"` strings.

**AC-COPY-3** — `copy.contacts.hiddenBadge` MUST resolve to `"Blocked"` in `en` and `"Blockiert"` in `de`, replacing the prior `"Hidden"` / `"Versteckt"` strings.

**AC-COPY-4** — `copy.contacts.archivedDetailNotice` MUST resolve to destructive-blocked-notice copy in both `en` and `de`, distinct from the prior "hidden from the default list view" wording in either language.

**AC-COPY-5** — `copy.contacts.hiddenFilterLabel`, `hideHiddenOption`, `showHiddenOption`, and `hiddenOnlyBody` MUST use "Blocked contacts" phrasing in `en` and the corresponding German phrasing in `de`, replacing the prior "Hidden contacts" wording in both languages.

**AC-COPY-6** — The confirm dialog MUST render new copy keys (title, body, confirm-button label, cancel-button label) present in both the `en` and `de` `Copy` objects. No hardcoded user-visible string MUST appear in the confirm-dialog component.

## Manual Validation

None. Every AC above is automatable: pure-predicate ACs (AC-CORE-*) via vitest unit tests with literal hex fixtures (matching `walledGarden.test.ts`'s AC-ID-organized describe-block convention); inbound/persistence ACs (AC-INBOUND-*, AC-VIEW-8 through AC-VIEW-12) via vitest with mocked NDK events or Playwright e2e with `window.__fewPublishDm`; storage-observable ACs (AC-WIPE-*, AC-UNBLOCK-*) via `readIdbRecord`/localStorage assertions; UI-gating ACs (AC-VIEW-1 through AC-VIEW-7, AC-CONFIRM-*) via Playwright DOM queries; privacy ACs (AC-PRIV-*) via an NDK publish-call spy; copy ACs (AC-COPY-*) via direct `i18n.ts` object assertions per locale.
