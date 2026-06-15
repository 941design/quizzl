# Feature Request: Feedback Channel (Encrypted DM to the Maintainers)

**Status:** Proposed
**Date:** 2026-06-15
**Type:** New feature (user-facing surface + DM-pipeline reuse + config + deploy/env)
**Affected context:** `app/src/lib/directMessages.ts`, `app/src/lib/walledGarden.ts`, `app/src/lib/directMessageNotifications.ts`, `app/src/lib/contacts.ts` (consumer-side filtering), `app/src/components/contacts/ContactChat.tsx`, `app/src/components/Layout.tsx`, `app/pages/contacts.tsx`, `app/pages/settings.tsx`, a new `app/pages/feedback.tsx`, a new `app/src/config/maintainer.ts`, `app/src/lib/publicEnv.ts`, `app/src/lib/i18n.ts`

---

## 1. Summary

There is no in-app way for a user to reach the people who build Nostling. To report
a bug or request a feature today, a user would have to find the maintainers'
identity out-of-band and start an ordinary DM — and most users never will.

This feature adds a **Feedback** surface: a button that opens an **encrypted chat
addressed to the maintainers**. Because Nostling already sends every direct message
NIP-17 gift-wrapped (kind-1059 → sealed kind-13 → kind-14 rumor, NIP-44 encrypted),
"feedback" is **not a new protocol** — it is a direct message to an app-known
recipient, presented as its own surface. The send path, the encryption, the inbound
listener, the per-thread storage, and the chat UI all already exist; this feature
**wires them to a configured set of maintainer keys, stamps the outgoing messages so
the maintainer can recognise them as Nostling feedback, and gives the thread a
distinct entry point and screen.**

The maintainer identity is a **configurable list** of keys, not a single key, so the
team can add maintainers or **rotate a key** later without a code change. Today the
list has one entry (the active recipient). The list cleanly serves two roles
(§2.1): the **whole list** is the *recognition set* (admission + contact-list
filtering); the **first/active entry** is the *send target* and the thread the
Feedback screen renders. Rotation mechanics are **not implemented** in this feature —
the data model is just shaped so they can be added later (§4.5, §7).

Each feedback message carries a private (sealed, recipient-only) tag identifying it
as originating from Nostling, so the maintainer can filter feedback from ordinary
DMs **after decryption**. The maintainer's replies flow back into the same thread —
feedback is **two-way**. Maintainer keys are reserved for the feedback channel: they
are **never surfaced as ordinary contacts** (§2.7).

### What changes for the user

| Actor | Before | After |
|---|---|---|
| User wanting to report a bug / suggest a feature | No in-app path; must find maintainers out-of-band | One **Feedback** entry (Settings row) opens an encrypted thread to the maintainers |
| Privacy of feedback | n/a | Same as any DM: **end-to-end encrypted**, gift-wrapped; nothing readable on the relay |
| Maintainer recognising the source | n/a | Each message carries a sealed `client = nostling` + `feedback` marker, visible to the maintainer only after decryption |
| User awaiting a response | n/a | Maintainer replies appear **in the Feedback thread**; the notification bell surfaces them |
| Maintainer reply when user has joined groups | (n/a) | Reply is **not dropped** — every maintainer key is seeded into the DM allow-list (§2.4) |
| Maintainer in the contacts list | (n/a) | **Never appears** — maintainer keys are filtered out of the contacts list (§2.7) |

### Decisions taken (confirmed with product owner)

