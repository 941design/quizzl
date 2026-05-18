# Feature Spec: Out-of-Band Group Leave

## Goal

Allow a group member to leave without sending an MLS Remove proposal, which blocks all other members from sending application messages until an admin commits it. Instead, the leaving member broadcasts a "leave intent" as an MLS application message, purges local state, and relies on an admin to perform the actual MLS removal asynchronously.

## Background

### The problem

In MLS (RFC 9420), a member cannot commit their own removal. They must send a Remove **proposal**, which another member (an admin, per MIP-03) must include in a **commit**. Until that commit happens:

- `state.unappliedProposals` is non-empty for every group member.
- ts-mls enforces `checkCanSendApplicationMessages`, which throws `UsageError("Cannot send application message with unapplied proposals")`.
- **The entire group is blocked** from sending chat messages, polls, scores, and profile updates.

The group stays blocked until an admin comes online and commits the proposal. In practice this means a single member leaving can silently break the group for minutes, hours, or indefinitely.

### Current workaround (soft-mute)

As an interim measure, `leaveGroup()` was changed to a client-side-only operation: it purges all local data (group metadata, scores, profiles, chat, polls, unread counts) but does **not** call `mlsGroup.leave()`. No MLS proposal is sent, so the group is never blocked.

The downside: the departed member remains in the MLS ratchet tree as a "ghost leaf". They cannot decrypt new messages (local state is gone), but their key material is not rotated out, which is a theoretical forward-secrecy concern. Other members also still see the ghost in the member list.

### Design goals for the real fix

1. **No group blocking.** A leave must never produce an unapplied MLS proposal.
2. **Eventual removal.** The departed member's leaf should be removed from the ratchet tree and keys rotated, but on the admin's schedule.
3. **Visible departure.** Other members should see that someone left, both in the member list and in the chat.
4. **Works offline.** If the admin is offline when the leave happens, removal happens automatically when they reconnect.

## Scope

### In Scope

- Voluntary departure: a member initiates leave via the existing "Leave Group" UI.
- A new MLS application message kind (13) carrying a `LeaveIntentPayload`.
- An auto-remove path on admin clients that consumes kind 13, debounces, and commits a Remove proposal plus an `adminPubkeys` metadata update in the same commit.
- A kind-9 system chat announcement, sent by the departing member fire-and-forget alongside the kind-13 send.
- Member-list refresh on the resulting `onMembersChanged` callback.

### Out of Scope

- Forced removal (kicking) of a non-leaving member — separate feature.
- Persisting the pending-removals queue across app restarts (relay re-ingest covers crash recovery; see Data Model).
- Removing the ghost leaf from groups whose only remaining members are non-admins (pre-admin-promotion groups). The soft-mute fallback is acceptable here.
- Notification badges for non-admin members when someone leaves.

## Non-Goals

- **No forced-removal v1.** Admin-initiated removal of a non-departing member is a separate feature with a different threat model (the target may not consent to removal). Out of scope here.
- **No leave-reason capture.** The `LeaveIntentPayload` carries no `reason` field. Adding one was considered and explicitly rejected as complexity for minimal benefit.
- **No persisted pending-removals queue.** Restart recovery comes from relay re-ingest, not local persistence.
- **No leave notification UX for non-admins.** Non-admins do not get a notification badge when a leave intent arrives; the chat announcement is the only user-visible signal.

## Relationship to Other Epics

- **`epic-feature-spec-unified-mls-application-rumor-dispatch` (DONE)** — established the unified-dispatch contract: all `applicationMessage` kind dispatch lives in `registerHandlers.ts` / handler modules under `app/src/lib/marmot/handlers/`, not in `MarmotContext` or other context files. AR-1 enforces that `group.on('applicationMessage'` returns exactly one occurrence in the codebase; AR-3 enforces that no `rumor.kind ===` branches exist in `app/src/context/`. This spec MUST register kind-13 dispatch through `buildDispatcher()` in `registerHandlers.ts`, NOT add a new branch in `MarmotContext`. See decision (1) under Key Decisions and the "Modified Components" / "New Handlers" tables under UI Components.
- **`epic-mls-fork-resolution` (DONE)** — established `EpochResolver` for deterministic fork resolution when two clients commit concurrently to the same epoch. This spec relies on that infrastructure for the dual-admin race (see Edge Cases). No new fork-resolution logic is introduced here.
- **`epic-cancel-pending-invitations` (DONE)** — established the canonical pattern for building Remove proposals via `extraProposals` on `group.commit()` using plain-object `{ proposalType: 3, remove: { removed: leafIndex } }` shape. This spec adopts that pattern verbatim (see Flow 2 step 5c and `cancelInvitationImpl.ts` as the reference implementation).

