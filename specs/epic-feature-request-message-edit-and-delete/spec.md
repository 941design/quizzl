# Feature Request: Editing and Removing Chat Messages

**Status:** Proposed
**Date:** 2026-07-07
**Type:** Behavior change (messaging — direct messages and groups)
**Affected context:**
- `specs/epic-emoji-feature/` — reaction add/remove is the direct architectural precedent (tombstone-via-application-rumor, `e`/`k`/`p` reference tags, optimistic/rollback).
- `specs/epic-feature-spec-unified-mls-application-rumor-dispatch/` — the single inbound rumor dispatcher this feature registers a new handler with.
- `specs/epic-feature-request-admin-role-management-for-groups/` — group permissions context (this feature deliberately does **not** depend on it; see §7).

---

## 1. Summary

Today a sent message is permanent on the recipient's screen. There is no way to fix a
typo or take a message back — for either direct messages (DMs, NIP-17 gift-wrapped
kind-14) or group messages (Marmot/MLS application rumors, inner kind-9). This feature
adds **edit** and **delete** for a user's *own* messages, honored by cooperating Few
clients on a best-effort basis.

This is a **convention, never an enforcement**. Nostr cannot compel a relay or a
non-cooperating client to forget a message. The honest guarantee is narrow and is stated
in full in §4.1 — the spec must not let anyone mistake "delete" for a cryptographic
erase.

### What changes for the user

| Actor | Before | After |
|---|---|---|
| **Message author (DM or group)** | Cannot alter or retract a sent message. | Can **edit** their own text messages (content is replaced in place; a subtle **"(edited)"** marker appears) and **delete** any of their own messages (text or image). No time limit. |
| **Recipient on a Few client** | Sees every message exactly as first sent, forever. | Sees edited messages update in place with an "(edited)" marker; sees deleted messages **disappear entirely** (silent removal), along with any reactions on them. |
| **Recipient on a non-Few client** (0xchat, Amethyst, other Marmot clients) | — | **DMs (expected, unverified — §4.8):** a client that implements NIP-17's optional gift-wrapped `kind:5` clause hides the deleted/original message and shows an edit as "original hidden + new message"; no "(edited)" marker, and a *repeatedly* edited message may briefly show more than one version (§2.4). A client that ignores the clause keeps showing everything. **Groups:** no effect — keeps showing the original (the group convention is Few-only, §4.2). |
| **Group member who joins later** | — | Does **not** retroactively see the message *or* its deletion — MLS forward secrecy withholds pre-join history from new members regardless (§4.4). |

**Scope for v1 (all four confirmed in scoping):** edit **and** delete, on **both** DM and
group transports. Edit applies to **text messages only**; image messages can be deleted
but not edited (§2.6). Delete of an image message hides the message but does **not** remove
the uploaded file from Blossom (§4.5). Permissions are **own-messages-only** — there is no
admin moderation of other members' messages in v1 (§7).

---

## 2. Behavior specification

### 2.1 The conversation slot is keyed by the original message id

Every message already carries a stable, cryptographically-validated NIP-01 rumor id
(`ChatMessage.id`, `app/src/lib/marmot/chatPersistence.ts:16-30`; DM id validated at
`app/src/lib/directMessages.ts:265-274`). This feature treats that **original id as the
permanent identity of the conversation slot**.

- An **edit** replaces the *content* of the slot but keeps the slot's original id. Reactions
  keyed to that id (`Reaction.messageId`, `app/src/lib/reactions/types.ts`) therefore stay
  attached across an edit.
- A **delete** tombstones the slot by its original id; the row is retained in storage for
  dedup (mirroring `Reaction.removed`) but is not rendered, and its reactions are not
  rendered either.
- Repeated edits (M1 → edited → edited again) always reference the **original** id, not the
  previous edit's id, so the anchor never moves (AC-EDIT-6).

### 2.2 Delete — behavior

Deleting a message the user authored:

1. **Optimistically** removes it from the local view immediately (and rolls back on publish
   failure — mirror `rollbackOptimistic`, `app/src/lib/reactions/api.ts:213-280`).
2. Publishes a **delete signal** (§2.4 wire format) to the same recipient set / group.
3. On any cooperating Few client that has the target message, the message and its reactions
   **disappear silently** — no placeholder, no "deleted" text (per scoping decision).
4. The row is retained locally as a tombstone (not physically purged) so a later re-delivery
   of the original rumor cannot resurrect it (AC-STORE-2).

Delete is offered for **all** message types the user authored (text and image). Deleting is
**guarded by a lightweight confirmation** (§2.7) because it is silent and effectively
irreversible.

### 2.3 Edit — behavior

Editing a text message the user authored:

1. Loads the current text back into the composer in an **edit mode** (with a visible
   "editing" affordance and a cancel action).
2. On send, **optimistically** replaces the slot's content locally and stamps it edited; if
   the (replacement-first) publish fails, the optimistic edit is **rolled back** to the prior
   content (AC-EDIT-8, mirroring AC-DEL-2 / `rollbackOptimistic`).
3. Publishes an **edit signal** (§2.4): the edit-marked replacement (published **first**) plus
   the companion marked kind-5 for non-Few degradation. The replacement alone is authoritative
   for Few clients, so a kind-5 that fails to publish does not corrupt the edit.
4. On a cooperating Few client, the slot's content updates **in place** (it does not jump to
   the bottom of the conversation) and renders a subtle **"(edited)"** marker next to the
   timestamp (`ChatBox.tsx:510-524` is where sender/time already render).
5. Reactions on the slot are preserved (§2.1).

Edit is **text-only** in v1. The edit affordance is not offered on image messages
(AC-IMG-2).

### 2.4 Wire format (hybrid: NIP-17 on the wire, tombstone in storage)

Both transports carry two Few-controlled signal shapes. Neither is ever a relay-facing
kind-5 — see §4.3 for why that distinction matters and why it does not contradict the
project's prior rejection of NIP-09.