| ID | Decision | Resolution |
|---|---|---|
| D1 | Maintainer identity source | **Env var holding a list of npubs, decoded to hex; configurable.** A `NEXT_PUBLIC_*` variable holds **comma-separated npubs** (precedent: `NEXT_PUBLIC_RELAYS`). **Default (current value):** a single-entry list `npub16xxxg3zs8pjz0rdyg9c485um04866leaz4a9hy2s4zm7mgsxx3xs9r87e2` (hex `d18c6444503864278da4417153d39b7d4fad7f3d157a5b9150a8b7eda206344d`). |
| D2 | Presentation | **Distinct Feedback screen, backed by the real DM thread.** A clearly-labelled surface (not just an anonymous contact), but the messages, encryption, and replies use the existing DM pipeline against the active maintainer key. |
| D3 | Replies | **Two-way.** Maintainer replies are visible in-app. **Every** maintainer key is seeded into the walled-garden DM allow-list so replies are never dropped (§2.4). |
| D4 | Source marker | **Sealed (private) tags on the kind-14 rumor:** a NIP-89-style `["client","nostling",<version>]` plus a discriminator `["l","feedback"]`. Visible to the maintainer only after decryption; **never public on the relay** (§2.3, §4.1). |
| D5 | Entry point | **A row on the Settings page** ("Send feedback to the maintainers"). The header is not crowded with a new icon in this scope (§7 leaves a header affordance open as future work). |
| D6 | Maintainer in contacts list | **Resolved: filtered out.** Maintainer keys are used **only** for the feedback channel and **must not** appear in the contacts list. **All** keys in the recognition set are excluded from the contacts-list view (§2.7). |
| D7 | Identity datatype | **A list, not a single key.** Supports adding maintainers and key rotation later. Rotation logic is **not** implemented now; the datatype and the admission/filtering paths are simply built to operate over N keys so rotation is a config change, not a code change (§4.5). |

---

## 2. Behavior specification

### 2.1 The maintainer identity (configuration — a list)

The maintainer identity is a **list** of keys, serving two distinct roles:

- **Recognition set (the whole list).** Used for inbound **admission** (§2.4) and
  **contact-list filtering** (§2.7). Any key in the list is "a maintainer."
- **Active recipient (the first valid entry).** The **send target** for new feedback
  and the thread the Feedback surface renders (§2.2, §2.6). There is exactly one at a
  time.

Sourcing and decoding:

- The list is sourced from an environment variable
  (`NEXT_PUBLIC_MAINTAINER_NPUBS`, exact name non-binding) holding **comma-separated
  npubs** (bech32), mirroring how `NEXT_PUBLIC_RELAYS` already supplies a list. The
  app **decodes each entry to hex once at load**. (AC-CONFIG-1.)
- **Default value** when the env var is unset: a single-entry list with the npub in
  D1. The feature works out of the box without configuration, and a deployer can
  repoint or extend it. (AC-CONFIG-2.)
- **Per-entry fail-soft:** an entry that cannot be decoded to a valid pubkey is
  **dropped** (not fatal to the others). If the resulting list is **empty**, the
  Feedback **entry point is hidden** and no feedback surface is reachable — the app
  must not render a broken thread or throw. (Given the default, an empty list is
  reached only if a deployer overrides with all-invalid values.) (AC-CONFIG-3.)
- **Ordering defines the active recipient:** the **first valid entry** is the active
  recipient. This is the only ordering semantics the feature relies on. (AC-CONFIG-4.)
- Config lives in a small dedicated module (e.g. `app/src/config/maintainer.ts`)
  exporting the decoded list, the active recipient, a display name, and a membership
  helper (`isMaintainerPubkey(hex)`), consumed by the allow-list seeding (§2.4), the
  contact filtering (§2.7), the notification routing (§2.5), and the UI (§2.6). It
  mirrors the existing `app/src/config/*.ts` convention and the `publicEnv.ts`
  env-accessor pattern.

### 2.2 Sending feedback

- Composing and sending a feedback message uses the **existing DM send path**
  (`publishDirectMessage` in `app/src/lib/directMessages.ts`) with
  `peerPubkeyHex = <active recipient hex>` (§2.1). No bespoke send/encryption code is
  introduced. (AC-SEND-1.)
- The message is therefore **NIP-17 gift-wrapped** (kind-1059 outer, sealed kind-13,
  inner kind-14 rumor, NIP-44 v2). Encryption is satisfied by construction; there is
  **no unencrypted feedback path**. (AC-SEND-2.)
- The thread is keyed `dm:<active recipient hex>` via the existing
  `directConversationId`, persisted to IndexedDB through the existing
  `appendMessage`/`loadMessages`, and rendered optimistically like any DM.
  (AC-SEND-3.)

### 2.3 The source marker (recognisable as Nostling)

- Feedback messages carry, **on the inner kind-14 rumor's `tags`**, two markers:
  1. `["client", "nostling", <build version>]` — NIP-89-style client identification
     (the build version is the value already baked in for update detection, e.g.
     `NEXT_PUBLIC_BUILD_VERSION`; if unavailable, the client tag carries just
     `["client","nostling"]`).
  2. `["l", "feedback"]` — a label discriminator so the maintainer can separate
     feedback from ordinary DMs.