## Key Decisions

### 1. Leave intent is an MLS application message (kind 13), routed through the unified dispatcher

The leaving member sends a new application message kind (13) containing a `LeaveIntentPayload`. This is an encrypted group message like chat or polls — it does **not** create an MLS proposal and therefore does not block the group.

Dispatch on the receiving side lives in a new `app/src/lib/marmot/handlers/leaveHandler.ts`, registered in `buildDispatcher()` in `registerHandlers.ts`, following the pattern of `pollHandler.ts`. The pending-removal queue and the 5-second debounce timer are owned by `MarmotContext` (because the auto-commit side-effect needs the active `group` reference and the same `sendRumorSafe` infrastructure used elsewhere), but the kind-13 dispatch itself does NOT live in `MarmotContext.applicationMessage` — that would regress AR-1 and AR-3 of the shipped unified-dispatch epic. The handler receives a callback dep injected from `MarmotContext` that enqueues the pending removal and arms/extends the timer.

### 2. Any admin commits the removal

When an admin's client receives a kind 13 message, it automatically commits a Remove proposal for the departing member's leaf index. Since all members are promoted to admin on invite, any online member can perform this role.

### 3. Leaving member purges local state immediately

After sending the leave intent, the member deletes all local data for the group (same as the current soft-mute). They do not wait for the admin to commit the removal.

### 4. Grace period before auto-remove

The admin waits a short grace period (5 seconds) after receiving a leave intent before committing the removal. This batches multiple simultaneous leaves into a single commit and avoids commit races between admins.

### 5. Chat announcement on departure

A system-style chat message is rendered when a leave intent is received: _"{Member} left the group"_. This provides the same visibility as the poll open/close announcements.

## MLS Application Message Payload

### Kind 13 -- Leave Intent

```typescript
interface LeaveIntentPayload {
  /** Pubkey of the departing member (hex). Redundant with MLS sender but
   *  included for convenience, same pattern as poll creatorPubkey. */
  pubkey: string;
}
```

Serialized as JSON in the application message content field. The MLS sender identity authenticates the departure.

## Flows

### Flow 1: Member leaves the group

1. Member clicks "Leave Group" and confirms.
2. Client builds a `LeaveIntentPayload` (kind 13) and sends via `group.sendApplicationRumor(rumor)`.
   - If the send fails due to unapplied proposals from a **different** pending leave, use `sendRumorSafe` to auto-commit first.
3. Client builds a kind-9 chat announcement with structured content `{ type: "leave_intent", pubkey: <own pubkey> }` and sends it via the existing chat-send path. **Fire-and-forget**: if the send rejects or times out, the member proceeds regardless. The kind-13 message remains the canonical departure signal.
4. Client purges all local data for the group:
   - Group metadata from IndexedDB
   - Member scores, profiles, chat, polls, unread counts
5. Client navigates to `/groups/`.
6. The member is done. They do not wait for the removal commit.

### Flow 2: Admin receives a leave intent