**Every signal carries an explicit revision clock.** The reconciler orders competing
signals for a slot by a `rev` value = the **real Unix-seconds wall-clock time the signal was
created** (the signal rumor's own `created_at` for a delete; an explicit `["rev", <seconds>]`
tag on the replacement for an edit — see below for why the replacement's own `created_at`
cannot be used). `rev` is the *only* thing that orders revisions; a slot's rendered state is
the outcome of its **highest-`rev` signal** (D12). Two competing edits at the same `rev`
resolve by a deterministic content-independent key — the **lexicographically higher
replacement rumor id wins** — so equal-`rev` edit/edit collisions are still order-independent
(D15).

**`rev` is monotonic per slot (sender-side clamp, D16).** Because `rev` is a self-reported
wall clock, a future-skewed device could otherwise pin a slot so the author's own later action
can never supersede it (§4.7). When composing any signal the sender MUST set
`rev = max(wallClockSeconds, slot's last-known rev + 1)` — per-slot and self-healing (one
action from a sane-clock device restores monotonicity). AC-AUTH-2 already prevents any
*cross-user* abuse (only the author can signal their own slot); the clamp closes the
*self*-device skew case.

**Delete signal (author-signed inner rumor):**
- Inner `kind: 5`, tags `["e", <originalId>]`, one `["e", <priorReplacementId>]` for **every**
  earlier replacement of the slot (D14, so a non-Few client hides all superseded versions), and
  `["k", <targetKind>]` (14 for DM, 9 for group), matching the reaction reference pattern
  (`app/src/lib/reactions/rumor.ts:66-67`). Its own `created_at` (real wall time, clamped) is
  its `rev`.
- **A standalone delete's kind-5 carries NO `"edit"` marker.** This is what distinguishes it
  from an edit's kind-5 (below) — a lone *unmarked* kind-5 is always a delete (C2/D13).
- **DM:** sealed (kind-13, real-key signed) and gift-wrapped (kind-1059) to the original
  recipient set (`sealAndWrap`, `directMessages.ts:171-190`). **Group:** sent as an MLS
  application rumor via `sendRumorSafe` (`ChatStoreContext.tsx:51-66`).