- These tags live **inside the sealed rumor**. The gift wrap encrypts the seal, the
  seal encrypts the rumor — so the markers are **only visible to the maintainer after
  decryption** and are **never observable on the relay**. This is the only
  privacy-preserving way to make feedback "recognisable as Nostling": a public marker
  would leak that a given user is sending feedback. (AC-MARKER-1, AC-MARKER-2.)
- **Ordinary (non-feedback) DMs are unchanged.** Today a DM rumor carries only
  `[["p", peer]]`; the marker tags are added **only** on the feedback send path, so
  the normal DM tag surface stays minimal. The send helper gains an opt-in
  (e.g. a `source: 'feedback'` flag or a dedicated `publishFeedbackMessage` wrapper);
  the default DM path is untouched. (AC-MARKER-3.)

### 2.4 Receiving replies (two-way) and the walled garden

- The maintainer's replies are ordinary NIP-17 DMs back to the user. The existing
  global inbound listener (`subscribeDirectMessageNotifications`) already unwraps
  incoming gift wraps, routes kind-14 rumors to the `dm:<peer>` thread, remembers the
  contact, and bumps the unread count. So replies require **no new inbound code** —
  **except** the walled-garden gate. (AC-REPLY-1.)
- **The gate:** once a user has joined any MLS group, `isAllowedSender` (in
  `app/src/lib/walledGarden.ts`) **drops DMs from any pubkey not in the user's groups
  or known-peers set**. Without intervention, a maintainer reply would be **silently
  dropped** for exactly the users most likely to send feedback.
- **Required:** **every key in the recognition set** is **seeded into the
  allowed/known-peers set** at startup (the same place `knownPeers` is initialised),
  so `isAllowedSender` always admits any maintainer — including, during a future
  rotation, a predecessor key still in the list. (AC-REPLY-2.)
- Seeding the maintainer keys must **not** otherwise alter walled-garden admission for
  any other pubkey. (AC-REPLY-3.)

### 2.5 Notifications and unread for the feedback thread

- A maintainer reply increments the DM unread counter for that maintainer key and
  appears in the notification bell, via the existing unread/notification machinery —
  no special counting. (AC-NOTIFY-1.)
- **Routing of any maintainer's notification:** activating a notification whose peer
  `isMaintainerPubkey` opens the **Feedback** surface (§2.6), not a generic
  `/contacts?id=<hex>` chat, so the experience stays coherent with the labelled
  feedback channel. (AC-NOTIFY-2.)
- *(Forward-looking, not in scope now:)* with a single active recipient, replies
  arrive from the active key and land in the rendered thread. Aggregating replies that
  arrive from **multiple** maintainer keys into one feedback view is part of the
  rotation/multi-maintainer follow-up (§4.5, §7); it is not needed while the list has
  one active recipient.

### 2.6 The Feedback surface (presentation)

- **Entry point (D5):** a **row on the Settings page** labelled "Send feedback to the
  maintainers" (translated), which navigates to the Feedback surface. Rendered only
  when the feature is enabled (non-empty recognition set). (AC-UI-1.)
- **The surface** is a distinct, clearly-labelled screen — title like "Feedback to
  the Nostling team" with an "encrypted" affordance/subtitle — that renders the
  **active-recipient DM thread**. It **reuses the existing chat component**
  (`ContactChat`) against the active maintainer key rather than duplicating chat UI;
  the distinctness is in the chrome (title, subtitle, entry label), not a
  reimplemented conversation. The header name comes from config
  (`MAINTAINER_DISPLAY_NAME`), not from a contact record. (AC-UI-2.)
- Following the project's static-export routing rule (query params / one page file
  per route, no new dynamic path segment), the surface is a dedicated page
  (`app/pages/feedback.tsx`) that mounts the chat against the active maintainer hex.
  (AC-UI-3.)
- When the feature is disabled by config (§2.1, empty list), the Settings row is
  **not** rendered and the page, if reached directly, shows a benign "feedback
  unavailable" state rather than a broken thread. (AC-UI-4.)

### 2.7 Maintainer keys are excluded from the contacts list