1. MLS application message arrives at `buildDispatcher()` in `registerHandlers.ts` and is routed to `leaveHandler.ts`. Deserialize kind 13 `LeaveIntentPayload`.
2. The handler invokes the injected enqueue callback supplied by `MarmotContext`. The callback adds an entry to the in-memory pending-removals queue, keyed by `(groupId, pubkey)`, and arms/extends the per-group debounce timer.
3. The chat announcement (kind 9, `{ type: "leave_intent" }`) does NOT come from Flow 2 — the departing member sends it in Flow 1. The receiving client simply renders it when it arrives through the normal chat-rendering path.
4. The per-group 5-second debounce timer batches multiple simultaneous leaves into a single commit and provides a small window for cooperative scheduling between admins (see Edge Cases for the dual-admin race).
5. When the timer fires:
   a. For each pending pubkey, look up the leaf index in the ratchet tree via `getGroupMembers()`. If a pubkey is no longer in the tree (already removed by another admin's commit), drop it from the queue and skip — see Edge Cases.
   b. Build Remove proposals as plain objects following the canonical pattern from `app/src/lib/marmot/cancelInvitationImpl.ts`:
      ```typescript
      const removeProposals = leafIndexes.map(leafIndex => ({
        proposalType: PROPOSAL_TYPE_REMOVE,
        remove: { removed: leafIndex },
      }));
      ```
      Do NOT use `proposeRemoveUser()` or a `Proposals.Remove(...)` factory — see `cancelInvitationImpl.ts` for the API-nesting bug (a `proposeRemoveUser()` array gets pushed as a single `extraProposals` element and silently dropped) that drove this pattern.
   c. Build the `adminPubkeys` metadata update via the `Proposals.proposeUpdateMetadata` factory and include it in the **same** `commit` call as the Remove proposals — one epoch transition, both proposals in the `extraProposals` array (canonical pattern: `cancelInvitationImpl.ts`):
      ```typescript
      const remainingAdmins = currentAdminPubkeys.filter(pk => !departingPubkeys.includes(pk));
      await mlsGroup.commit({
        extraProposals: [
          ...removeProposals,
          Proposals.proposeUpdateMetadata({ adminPubkeys: remainingAdmins }),
        ],
      });
      ```
      A single commit keeps the admin list and the ratchet tree consistent for observers. Do NOT issue `proposeUpdateMetadata` as a separate `await` before `commit` — that is two epoch transitions and lets observers see an inconsistent intermediate state.
   d. On success, clear the pending-removals queue entries for the pubkeys that were just removed. Leave any unrelated entries (added during the commit window) intact for the next timer cycle.
   e. On failure, do NOT blindly retry with the same `removeProposals` array — the local MLS state may have advanced if the commit succeeded locally but the publish failed, making the cached leaf indexes stale. Re-run step 5a (look up leaf indexes from the current ratchet tree) on the next timer tick or next incoming event before re-attempting the commit.
6. The commit propagates to all members. Their `onMembersChanged` callback fires, updating the member list.

### Flow 3: Admin is offline when leave happens

1. The leave intent (kind 13) is stored on the relay as a kind:445 event.
2. When the admin comes online, the historical sync in `subscribeToGroupMessages` fetches and ingests the leave intent.
3. The auto-remove logic from Flow 2 fires, committing the removal.
4. In the meantime, the group was **not** blocked because no MLS proposal was sent.

### Flow 4: All admins have left

Edge case: every member leaves except the last one, or all admins leave.

1. If the last member leaves, the group is effectively abandoned. No action needed.
2. If non-admin members remain (only possible in pre-existing groups), they cannot commit the removal. The ghost leaf stays in the tree. This is no worse than the current soft-mute behavior.

## Data Model

### LeaveIntent (in-memory queue)

```typescript
interface PendingRemoval {
  /** Group ID */
  groupId: string;
  /** Pubkey of the departing member */
  pubkey: string;
  /** Timestamp of the leave intent (Unix ms) */
  receivedAt: number;
}
```

The pending-removals queue is **in-memory only** (a `Map<groupId, PendingRemoval[]>` held by `MarmotContext`). No IndexedDB persistence. Restart recovery is delivered by relay re-ingest: when the app restarts, the historical sync in `subscribeToGroupMessages` re-delivers unprocessed kind-13 messages through `leaveHandler.ts`, repopulating the queue. The 5-second debounce window absorbs the resulting burst on cold start.

The per-group debounce timer is also in-memory (a `Map<groupId, NodeJS.Timeout>` held by `MarmotContext`, cleared on group unmount).

## UI Components

### Modified Components

| Component | Change |
|-----------|--------|
| `MarmotContext` | Own the pending-removals queue (`Map<groupId, PendingRemoval[]>`), the per-group debounce timer (`Map<groupId, NodeJS.Timeout>`), and the auto-commit callback. Expose an enqueue function injected as a dep into `leaveHandler.ts` via `registerHandlers.ts`. Keep `mlsGroup.leave()` absent from `leaveGroup()` (already done in soft-mute) and replace the soft-mute no-op with a kind-13 `sendApplicationRumor` call + the kind-9 announcement send (fire-and-forget) before the local state purge. |
| `ChatStoreContext` / `GroupChat` | Detect `{ type: "leave_intent" }` chat announcements and render `LeaveChatAnnouncement`. |
| `LeaveGroupButton` | No change needed — it already calls `leaveGroup()` and navigates away. |
| `registerHandlers.ts` / `buildDispatcher()` | Register `leaveHandler.ts` for kind 13, injecting the `MarmotContext` enqueue callback as a dep. Mirrors the existing `pollHandler.ts` registration. |

### New Components

| Component | Purpose |
|-----------|---------|
| `app/src/lib/marmot/handlers/leaveHandler.ts` | Deserialize kind-13 `LeaveIntentPayload`, invoke the injected enqueue callback. No direct MLS-state access; the side-effecting commit lives in `MarmotContext`. Pattern source: `pollHandler.ts`. |
| `app/src/lib/marmot/leaveSync.ts` | Define `LEAVE_INTENT_KIND = 13`, the `LeaveIntentPayload` type, and serialize/parse helpers. Pattern source: `pollSync.ts`. |
| `LeaveChatAnnouncement` | Renders _"{member} left the group"_ system message in the chat, same style as `PollChatAnnouncement`. |

## Chat Message Rendering

### Leave Announcement (kind 9, structured)

```
 +---------------------------------------+
 |  Bob left the group                   |
 +---------------------------------------+
```

The leave intent (kind 13) is sent separately from the chat announcement. The chat announcement is a kind 9 message with structured content: `{ type: "leave_intent", pubkey: "..." }`, **sent by the departing member alongside the kind-13 send** (Flow 1 step 2). The send is fire-and-forget: if it fails for any reason, the leaving member proceeds with local-state purge regardless. The kind-13 message itself remains the canonical signal — if the kind-9 announcement is missing for any reason, other members still observe the departure when the auto-remove commit fires and `onMembersChanged` updates the member list.

This matches the pollSync pattern: the originating member emits both the protocol-level message and the chat announcement from the same client in the same tick.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Leave intent but admin never commits | Ghost leaf stays in tree. No group blocking. Same as current soft-mute. Forward-secrecy gap until another commit rotates keys. |
| Multiple members leave simultaneously | Debounce timer batches removals into a single commit. |
| Multiple admins try to commit the same removal | Only one commit wins (deterministic fork resolution via EpochResolver). The other is rolled back. |
| Leave intent arrives after member was already removed | Ignore — the pubkey is no longer in the ratchet tree. |
| Leave intent from unknown pubkey | Ignore — MLS sender verification ensures authenticity. |
| Network partition: leave intent not delivered | The member has already purged local state. When connectivity returns, the intent is delivered and processed. |
| Leave intent + unapplied proposals | The admin's auto-remove commit also commits any other pending proposals, clearing the backlog. |
| Departed member tries to rejoin | They would need a fresh invite (new KeyPackage, new Welcome). The old leaf is removed by the admin's commit. |
| Two admins both fire their debounce timer for the same pubkey | Only one commit wins (deterministic fork resolution via `EpochResolver`). The losing admin's commit is rolled back. On receiving the winning commit via `onMembersChanged`, the losing admin's client clears the matching pubkeys from its pending-removals queue (Flow 2 step 5a re-checks the ratchet tree on the next timer tick anyway, so the worst case is a wasted commit attempt — never a duplicate Remove). |
| `group.commit` succeeds locally but publish fails | Local MLS state has already advanced; the cached `removeProposals` array is now stale. The retry path MUST re-run Flow 2 step 5a (look up leaf indexes again) before re-attempting the commit. Blind retry with the cached proposals would target stale leaf indexes. |
| Auto-remove commit rolled back by concurrent chat/poll commit from same admin | Both commits target the same epoch; `EpochResolver` rolls one back. The pending-removals queue still contains the entry, so the auto-remove re-fires on the next timer tick or next inbound event — the retry path re-derives leaf indexes (Flow 2 step 5a), so this resolves automatically. |
| Departed member is the only admin | Edge case under the v1 admin-promotion model: every member is promoted to admin on invite, so this shouldn't happen in groups created after the promotion feature shipped. For pre-promotion groups where the departing member is the sole admin, the ghost leaf persists (same as current soft-mute). |

## Caveats

### Ghost window

Between the leave intent and the admin's removal commit, the departed member's leaf is still in the ratchet tree. Messages sent during this window are encrypted to a key set that includes the ghost. Since the departed member has purged their local state, they cannot decrypt these messages. The forward-secrecy concern is theoretical — the departed member would need to have preserved their key material AND intercept the encrypted relay traffic.

### Pre-existing groups with non-admin members

Members who were never promoted to admin (from groups created before the admin-promotion feature) cannot commit removals. In these groups, ghost leaves persist until an original admin commits. This is acceptable given the soft-mute fallback.

### MLS ordering

Leave intents (kind 13) are application messages and follow the same ordering guarantees as chat and polls. The admin processes them in the order they arrive. The debounce timer provides a small window for batching but does not reorder.

## Stories

Story IDs are stable; `stories.json` will reference them by these IDs.

- **S1 — Leave-sync module.** Add `app/src/lib/marmot/leaveSync.ts` with `LEAVE_INTENT_KIND = 13`, the `LeaveIntentPayload` type, and serialize/parse helpers. Pattern source: `pollSync.ts`. Scope is purely module-internal: no integration into `MarmotContext` or the dispatcher yet.
- **S2 — Leave handler in unified dispatcher.** Add `app/src/lib/marmot/handlers/leaveHandler.ts` and register it for kind 13 in `buildDispatcher()` in `registerHandlers.ts`. Handler shape mirrors `pollHandler.ts`. The handler accepts an `enqueueLeave(groupId, pubkey)` callback as a dep; no MLS state access. This story does NOT add the actual queue or commit logic — only the dispatch wiring + an injected stub. The dispatch contract from `epic-feature-spec-unified-mls-application-rumor-dispatch` (AR-1, AR-3) MUST continue to hold after this story.
- **S3 — Send path: leaveGroup emits kind-13 + kind-9 announcement.** Replace the soft-mute no-op inside `leaveGroup()` in `MarmotContext` with: (a) a kind-13 `sendApplicationRumor` call carrying the `LeaveIntentPayload`, (b) a fire-and-forget kind-9 chat announcement with `{ type: "leave_intent", pubkey }`, then (c) the existing local-state purge. The send order must put (a) before the purge (otherwise the encrypted key material is gone before the message is sealed); kind-9 fire-and-forget can be best-effort. If (a) fails due to unapplied proposals from a different pending leave, fall back to `sendRumorSafe` to auto-commit first.
- **S4 — Pending-removal queue + debounce in MarmotContext.** Wire up the in-memory `Map<groupId, PendingRemoval[]>` and the per-group `Map<groupId, NodeJS.Timeout>` debounce (5s). Expose `enqueueLeave(groupId, pubkey)` as the dep injected into `leaveHandler.ts` via `registerHandlers.ts`. Clear timers on group unmount. No commit logic yet.
- **S5 — Auto-commit path.** Implement the timer-fire handler: look up leaf indexes via `getPubkeyLeafNodeIndexes(state, pubkey)` (per `cancelInvitationImpl.ts:79`), build `removeProposals` as plain objects `{ proposalType: PROPOSAL_TYPE_REMOVE, remove: { removed: leafIndex } }`, compute the `remainingAdmins` list, and issue a **single** `mlsGroup.commit({ extraProposals: [...removeProposals, Proposals.proposeUpdateMetadata({ adminPubkeys: remainingAdmins })] })` — one epoch transition, both proposals in the same call (canonical pattern: `cancelInvitationImpl.ts`). Use `clientRef.current?.groups.get(groupId)` at timer-fire time to re-fetch the live `mlsGroup` (the per-group subscription closure may have torn down). On success, clear the queue entries for the just-removed pubkeys; on failure or rollback, leave the entries in place so the next timer tick re-derives indexes from the current tree. Cover the dual-admin race and the stale-index retry from the Edge Cases table.
- **S6 — Chat announcement rendering.** Add `LeaveChatAnnouncement` component (system-style, parallel to `PollChatAnnouncement`). Detect `{ type: "leave_intent" }` in `ChatStoreContext` / `GroupChat` and route to the new component.
- **S7 — Member-list refresh on commit.** Ensure `onMembersChanged` triggers UI refresh when the auto-remove commit lands. If existing wiring already covers this end-to-end, this story is verification-only.

Verification (across all stories) is e2e: A creates group, invites B; B leaves via leave intent; verify A's client auto-removes B within ~5s; verify A can still send chat/polls during and after the removal window; verify B disappears from A's member list; verify A no longer sees B in `adminPubkeys`.

## Open Questions

- **Forced removal (kick)**: Should admins be able to remove members who haven't sent a leave intent? Separate feature, same Remove + commit mechanism. Deferred — see Non-Goals.
- **Leave reason**: Should the leave intent include an optional reason string? Rejected — see Non-Goals.
- **Notification**: Should other members see a notification badge when someone leaves? Rejected — see Non-Goals. The chat announcement is the only signal.

## Amendments

### 2026-05-18 — Spec-validation clarifications

Resolved four blocking questions surfaced by `base:spec-validator` before story planning:

1. **Dispatch site.** Kind-13 dispatch is registered through the unified dispatcher (new `leaveHandler.ts` in `app/src/lib/marmot/handlers/`, registered in `buildDispatcher()` in `registerHandlers.ts`) rather than added to `MarmotContext.applicationMessage`. This preserves AR-1 and AR-3 of the shipped `epic-feature-spec-unified-mls-application-rumor-dispatch` epic. Key Decisions §1, UI Components, and Flow 2 updated accordingly.
2. **Chat announcement origin.** The departing member sends the kind-9 `{ type: "leave_intent" }` announcement fire-and-forget alongside the kind-13 send (Flow 1 step 3). Removed the "alternatively, the admin could post the chat announcement" paragraph from Chat Message Rendering.
3. **Remove proposal API.** Adopted the plain-object `{ proposalType: PROPOSAL_TYPE_REMOVE, remove: { removed: leafIndex } }` pattern from `cancelInvitationImpl.ts`. Flow 2 step 5b updated with explicit code; the `Remove(leaf)` factory sketch was removed.
4. **`adminPubkeys` cleanup in v1.** Included. Flow 2 step 5c issues a **single** `mlsGroup.commit({ extraProposals: [...removeProposals, Proposals.proposeUpdateMetadata({ adminPubkeys: remainingAdmins })] })` — one epoch transition, both proposals in the same call. Tightened from the earlier "two separate awaits" wording after the code-explorer surfaced that the reference implementation puts both into a single `commit()` (the two-await form would create a transient epoch where admins were stripped but the ratchet leaves were still present). Open Questions updated.

Also incorporated:
- Tightened the pending-removals queue description to in-memory only (resolved internal contradiction between previous lines 84 and 124).
- Added `## Scope`, `## Non-Goals`, `## Relationship to Other Epics`, and `## Stories` sections per `base:spec-template`. Replaced "Implementation Order" with the canonical Stories block (S1..S7). Moved "No forced removal in v1" from Caveats to Non-Goals.
- Expanded the Edge Cases table with three new rows covering the dual-admin race, the local-success/publish-fail retry path, and the auto-remove-vs-chat commit race.