**Edit signal — the replacement is authoritative for Few clients:**
- A **replacement chat rumor** (kind-14 DM / kind-9 group) whose:
  - `content` is the new text,
  - wire `created_at` **equals the original's `created_at`** — an *in-place ordering hint for
    non-Few clients only* (so the edit renders in the original's position, not at the bottom).
    Because this field is pinned to the old time, it **cannot** double as the revision clock,
  - therefore also carries `["rev", <real-seconds>]` (the revision clock) and an explicit
    **edit reference** `["e", <originalId>, "", "edit"]`.
- **Plus** a companion **kind-5** that **also carries the `"edit"` marker**
  (`["e", <originalId>, "", "edit"]`, plus one `["e", <priorReplacementId>]` for every earlier
  revision of the slot — D14). This kind-5 exists **only** for non-Few degradation; a Few
  client ignores any kind-5 that carries the `"edit"` marker.
- **A Few client treats the edit-marked replacement, alone, as the complete edit** (D13). The
  companion kind-5 is not required for the edit to apply on a Few client — so a partial
  publish where the replacement lands but the kind-5 fails still produces a correct edit, and
  never a spurious delete (M1). Publish order MUST be **replacement first** (§2.3 / AC-EDIT-8).

**Graceful degradation (the reason for this shape):**
- A cooperating **Few** client applies the marked replacement in place, keeps reactions, and
  shows "(edited)"; it ignores the marked kind-5.
- A non-Few **NIP-17** client that ignores the markers still honors the plain gift-wrapped
  kind-5 (hiding the original *and* all prior replacement ids it names) and displays the newest
  replacement as a message — net effect: an edit, minus the marker and reaction preservation.
  Repeatedly-edited messages may briefly show more than one version on such a client until the
  next signal's prior-replacement `e`-tags (D14) catch up.
- A client that ignores everything keeps showing the original.

### 2.5 Inbound handling, dispatcher, and reconciliation

A new **kind-5 handler** is registered with the unified application-rumor dispatcher
(`app/src/lib/marmot/registerHandlers.ts:8-9,65,70`; dispatcher at
`applicationRumorDispatcher.ts`) for the group path, and the equivalent inbound branch is
added to the DM unwrap path (`ContactChat.tsx`, mirroring how reactions are handled in-line
there). A single reconciliation function — analogous to `applyInboundRumor`
(`app/src/lib/reactions/api.ts:301`) — interprets delete/edit signals for **both** transports
so the local model stays identical across DM and group.

**Slot resolution.** A signal identifies its slot by matching **any** of its `e`-tagged ids
against known slot ids — a slot is known by its original id *and* by every stored replacement
id it has had. (An `edit`-marked replacement's slot is its `["e", X, "", "edit"]` original id;
a delete's slot is the original id among its several unmarked `e`-tags, D14.) A pending signal
whose slot is not yet known is indexed under **all** its `e`-tagged ids so it resolves whenever
any of them arrives (§2.8).

Reconciliation is **revision-clock driven and therefore order-independent** (AC-ORDER-3). For
each slot, the client keeps the winning signal by `rev`:
- An **edit-marked replacement** (with `["e", X, "", "edit"]` and `["rev", T]`) proposes:
  slot X content = replacement, `edited = true`, at `rev = T`.
- An **unmarked kind-5** referencing X (`rev = T`) proposes: tombstone slot X, at `rev = T`.
- An **edit-marked kind-5** is **discarded on receipt** — it never enters state or the pending
  buffer (it is the non-Few degradation vehicle only).
- The **original message rumor itself** carries no `rev` (treated as `rev = 0`) and therefore
  can never override an edit or delete already applied to its slot (M4/AC-STORE-3).

The slot renders the state of its **highest-`rev`** proposal. Tie resolution is fully
specified so no arrival order or device split can diverge (AC-ORDER-3):
- **delete vs. edit at equal `rev`** → **delete wins** (safety: never leave visible a message
  the author tried to retract).
- **edit vs. edit at equal `rev`** → the **lexicographically higher replacement rumor id wins**
  (D15) — content-independent, so all recipients converge.

This is fully order-independent: (delete→edit), (edit→delete), (original→signal),
(signal→original), and any interleaving converge to the same result, because only the max-`rev`
signal (with the deterministic tiebreak) matters, not arrival order. A tombstoned slot whose
newer edit-marked replacement later arrives is un-tombstoned iff that replacement's `rev`
strictly exceeds the tombstone's `rev`.

### 2.6 Image messages

- **Delete:** fully supported. Tombstones the image message like any other (AC-IMG-1). The
  uploaded Blossom blob is **not** removed (§4.5, AC-IMG-3).
- **Edit:** **not** offered (AC-IMG-2). Editing an image or its caption is out of scope for
  v1 (§7).

### 2.7 UI surfaces

- **Action menu:** edit/delete actions attach to a message the user authored, in the same
  per-bubble hover/trigger area the reaction picker already uses (`ChatBox.tsx:572-595`).
  The actions appear **only on the current user's own messages** (AC-AUTH-1).
- **Edit mode:** selecting Edit puts the composer into an editing state pre-filled with the
  message text, with Cancel and a changed send affordance. Sending an empty edit is
  disallowed (offer delete instead) (AC-EDIT-5).
- **Delete confirmation:** selecting Delete prompts a lightweight confirmation before the
  message is removed (AC-DEL-6).
- **"(edited)" marker:** rendered next to the timestamp of an edited message on both DM and
  group surfaces via the shared `ChatBox` (AC-EDIT-3).
- **Conversation/group list preview:** when the last message of a thread is edited, the
  preview reflects the new text; when it is deleted, the preview falls back to the previous
  surviving message (or the empty state) (AC-LIST-1/2).

### 2.8 Ordering and late arrival

- A delete or edit signal whose **target id is not yet known** locally is **retained as a
  pending signal** keyed by target id, and applied when the target message arrives
  (AC-ORDER-1). This deliberately **differs** from the reaction precedent, which silently
  discards references to unknown messages (`app/src/lib/marmot/handlers/reactionHandler.ts:36-41`)
  — for reactions a dropped reference is cosmetic, but a *dropped delete would leave a message
  the user intended to retract visible*, which violates the feature's core promise.
- **Deferred authorization.** The AC-AUTH-2 author-pubkey match can only run once the target
  message (and thus its author) is known. Authorization is therefore evaluated at *application*
  time, not receive time; a pending signal is held unauthenticated and authenticated when its
  target arrives (AC-ORDER-1).
- **Bounded buffer with defined expiry (AC-ORDER-2/4).** Pending signals are capped (evict
  oldest) and TTL'd, reusing the app's existing buffered-state bound rather than a new magic
  number — name the constant in implementation. (Edit-marked kind-5s are discarded on receipt
  per §2.5 and never enter the buffer.) Expiry semantics differ by signal type:
  - A pending **delete** whose target never arrives within the buffer window does **not**
    silently drop its effect (that would violate the feature's core promise, §2.8). On
    expiry it **persists a lightweight, content-free tombstone marker** keyed by the target
    id (id-only — no row, no content), so a later-arriving original for that id is still
    suppressed and never renders (AC-ORDER-4). This is symmetric with the edit branch's
    materialize-in-place on expiry: both branches persist their effect rather than dropping
    it. The persisted delete-marker set is **cap-bounded** (same cap discipline as AC-ORDER-2)
    but is **NOT** TTL-expired: a marker's whole purpose is durable suppression of a retracted
    message, so expiring it would un-suppress a message the author deleted. Markers are evicted
    only under cap pressure (oldest first), never by age.
  - A pending **edit-marked replacement** whose original never arrives is, on expiry,
    **materialized as slot X** (keyed by its `["e", X, "", "edit"]` original id, retaining its
    `rev`), rendered as an ordinary message — *not* under its own rumor id. This is essential:
    a later-arriving original (rev = 0) then loses to it by the normal rule instead of forming
    a duplicate slot, and a later delete for X applies normally. Its pinned wire `created_at`
    places it at the original's chronological position. Dropping it instead would make a Few
    client show *less* than a non-Few client — strictly worse (M5). It renders without the
    "(edited)" marker, since the prior version was never seen.
- Reconciliation itself is **order-independent** by construction (§2.5): outcome = the slot's
  max-`rev` signal, delete-wins on ties. Arrival order never changes the final state
  (AC-ORDER-3).

---

## 3. The decisions this required (resolved)

| ID | Decision | Resolution |
|---|---|---|
| **D1** | Scope of v1. | **Edit + delete, both DM and group transports.** Edit is text-only; image messages are delete-only. |
| **D2** | DM delete/edit convention. | **Hybrid** — NIP-17's *optional* gift-wrapped kind-5 clause on the wire (best-available interop; actual Amethyst honoring is expected but unverified, §4.8), stored locally as a tombstone exactly like reaction removal (internal consistency). |
| **D3** | Delete UX. | **Silent removal** — the message and its reactions vanish; no "deleted" placeholder. Row retained in storage for dedup only. |
| **D4** | Edit UX. | **"(edited)" marker** shown; content replaced **in place** (does not reorder to the bottom). |
| **D5** | Permissions. | **Own messages only.** No admin moderation of others' messages in v1. Enforced by author-pubkey match on receive (AC-AUTH-2). |
| **D6** | Time limits. | **None.** Edit/delete allowed at any age, contingent only on the target id still being known to the recipient. |
| **D7** | Editable types. | **Text only.** Image messages: delete yes, edit no. |
| **D8** | Blossom blob on image delete. | **Not removed.** Message is hidden; the underlying file remains fetchable at its Blossom URL. Documented limitation (§4.5). |
| **D9** | Group convention backing. | **Few-only invention** (no MIP, no cross-client support). Mirrors the DM shape purely for code reuse; stated plainly so nobody assumes external clients honor it. |
| **D10** | Late/out-of-order signals. | **Retain-and-apply** (pending buffer), not discard — because a dropped delete would break the feature's promise (§2.8). |
| **D11** | Edit anchor across repeated edits. | Edits always reference the **original** message id (stable slot anchor); reactions survive edits. |
| **D12** | Revision ordering. | Every signal carries an explicit **`rev` clock** (real wall-seconds). A slot renders its **max-`rev`** signal; ties resolve **delete-wins**. Required because the replacement's wire `created_at` is pinned to the original and cannot double as the clock. |
| **D13** | Edit is replacement-authoritative on Few clients. | A Few client applies the **edit-marked replacement alone** as a complete edit; the companion kind-5 is ignored by Few clients and exists only for non-Few degradation. Makes edit publish non-atomic-safe (a failed kind-5 never becomes a spurious delete). A **lone unmarked kind-5 is always a delete**. |
| **D14** | Non-Few degradation for repeated edits. | An edit/delete kind-5 `e`-tags the original **plus any prior replacement ids the sender still retains**. Scoped to best-effort by the 2026-07-07 product decision: Few's in-place storage retains none, so it e-tags the original alone, and superseded copies may linger on non-Few clients (§4.8, AC-INTEROP-2). Few clients reconcile by the original id (AC-EDIT-6). |
| **D15** | Equal-`rev` edit/edit tiebreak. | Resolved by **lexicographically higher replacement rumor id** (content-independent) so two same-second edits from two of the author's devices converge identically on every recipient. |
| **D16** | `rev` monotonicity. | Sender clamps `rev = max(wallSeconds, slot's last-known rev + 1)`, per-slot and self-healing, so a future-skewed device cannot make a slot permanently unretractable by the author's own later action. |

---

## 4. Conflicts and caveats

### 4.1 The honest guarantee — what delete/edit can and cannot do

**Guaranteed (cooperating Few clients only):** a Few recipient that processes the signal
stops displaying the targeted message (delete) or shows the new text (edit) from that point
forward.

**Not guaranteed, by any implementation:**
- A recipient who already **read or copied** the original has not un-seen it. True of Signal
  and WhatsApp too — not Nostr-specific.
- A **non-Few client** honoring the signal at all. DMs degrade partially (NIP-17 delete is
  honored; edit shows as hide+new). Groups do not degrade at all — the original stays
  (§4.2).
- **Erasure of the ciphertext from relays.** For DMs there is *no* relay-facing delete signal
  at all — the kind-5 travels peer-to-peer inside a fresh gift wrap, never as a public event.
  For groups the payload was always opaque ciphertext to relays, so "delete" was never doing
  confidentiality work.
- **Multi-device / offline reconciliation.** Every device is a separate ingest path. A delete
  reaches a device only if that device polls the inbox (DM) or is an active group member
  (group) and actually receives the signal.

The UI **must not imply** a hard guarantee. Copy is neutral ("Delete"/"Edit"), not "Delete
for everyone / erased."

### 4.2 The group convention has zero external backing

There is **no Marmot MIP** for group-message edit or delete, and **no other Marmot client**
(Amethyst/Quartz, Pika) implements one. WhiteNoise has a *delete-only* inner-kind-5 extension;
that is the entire prior art. Our group edit/delete is a **Few-only convention**. It is safe
to invent (the kind-445 payload is already end-to-end encrypted, so we weaken nothing), but
the spec states in plain language that a non-Few group member will keep seeing the original.

### 4.3 This does not contradict the project's prior NIP-09 rejection

The emoji-reaction spec explicitly says *"do not rely on NIP-09 deletion events — they are
unreliable and don't compose with gift wrap"* (`specs/epic-emoji-feature/spec.md:217-221`),
and image-sharing deferred deletion citing *"no NIP-09 support in the chat layer"*
(`specs/epic-image-sharing/spec.md:230`). Those rejections are about **relay-facing** NIP-09:
a public kind-5 that asks relays to drop an event. That model is genuinely broken for
gift-wrapped content — the only relay-visible object is signed by a throwaway ephemeral key
that no longer exists, so the mandatory pubkey-match can never be satisfied.

The kind-5 in **this** feature is different in kind: it is **never published to a relay as a
deletion request**. It is a private, author-signed rumor tunneled through the *same* gift
wrap / MLS envelope as a chat message, interpreted **client-side** as a bilateral hint, and
stored as a **tombstone** — precisely the pattern the reaction-removal system already uses.
No relay is ever asked to enforce anything. The prior rejection stands; this feature does not
revive it.

### 4.4 MLS forward secrecy limits group deletion's reach

A member who joins a group **after** a message was sent cannot decrypt that message's
application event (MLS forward secrecy), so they never saw it and never receive its deletion
either. Group edit/delete is therefore only meaningful among members present at send time.
This is a property of the transport, not a bug to fix.

### 4.5 Deleting an image message leaves the blob

Image messages upload the file to Blossom and reference it by URL. Deleting the *message*
hides the reference but does not remove the *file*; anyone who retained the URL can still
fetch it. Blossom blob deletion (authenticated DELETE, best-effort, complicated by shared/
mirrored blobs) is explicitly **out of scope** (§7). The spec documents this so "delete" is
not oversold for images.

### 4.6 Two separate code paths must both be built

Group and DM chat do **not** share a store: groups use `ChatStoreContext`
(`app/src/context/ChatStoreContext.tsx`), DMs embed their logic in `ContactChat`
(`app/src/components/contacts/ContactChat.tsx`). `ChatBox` is shared for rendering, but send/
optimistic/rollback/inbound logic is duplicated (exactly as reactions were —
`sendReaction` in `ChatStoreContext` vs. `handleReact` in `ContactChat`). Edit/delete must be
implemented in **both**. The shared reconciliation function (§2.5) minimizes divergence but
cannot fully unify the two send paths.

### 4.7 Concurrency posture

Delete/edit inherit the app's existing **last-writer-wins** posture for mutation-by-reference
(ADR-003), resolved on the explicit **`rev` clock** (D12), never on the replacement's pinned
wire `created_at`. Concurrent edits of the same slot from two of the author's own devices
resolve to the higher `rev`; a delete and an edit for the same slot resolve to whichever has
the higher `rev`, with **delete winning ties** (safety), and two edits at the same `rev`
resolving by higher replacement rumor id (D15). A tombstoned slot is un-tombstoned only by an
edit replacement whose `rev` strictly exceeds the tombstone's `rev`. This is stated as
AC-ORDER-3 rather than left implicit.

Because `rev` is a self-reported wall clock, the sender **clamps** it monotonically per slot
(D16, §2.4) so a future-skewed device cannot pin a slot beyond the author's own reach; AC-AUTH-2
prevents any cross-user abuse (only the author signals their own slot). Residual: across the
author's *own* devices a slot's `rev` floor advances to the highest value any device has
emitted — a benign consequence of monotonicity, self-healing after one action from a
correct-clock device.

### 4.8 The DM interop claim is expected, not verified

NIP-17's text includes an *optional* clause allowing clients to delete by wrapping a `kind:5`
in a `kind:1059` gift wrap, and to edit by delete-plus-repost-at-same-timestamp — and NIP-17
and Amethyst share an author, which is why this is the best-available interop path. But
**whether a shipping Amethyst build actually processes an inner gift-wrapped `kind:5` for DMs
is not verified in this spec.** The repo has a precedent for settling exactly this kind of
question by reading Amethyst source directly (`amethyst-interop-answers.md`, for the unrelated
AC-WebRTC work). Before relying on the interop row of §1, that verification SHOULD be done;
until then MV-2 is a **gating** manual check, and no AC asserts non-Few honoring as a
guarantee (AC-INTEROP-2).

### 4.9 Notifications may outlive a silent delete/edit

A push/local notification fired for the original message quotes content that a subsequent
delete or edit silently changes. v1 does not reconcile already-delivered notifications; a
notification may therefore still show text the message no longer contains. This is a known,
accepted v1 limitation (§7), surfaced here so it is a decision rather than an oversight.

---

## 5. Acceptance criteria

### Delete
- **AC-DEL-1**: A user MUST be able to delete a message they authored, in both DM and group
  threads, for text and image messages.
- **AC-DEL-2**: On delete, the message MUST be removed from the author's view immediately
  (optimistic), and MUST be restored if the publish fails.
- **AC-DEL-3**: A cooperating Few recipient that holds the target message MUST stop rendering
  it (and its reactions) upon processing the delete signal — silent removal, no placeholder.
- **AC-DEL-4**: The delete signal MUST be an author-signed inner kind-5 referencing the
  original id via `e`-tag; for DMs it MUST be sealed + gift-wrapped to the original recipient
  set; for groups it MUST be sent as an MLS application rumor. It MUST NOT be published as a
  relay-facing kind-5.
- **AC-DEL-5**: A deleted message's row MUST be retained locally as a tombstone (not
  physically purged), so re-delivery of the original rumor MUST NOT resurrect it.
- **AC-DEL-6**: Deleting MUST require a confirmation step.
- **AC-DEL-7**: A standalone delete's kind-5 MUST NOT carry the `"edit"` marker; a lone
  unmarked kind-5 MUST be interpreted as a delete, and an `edit`-marked kind-5 MUST be ignored
  by a Few client (AC-ORDER-3 depends on this distinction).
- **AC-DEL-8**: A delete/edit kind-5 MUST `e`-tag the original id, **plus** any prior
  replacement ids of the slot **that the sender still retains**. Because Few uses in-place
  storage with no retained revision history (§7), a Few sender retains **no** prior replacement
  ids, so in practice the signal e-tags the original id alone. This is a **best-effort** D14
  degradation aid for non-Few clients, not a guarantee (§4.8, AC-INTEROP-2): a message edited
  more than once and then deleted may leave its superseded replacement copies visible on a
  non-Few NIP-17 client. Few clients are unaffected (they reconcile by the original id alone,
  AC-EDIT-6). See the 2026-07-07 amendment for the product decision behind this scoping.

### Time (no limit)
- **AC-TIME-1**: Edit and delete MUST be offered regardless of the target message's age; no
  time window may gate them (D6).

### Edit
- **AC-EDIT-1**: A user MUST be able to edit a **text** message they authored, in both DM and
  group threads.
- **AC-EDIT-2**: On edit, the message content MUST update **in place** (retain its position),
  not append at the bottom.
- **AC-EDIT-3**: An edited message MUST render an "(edited)" marker on both DM and group
  surfaces.
- **AC-EDIT-4**: The edit signal MUST comprise (a) a replacement chat rumor (kind-14 DM /
  kind-9 group) whose wire `created_at` **field** (Unix seconds) equals the original rumor's
  `created_at`, and whose tags include `["e", <originalId>, "", "edit"]` and `["rev", <real
  Unix seconds>]`; **plus** (b) a companion `edit`-marked kind-5 (§2.4) for non-Few
  degradation. The `created_at` equality is asserted on the wire rumor field, not the
  millisecond `ChatMessage.createdAt` storage value. Across a repeated-edit chain, "the
  original rumor's `created_at`" always means the **first** message's `created_at` (the stable
  slot anchor, §2.1), never the immediately-prior edit's.
- **AC-EDIT-5**: An edit that would produce empty content MUST be disallowed (the user is
  directed to delete instead).
- **AC-EDIT-6**: Repeated edits MUST reference the original message id (stable anchor); the
  slot's id MUST NOT change across edits.
- **AC-EDIT-7**: Reactions on a message MUST survive an edit of that message.
- **AC-EDIT-8**: A Few client MUST apply an `edit`-marked replacement as a complete edit
  **without requiring** the companion kind-5; a failed/absent kind-5 MUST NOT cause the slot
  to be deleted. On publish failure the optimistic edit MUST be rolled back to the prior
  content. The replacement MUST be published before the companion kind-5.

### Authorization (own-messages-only)
- **AC-AUTH-1**: Edit/delete affordances MUST appear only on messages authored by the current
  user.
- **AC-AUTH-2**: On receive, a delete/edit signal MUST be honored only if its author pubkey
  matches the original message's author pubkey; a signal from any other author MUST be
  ignored. **DM: fully enforced** — the pubkey is cryptographically bound via the seal's
  real-key signature (`unwrapAndOpen`). **Group: best-effort (group-member-attested)** — the
  signal is authorized on its self-asserted inner rumor pubkey, but marmot-ts 0.5.1 does **not**
  expose the MLS-authenticated sender leaf credential for application messages (verified against
  ts-mls source; see the 2026-07-07 amendment and `BACKLOG.json#marmot-ts-0-5-1-drops`), so this
  pubkey is NOT cryptographically bound to the sending member. MLS still guarantees the sender is
  a **current group member** (non-members cannot forge anything), so the residual is a malicious
  in-group member impersonating another member — the **same trust model Few already applies to
  group kind-9 messages and kind-7 reactions**, not a new exposure. A relay-facing kind-5 is never
  used (§4.3), and the DM path is unaffected. The full MLS-identity binding is tracked as an
  upstream marmot-ts fix.

### Storage & dedup
- **AC-STORE-1**: For an identical set of signals delivered in any order, the DM and group
  transports MUST converge to an **identical rendered local model** (behavioral invariant; a
  shared reconciliation function is the recommended, but not the verifiable, means).
- **AC-STORE-2**: Tombstoned and edited rows MUST remain dedup-stable — reprocessing the same
  signal MUST be idempotent.
- **AC-STORE-3**: Re-delivery of an **original** message rumor MUST NOT revert an already
  edited or tombstoned slot (the original carries no `rev` and MUST NOT override a signal;
  upsert-by-id MUST NOT clobber edited content or the edited/tombstone flags).

### Ordering
- **AC-ORDER-1**: A delete/edit signal whose target id is unknown at receive time MUST be
  retained (with authorization deferred to application time) and applied when the target
  arrives (NOT discarded).
- **AC-ORDER-2**: Pending unresolved signals MUST be bounded by an explicit cap and TTL (a
  named constant, reusing the app's existing buffered-state bound — not an unstated value).
  The buffer MUST be **keyed per unresolved target id**, collapsing to the **max-`rev`** pending
  signal per id on insert (not storing every historical signal for that id); this keeps
  eviction from being an arrival-order accident that could drop a higher-priority pending
  signal under buffer pressure while a lower-priority one survives. Eviction under the cap
  removes oldest **targets**, not raw signals.
- **AC-ORDER-3**: Reconciliation MUST be order-independent: the slot's rendered state MUST
  equal the outcome of its **highest-`rev`** signal for every arrival order of {original,
  delete, edit-replacement}. Ties MUST resolve deterministically: **delete-vs-edit at equal
  `rev` → delete wins**; **edit-vs-edit at equal `rev` → higher replacement rumor id wins**
  (D15). No arrival order or multi-device split may produce divergent final content.
- **AC-ORDER-4**: On buffer expiry, a pending **delete** whose target never arrived MUST
  persist a **content-free tombstone marker** keyed by the target id (id-only, no row) — so a
  later-arriving original for that id is still suppressed and MUST NOT render. A pending
  **edit-marked replacement** whose original never arrived MUST be **materialized under its
  original (`e`-tagged) slot id** — retaining its `rev`, rendered as an ordinary message
  without the "(edited)" marker — so a later original or delete for that id reconciles normally
  instead of forming a duplicate slot. Both branches persist their effect on expiry; neither
  silently drops it. The persisted delete-marker set is **cap-bounded** (same cap as the pending
  buffer, AC-ORDER-2) but is **NOT** TTL-expired — a marker is durable suppression of a retracted
  message, so ageing it out would resurrect that message; markers are evicted only under cap
  pressure (oldest first), never by age. Reconciliation is additionally **self-healing**: a
  pending signal or marker whose target row already exists is applied to that row directly
  (deferred authorization is satisfiable from the row's own author), so a missed resolve call or
  a crash between append and resolve converges on the next signal or thread-open sweep rather
  than diverging permanently.
- **AC-ORDER-5**: `rev` MUST be sender-clamped to `max(wallSeconds, slot's last-known rev + 1)`
  (D16); a signal's slot MUST be resolvable by matching any of its `e`-tagged ids against the
  slot's original id or any stored replacement id (§2.5).

### Rendering & lists
- **AC-LIST-1**: Once an edit signal for a thread's last message has been processed, that
  thread's list preview MUST reflect the new text. (If DM ingest only runs while a thread is
  open, "processed" occurs on next open; the spec does not require a background DM ingest path
  — see §4.6 / implementation note.)
- **AC-LIST-2**: Once a delete signal for a thread's last message has been processed, the
  preview MUST fall back to the previous surviving message (or the empty state).

### Images
- **AC-IMG-1**: An image message MUST be deletable (tombstoned) like any other message.
- **AC-IMG-2**: An image message MUST NOT offer an edit affordance.
- **AC-IMG-3**: Deleting an image message MUST NOT attempt to remove the Blossom blob; the
  file remaining fetchable is a documented limitation, not a defect.

### i18n `[ADDED]`
- **AC-INTL-1**: All new user-facing strings (edit/delete actions, "editing" state, cancel,
  delete confirmation, "(edited)") MUST have both `en` and `de` entries in
  `app/src/lib/i18n.ts` and MUST be consumed via `useCopy()`.
- **AC-INTL-2**: No new user-visible string may be hardcoded in a component.

### Interop honesty `[ADDED]`
- **AC-INTEROP-1**: No UI copy may imply a hard/enforced deletion (e.g. "erased",
  "deleted for everyone"). Copy MUST remain neutral.
- **AC-INTEROP-2**: No AC or UI copy may assert that a non-Few client honors delete/edit as a
  guarantee. Non-Few DM interop is expected-but-unverified (§4.8) and MUST be treated as a
  best-effort degradation, validated only by the gating manual check MV-2.

## Manual Validation
- **MV-1**: DM delete/edit sent from Few is honored by a second Few client (message hides /
  updates in place with "(edited)").
- **MV-2**: DM delete sent from Few, observed on a NIP-17 non-Few client (e.g. Amethyst),
  hides the original (best-effort interop check; degradation for edit acceptable).
- **MV-3**: Group delete/edit sent from Few is honored by a second Few group member. **(Conditional
  / known-limitation)** — this validates the honored-by-cooperating-Few behavior only; it does NOT
  assert cryptographic sender authentication, which is a documented upstream gap (AC-AUTH-2 group
  clause, `BACKLOG.json#marmot-ts-0-5-1-drops`). A forged-pubkey resistance check is out of scope
  until the upstream marmot-ts fix lands.
- **MV-4**: A delete signal that arrives before its target message (simulated ordering)
  results in the message never rendering (pending-apply works).
- **MV-5**: Reactions on a message survive an edit and vanish on a delete.
- **MV-6**: Order-independence — for the same message, the arrival orders (edit→delete),
  (delete→edit), and (edit#1→edit#2 delivered reversed) all converge to the same final render
  (delete wins; newest edit wins), confirming the `rev`-clock reconciliation (AC-ORDER-3).

---

## 6. Implementation pointers (non-binding)

- **Wire builders:** model on `app/src/lib/reactions/rumor.ts` (`e`/`k` reference tags). Add
  (1) a kind-5 delete builder (unmarked; `e`-tags original + prior replacement ids; own
  `created_at` = `rev`), (2) an edit-replacement builder (chat rumor; wire `created_at` pinned
  to the original's **seconds** field; `["e", origId, "", "edit"]` + `["rev", nowSeconds]`),
  and (3) a marked-kind-5 companion for the edit. Note `ChatMessage.createdAt` is **ms**
  (`chatPersistence.ts:22`) while the wire `created_at` is **seconds** — pin the seconds field.
- **DM send/receive:** `app/src/lib/directMessages.ts` (`buildChatRumor`, `sealAndWrap`,
  `unwrapAndOpen`) and the inbound branch in `app/src/components/contacts/ContactChat.tsx`.
- **Group send/receive:** `app/src/context/ChatStoreContext.tsx` (`sendMessage`,
  `sendRumorSafe`, optimistic + version-bump), plus a new handler registered in
  `app/src/lib/marmot/registerHandlers.ts` and dispatched via
  `app/src/lib/marmot/applicationRumorDispatcher.ts`.
- **Shared reconciliation:** a new function analogous to `applyInboundRumor`
  (`app/src/lib/reactions/api.ts:301`) consumed by both transports.
- **Storage:** extend `ChatMessage` (`app/src/lib/marmot/chatPersistence.ts:16-30`) with a
  tombstone flag, an edited flag, and the slot's current `rev`. Note the current
  `appendMessage` (`chatPersistence.ts:244-262`) is **insert-if-absent** (it early-returns on a
  known id and never overwrites), *not* an upsert — so the update-in-place path an edit needs
  (overwrite a slot's content by original id) is **new code**, not a guard bolted onto existing
  overwrite behavior. Add (a) that update-in-place path, and (b) the AC-STORE-3 clobber-guard so
  a re-delivered original (no `rev`) cannot revert an edited/tombstoned slot. Do not reuse the
  physical `removeMessages` (self-heal / ADR-001-002 purge path only) for user delete.
- **Rendering:** `app/src/components/chat/ChatBox.tsx` — "(edited)" near the timestamp
  (`:510-524`), edit/delete actions in the per-bubble hover area (`:572-595`), filter
  tombstoned rows out of render (mirror reaction `removed` handling).
- **Optimistic/rollback:** mirror `applyOptimistic` / `rollbackOptimistic`
  (`app/src/lib/reactions/api.ts:213-280`).
- **i18n:** add keys under the groups/chat namespace in `app/src/lib/i18n.ts` (en + de).
- **E2E:** per project rule, drive publishes through the app (a second `browser.newContext()`
  peer), never raw WebSocket. Cover: DM edit, DM delete, group edit, group delete, ordering
  (signal-before-target), reactions-survive-edit / vanish-on-delete.

---

## 7. Out of scope

- **Admin/moderator deletion of other members' messages.** Own-messages-only in v1. A future
  feature would build on `epic-feature-request-admin-role-management-for-groups` and must
  answer "which clients honor an admin delete."
- **Editing image messages or image captions.** Delete-only for images in v1.
- **Blossom blob removal on image delete.** The file stays; only the message reference is
  hidden.
- **Edit/revision history.** Edit is full-replace; no prior versions are retained or shown.
- **Reconciling already-delivered notifications.** A notification fired before a delete/edit
  keeps its original text (§4.9). Not reconciled in v1.
- **Time-limited edit/delete windows.** No age limit in v1.
- **Relay-facing NIP-09.** Never used (see §4.3).
- **Guaranteed/enforced deletion.** Impossible by construction; not attempted.

## Constrained by ADRs
- **ADR-003** (last-writer-wins for reference-based mutations) — governs the concurrency
  resolution in §4.7 / AC-ORDER-3. ADR-003's decision content was backfilled on 2026-07-07;
  this epic is now a listed consumer in its `Affects:` line.
- **ADR-001 / ADR-002** (DM-history purge on losing shared-group membership; walled-garden
  posture) — adjacent deletion semantics; this feature's tombstones must coexist with those
  existing purge paths without conflict.
- **ADR-006** (group-member-attested authorization for MLS application-message mutations) —
  governs AC-AUTH-2's group clause: group delete/edit is authorized on the self-asserted inner
  rumor pubkey, not a cryptographic binding to the MLS-authenticated sender leaf, because
  marmot-ts 0.5.1 drops that leaf for application messages. Curator-promoted 2026-07-07 from
  the S5-review product decision recorded in `## Amendments` below.

## Amendments

### 2026-07-07 — spec-validation resolutions (pre-implementation)
Resolved during `/base:feature` Step 2 validation:
- **Delete on buffer expiry (§2.8 / AC-ORDER-4)** — changed from "silently dropped" to
  "persist a content-free tombstone marker keyed by target id." A pending delete whose target
  first arrives *after* the buffer window previously rendered the message as un-retracted,
  contradicting the feature's core promise (§2.8). Now symmetric with the edit branch's
  materialize-on-expiry: both persist their effect. The marker set is bounded by the same
  cap/TTL as the pending buffer.
- **Buffer eviction (AC-ORDER-2)** — clarified the pending buffer is keyed per target id,
  collapsing to the max-`rev` signal per id, evicting oldest *targets* (not raw signals), so
  buffer pressure cannot drop a higher-priority pending signal as an arrival-order accident.
- **AC-EDIT-4** — clarified "the original rumor's `created_at`" means the *first* message's
  `created_at` across a repeated-edit chain, never the prior edit's.
- **§6 storage pointer** — corrected: current `appendMessage` is insert-if-absent, not upsert;
  the update-in-place path an edit needs is new code, not a guard on existing overwrite.
- **ADR-003** — backfilled from a template stub to real decision content (the LWW substance was
  already stated in §4.7); citation is now load-bearing rather than hollow.
### 2026-07-07 — AC-AUTH-2 group clause scoped to best-effort (product decision, during S5 review)
The S5 review found AC-AUTH-2's group clause ("via the MLS-authenticated rumor pubkey") is not
satisfiable in-app. Verified against ts-mls/marmot-ts 0.5.1 source (marmot-researcher): the library
returns only the decrypted `{message: Uint8Array}` for an application message and **drops the MLS
sender leaf credential** (proposals retain it; `unprotectPrivateMessage` is not exported), so the
inner rumor's `pubkey` cannot be compared to the authenticated sender. The Marmot protocol spec
itself requires this check (`group-messaging.md:43`) — it is an unmet upstream requirement.
**Consequence:** a malicious current group member can forge the inner pubkey to impersonate another
member's delete/edit. **Mitigating facts:** MLS still bars non-members entirely; this is the *same*
trust model Few already applies to group kind-9 messages and kind-7 reactions (a member can already
impersonate another member's message/reaction today); and DMs are fully secure (seal signatures).
**Product-owner decision: ship group edit/delete with the documented group-member-attested trust
model** rather than block the group half on an external library change. AC-AUTH-2's group clause is
amended accordingly; a BACKLOG finding (`marmot-ts-0-5-1-drops`) tracks the upstream fix (surface
the sender leaf, verify `rumor.pubkey === senderCredentialPubkey` in `applicationRumorDispatcher`
for all kinds — which also closes the pre-existing kind-9/kind-7 impersonation hole); and MV-3 is
downgraded to a conditional/known-limitation check. A `getGroupMembers` membership check was
considered and rejected: it does not stop a member impersonating another *member* (the actual
threat) and would add a false sense of security.

### 2026-07-07 — AC-DEL-8 scoped to best-effort (product decision, during S4 review)
The S4 review found AC-DEL-8's "e-tag **every** prior replacement id" is structurally unmet:
Few's in-place storage (§7, no revision history) retains no prior replacement ids, and adding a
per-slot id chain would reopen the hardened S3 seam and thread through both transports solely to
improve a **non-Few** degradation path that no automated gate verifies. **Product-owner decision:
cross-client support is not a current priority; optimize for Few-side implementation simplicity.**
AC-DEL-8 (and D14) are therefore scoped to "the original id plus any prior replacement ids the
sender still retains" — for a Few sender, the original id alone. Consequence: a message edited
more than once then deleted may leave superseded replacement copies visible on a non-Few NIP-17
client. This sits within the already-authorized best-effort/unverified non-Few envelope (§4.8,
AC-INTEROP-2); Few clients are unaffected (they reconcile by the original id alone). The
`priorReplacementIds = []` in the wire builders is correct-by-design under this decision.

### 2026-07-07 — S3 review resolutions (reconciliation crash-safety)
Resolved during the S3 (reconciliation core) dual-model review:
- **Delete markers are cap-bounded, NOT TTL-expired (§2.8 / AC-ORDER-4)** — the earlier "same
  cap/TTL as the pending buffer" wording was imprecise. A marker's purpose is durable
  suppression; TTL-expiring it would resurrect a retracted message. Markers are evicted only
  under cap pressure. The *pending buffer* keeps its cap **and** TTL (its entries are unresolved
  signals, not yet durable effects); only the post-expiry *marker set* is cap-only.
- **Reconciliation is self-healing (§2.8 / AC-ORDER-4)** — a pending signal or delete-marker
  whose target row already exists is applied to that row directly (deferred authorization is
  satisfiable from the row's own author). This converts a missed `resolvePendingSignalsForSlot`
  call or a crash between append and resolve from a *permanent* divergence into eventual
  consistency on the next signal or thread-open sweep. It also downgrades the S4/S5
  resolve-after-append call from load-bearing to an optimization (still required for prompt
  application, but no longer the sole path to correctness).
- **Poisoned-clock residual (AC-ORDER-3)** — order-independence is guaranteed for well-formed,
  sanely-clocked signals. Under an adversarial/broken *author* device emitting distinct
  far-future revs, the ingest rev-cap (`wallSeconds + MAX_REV_SKEW`) can map them onto
  processing-time order, a bounded best-effort divergence in that regime only (AC-AUTH-2 still
  prevents cross-user abuse). Documented as an accepted residual — a fully deterministic clock
  is impossible with self-reported timestamps.

### 2026-07-07 — pre-implementation resolutions (continued)
- **AC tag rename `I18N` → `INTL`** — the two internationalization ACs were renamed
  `AC-I18N-1/2` → `AC-INTL-1/2`. Purely mechanical: the story schema's AC-ID pattern permits
  only alphabetic tags, and `I18N` contains a digit. No behavioral change; the `i18n.ts`
  filename and all prose references are unaffected.