- Maintainer keys are reserved for the feedback channel and are **not used anywhere
  else**. Because a reply calls `rememberContact(maintainer)`, a maintainer key would
  **by default** appear as an ordinary contact once a thread exists. This is **not
  allowed**. (AC-CONTACT-1.)
- **Every key in the recognition set is filtered out of the contacts-list view.** No
  maintainer key appears in the contacts list, regardless of whether a thread exists
  or a reply has arrived. (AC-CONTACT-1.)
- The filtering is applied at the **contacts-list consumer** (the contacts page), not
  in the storage layer: the underlying contact/thread record may still exist (the
  feedback surface and the notification bell resolve names/threads), but it is
  **excluded from the list the user browses**. The feedback thread's display name
  comes from config, so hiding the contact record does not blank the feedback header.
  (AC-CONTACT-2.)

---

## 3. The decisions this required

| ID | Decision | Resolution |
|---|---|---|
| D1 | Maintainer identity source | **Env var holding a comma-separated list of npubs, decoded to hex; default = the provided npub** (confirmed). Rejected: hardcoded-only constant — a deployer/fork could not repoint or extend feedback without a code change. |
| D2 | Presentation | **Distinct screen backed by the real DM thread** (confirmed). Rejected: (a) plain seeded contact — looks like any contact, user could archive/ignore it, no signal it reaches maintainers; (b) send-only form — throws away the free two-way channel. |
| D3 | Replies | **Two-way, with every maintainer key seeded into the DM allow-list** (confirmed). Rejected: send-only — simpler but the maintainer cannot respond, and the walled garden would silently eat any reply, which is worse than not offering replies at all. |
| D4 | Source marker | **Sealed `client=nostling` + `l=feedback` tags on the kind-14 rumor** (confirmed). Rejected: a **public** marker — would leak on the relay that a user is contacting the maintainers, contradicting the "must be encrypted" requirement for zero gain. |
| D5 | Entry point | **A Settings-page row** (confirmed via the presentation mock). Rejected for this scope: a permanent header icon — adds chrome to an already-busy header; left as future work (§7). |
| D6 | Maintainer in contacts list | **Filtered out** (confirmed). Maintainer keys are feedback-only and must not appear as ordinary contacts. Rejected: list-as-normal-contact (the maintainer would be archivable and indistinguishable from a friend) and badge-in-list (still occupies the contact list for a key that is "not used anywhere else"). |
| D7 | Identity datatype | **A list of keys** (confirmed). Whole list = recognition set (admission + filtering); first valid entry = active recipient (send target + rendered thread). Enables future add-maintainer and key-rotation as a config change. Rotation mechanics deferred (§4.5, §7). |

---

## 4. Conflicts and caveats

### 4.1 The marker is private by construction — that is the point

"Recognisable as Nostling" can only mean **recognisable to the maintainer after
decryption**. The marker tags ride inside the sealed kind-14 rumor; the relay sees
only an opaque kind-1059 gift wrap addressed (via the outer `p` tag) to an ephemeral
key. There is **no** way to publicly advertise "this is Nostling feedback" without
leaking that the user is contacting the maintainers — which would defeat the
encryption requirement. The design deliberately keeps the marker sealed. (AC-MARKER-2.)

### 4.2 The walled garden requires seeding — every maintainer key

Seeding is a **required mechanism**, not an option. The send half of feedback works
regardless; the **reply** half depends entirely on §2.4 seeding. If a maintainer key
is not in the allowed/known-peers set, a user who has joined any group sends feedback
into apparent silence — the reply arrives at the relay, is unwrapped, and is then
**dropped** by `isAllowedSender` before it ever reaches the thread or the bell.
Because the identity is a **list**, the seeding must cover **all** keys in the
recognition set, so a predecessor key kept in the list during a future rotation is
still admitted. (AC-REPLY-2.)

### 4.3 Config decode must be defensive and per-entry

The env var carries one or more bech32 npubs typed/pasted by a deployer. Decoding
must **fail soft per entry** — drop an undecodable entry, keep the valid ones — and
must never throw at module load. A thrown error in a config module imported by the app
shell would take down the whole app, not just feedback. Decode inside a guard; an
empty resulting list means "feature disabled" (§2.1). (AC-CONFIG-3.)

### 4.4 Marker tags must not leak onto ordinary DMs

The `client`/`feedback` tags are added **only** on the feedback path. If they were
added unconditionally in `buildChatRumor`, every normal DM would start carrying a
`client=nostling` tag — a (sealed, but still) behavior change to all DMs and a
needless metadata expansion. Keep the marker strictly opt-in to the feedback send.
(AC-MARKER-3.)

### 4.5 The list is built for rotation, but rotation is not implemented here

The datatype is a list specifically so that **adding a maintainer** or **rotating a
key** is later a config change, not a code change. What this feature delivers now,
and what it deliberately defers:

- **Delivered now:** the recognition set already operates over N keys — admission
  (§2.4) and contact filtering (§2.7) iterate the whole list; the active recipient
  (first valid entry) is the send target and rendered thread.
- **Deferred (rotation/multi-maintainer follow-up):**
  - **Choosing/announcing the active recipient on rotation.** Today "active = first
    valid entry." A future rotation prepends the new key (it becomes active) and keeps
    the predecessor in the list for a grace period (still admitted + filtered). No
    automation, overlap window, or migration of the rendered thread is built now.
  - **Aggregating replies from multiple maintainer keys into one feedback view.** With
    one active recipient there is one thread. If, post-rotation, replies arrive on both
    the new and the predecessor key, merging those threads into a single feedback view
    is follow-up work (§7). The notification routing already sends **any** maintainer
    key's notification to `/feedback`, which is forward-compatible but, until
    aggregation exists, would surface a non-active-key reply that the single-thread
    view does not yet display. This inconsistency cannot occur while the list has one
    active key.

### 4.6 Feedback to self (a maintainer running their own build)

If a configured maintainer key equals the logged-in user's own pubkey (a maintainer
dogfooding their own app), feedback to that key becomes a self-DM. This is an edge
case, not a failure; the surface must render without error. Optionally the entry can
be hidden when the active recipient equals self. (AC-EDGE-1.)

### 4.7 Relay reachability is the same as any DM

Feedback delivery has exactly the delivery guarantees of any DM in the app — it
depends on the configured `DEFAULT_RELAYS` carrying the gift wrap to the maintainer.
No new transport guarantees are introduced. If a maintainer reads on relays the app
does not publish to, the message will not arrive; this is the standard Nostr
relay-overlap caveat, not specific to this feature. Worth stating, not solving here.

### 4.8 i18n for all new chrome

Every new user-visible string — the Settings row label, the Feedback screen title and
"encrypted" subtitle, the composer placeholder, any "unavailable" state — must be
translated in both `en` and `de` per `CLAUDE.md`; no hardcoded strings. (AC-I18N-1.)

---

## 5. Acceptance criteria

### Configuration
- **AC-CONFIG-1** The maintainer recipients are read from an env var holding a
  comma-separated list of npubs and decoded to a list of hex pubkeys at load.
- **AC-CONFIG-2** With the env var unset, the feature uses the default single-entry
  list from D1 and is fully functional without any configuration.
- **AC-CONFIG-3** Each list entry decodes independently: undecodable entries are
  dropped without affecting valid ones; an empty resulting list disables the feature
  (entry point hidden, no broken surface); decoding never throws at load.
- **AC-CONFIG-4** The first valid entry is the active recipient (send target and
  rendered thread); the full list is the recognition set used for admission and
  contact filtering.

### Sending
- **AC-SEND-1** Sending feedback uses the existing DM publish path against the active
  maintainer key (no bespoke send/encryption code).
- **AC-SEND-2** Every feedback message is NIP-17 gift-wrapped and NIP-44 encrypted;
  there is no unencrypted feedback path.
- **AC-SEND-3** Sent feedback is persisted to and rendered from the
  `dm:<active recipient>` thread like any DM (optimistic send, IndexedDB persistence).

### Source marker
- **AC-MARKER-1** Each feedback message's inner kind-14 rumor carries a
  `["client","nostling",…]` tag and an `["l","feedback"]` tag.
- **AC-MARKER-2** Those tags are present only inside the sealed rumor (recoverable by
  the recipient after unwrap) and are **not** present on the outer, relay-visible
  gift wrap.
- **AC-MARKER-3** Ordinary (non-feedback) DMs do **not** carry the `client`/`feedback`
  marker tags — the markers are added only on the feedback send path.

### Replies / walled garden
- **AC-REPLY-1** A reply from a maintainer appears in the Feedback thread via the
  existing inbound DM listener (no new inbound parsing).
- **AC-REPLY-2** With the user having joined at least one group, a reply from **any**
  key in the recognition set is **admitted** (not dropped by `isAllowedSender`)
  because every maintainer key is seeded into the allowed/known-peers set.
- **AC-REPLY-3** Seeding the maintainer keys does not change walled-garden admission
  for any other (non-maintainer) pubkey.

### Notifications
- **AC-NOTIFY-1** A maintainer reply increments DM unread and surfaces in the
  notification bell via the existing machinery.
- **AC-NOTIFY-2** Activating a notification whose peer is any maintainer key opens the
  Feedback surface, not a generic contact chat.

### UI
- **AC-UI-1** A Settings-page row labelled (translated) for feedback navigates to the
  Feedback surface, and is rendered only when the feature is enabled.
- **AC-UI-2** The Feedback surface is distinctly labelled (title + "encrypted"
  affordance), takes its header name from config, and renders the active-recipient DM
  thread by reusing the existing chat component.
- **AC-UI-3** The surface is reachable as a dedicated page consistent with the
  static-export routing rule (no new dynamic path segment).
- **AC-UI-4** When the feature is config-disabled, the Settings row is absent and the
  page (if reached directly) shows a benign unavailable state, not a broken thread.

### Contacts list
- **AC-CONTACT-1** No key in the recognition set appears in the contacts list, whether
  or not a feedback thread exists or a reply has arrived.
- **AC-CONTACT-2** Filtering is applied at the contacts-list view, not by deleting the
  underlying record: the feedback surface and the notification bell still resolve the
  maintainer thread, and the feedback header name (from config) is unaffected.

### Edge / i18n
- **AC-EDGE-1** When the active maintainer key equals the logged-in user's own pubkey,
  the feature renders without error (self-DM edge case).
- **AC-I18N-1** All new user-visible strings are translated in `en` and `de`; no
  hardcoded strings.

---

## 6. Implementation pointers (non-binding)

- **Config module:** add `app/src/config/maintainer.ts` exporting
  `MAINTAINER_PUBKEYS_HEX: string[]` (decoded from `NEXT_PUBLIC_MAINTAINER_NPUBS` via
  the existing `publicEnv.ts` accessor, splitting on commas, falling back to the D1
  default npub; undecodable entries dropped), `MAINTAINER_ACTIVE_PUBKEY_HEX`
  (`MAINTAINER_PUBKEYS_HEX[0] ?? null`), `MAINTAINER_DISPLAY_NAME`, and
  `isMaintainerPubkey(hex)`. Decode each with `nip19.decode` inside a try/guard;
  `MAINTAINER_ACTIVE_PUBKEY_HEX === null` is the "feature disabled" sentinel the UI
  reads. Mirror `app/src/config/blossom.ts` / `app/src/config/profile.ts` and the
  comma-split pattern already used for `NEXT_PUBLIC_RELAYS`.
- **Marker on send:** extend the DM send path in `app/src/lib/directMessages.ts` with
  an opt-in source flag. `buildChatRumor` appends the `client`/`feedback` tags only
  when that flag is set; expose either `publishDirectMessage({ …, source: 'feedback' })`
  or a thin `publishFeedbackMessage(...)` wrapper. Reuse `NEXT_PUBLIC_BUILD_VERSION`
  (update-detection work) for the client tag's version slot; omit the slot if absent.
- **Allow-list seeding:** wherever `knownPeers` / the allowed-sender set is initialised
  for `isAllowedSender` (`app/src/lib/walledGarden.ts` and its initialisation site),
  add **every** entry of `MAINTAINER_PUBKEYS_HEX` unconditionally at startup. Keep it
  additive — do not alter the gate's logic for other peers.
- **Contact filtering:** in the contacts-list consumer (`app/pages/contacts.tsx`,
  around `listContacts`), exclude any pubkey for which `isMaintainerPubkey` is true.
  Filter at the view, not in the storage layer, so the feedback surface and the bell
  still resolve the record.
- **Feedback page:** add `app/pages/feedback.tsx` that resolves
  `MAINTAINER_ACTIVE_PUBKEY_HEX` from config and renders `ContactChat`
  (`app/src/components/contacts/ContactChat.tsx`) against it, wrapped in distinct
  chrome (title + "encrypted" subtitle from i18n, name from `MAINTAINER_DISPLAY_NAME`).
  If disabled (`null`), render the unavailable state.
- **Settings entry:** add a row to `app/pages/settings.tsx` linking to `/feedback`,
  rendered only when the feature is enabled. (A header affordance in `Layout.tsx` is
  left for future work — §7.)
- **Notification routing:** where the notification bell builds DM entries
  (`app/src/components/NotificationBell.tsx`), route any peer with
  `isMaintainerPubkey(peer)` to `/feedback` instead of `/contacts?id=<hex>`.
- **i18n:** add `en` + `de` keys (Settings row label, page title, encrypted subtitle,
  composer placeholder, unavailable state) to the `Copy` type and both language
  objects in `app/src/lib/i18n.ts`; consume via `useCopy()`.
- **Tests (e2e — must drive through the app, per `CLAUDE.md` and
  `feedback_e2e_no_direct_relay`):**
  - **Send reaches the maintainer, encrypted, marked:** sign in as the user, open
    Feedback, send a message **through the app**. Boot a second `browser.newContext()`
    signed in as the **active maintainer key**, and assert it receives the DM **via the
    app's own receive path**, that the unwrapped rumor carries `client=nostling` and
    `l=feedback` tags, and that the message content matches. Do **not** hand-sign a
    kind-1059/14 in the test or read the relay directly (publish-via-app rule).
  - **Reply flows back under the walled garden:** with the user having joined a group,
    have the maintainer context reply **through the app**; assert the reply appears in
    the user's Feedback thread (admitted, not dropped).
  - **Maintainer hidden from contacts:** after a maintainer reply, assert the
    maintainer does **not** appear in the contacts list, while the Feedback thread
    still shows the conversation.
  - **Ordinary DM has no marker:** send a normal DM to a non-maintainer peer; assert
    the unwrapped rumor does **not** carry the `client`/`feedback` tags, and that the
    peer **does** appear in the contacts list (filtering is maintainer-specific).
  - **Config: multiple keys / fail-soft:** with two npubs configured (one valid, one
    garbage), assert the valid one is the active recipient and the feature works; with
    all entries invalid, assert the Settings row is absent and `/feedback` shows the
    unavailable state without throwing.
  - **Notification routes to Feedback:** maintainer reply → assert the bell entry links
    to `/feedback`.
- **Unit tests:** the npub-list→hex decode + per-entry drop + empty-list-disabled
  branch, the active-recipient selection, the `isMaintainerPubkey` membership check,
  and the marker-tag builder (feedback path adds tags, default path does not) are pure
  and should be unit-tested directly.

---

## 7. Out of scope

- **Key rotation mechanics.** The datatype is a list to *enable* rotation (§4.5), but
  no rotation flow, active-key handover, grace-window automation, or rendered-thread
  migration is built here. Rotation today is a manual config change (edit the list).
- **Aggregating replies across multiple maintainer keys into one feedback view**
  (§4.5). Needed only once more than one key is actively receiving; deferred.
- **A permanent header/nav icon** for feedback (Decision D5 places the entry on
  Settings). A header affordance is a possible future addition.
- **Image / file attachments in feedback.** The DM pipeline supports attachments, but
  v1 feedback is text-only; attachment reuse is a later enhancement.
- **Feedback categorisation** (bug vs feature vs question) mapped to additional `l`
  tags or a structured payload. The single `l=feedback` discriminator is the hook; a
  category selector is future work.
- **Maintainer-side tooling** (triage inbox, auto-acknowledgement, ticketing). This
  feature delivers the channel; what the maintainer does with received feedback is out
  of scope.
- **A maintainer group (MLS) instead of a key list.** A maintainer *group* would be a
  different feature built on the groups stack, not the DM stack.
- **Rate limiting / spam protection / abuse handling** on the feedback channel.
- **A generalised pinned/system/non-deletable contact concept** across the app. D6 is
  resolved narrowly (filter maintainer keys from the contacts list); no general
  "special contacts" framework is introduced.
- **Changing the inbound DM listener, gift-wrap, or NIP-17 implementation.** This
  feature consumes them unchanged; the only protocol-adjacent change is the opt-in
  marker tags on the feedback send path.
</content>
