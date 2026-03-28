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

## Key Decisions

### 1. Leave intent is an MLS application message (kind 13)

The leaving member sends a new application message kind (13) containing a `LeaveIntentPayload`. This is an encrypted group message like chat or polls — it does **not** create an MLS proposal and therefore does not block the group.

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
3. Client purges all local data for the group:
   - Group metadata from IndexedDB
   - Member scores, profiles, chat, polls, unread counts
4. Client navigates to `/groups/`.
5. The member is done. They do not wait for the removal commit.

### Flow 2: Admin receives a leave intent

1. MLS application message arrives. Deserialize kind 13 `LeaveIntentPayload`.
2. Persist the leave intent to a pending-removals queue (in-memory or IndexedDB), keyed by `(groupId, pubkey)`.
3. Render a chat announcement: _"{nickname} left the group"_.
4. Start a 5-second debounce timer (per group). If multiple leave intents arrive within the window, they are batched.
5. When the timer fires:
   a. For each pending pubkey, find their leaf index in the ratchet tree via `getGroupMembers()`.
   b. Build Remove proposals for each departing member.
   c. Call `group.commit({ extraProposals: [Remove(leaf1), Remove(leaf2), ...] })`.
   d. On success, clear the pending-removals queue for this group.
   e. On failure, log and retry on next timer tick or next incoming event.
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

No IndexedDB persistence needed — if the app restarts before the removal commits, the leave intent will be re-ingested from the relay during historical sync.

## UI Components

### Modified Components

| Component | Change |
|-----------|--------|
| `MarmotContext` | Handle kind 13 in `applicationMessage` handler. Add auto-remove logic with debounce timer. Remove `mlsGroup.leave()` call from `leaveGroup()` (already done in soft-mute). |
| `ChatStoreContext` / `GroupChat` | Detect `{ type: "leave_intent" }` chat announcements and render a system-style departure message. |
| `LeaveGroupButton` | No change needed — it already calls `leaveGroup()` and navigates away. |

### New Components

| Component | Purpose |
|-----------|---------|
| `LeaveChatAnnouncement` | Renders _"{member} left the group"_ system message in the chat, same style as `PollChatAnnouncement`. |

## Chat Message Rendering

### Leave Announcement (kind 9, structured)

```
 +---------------------------------------+
 |  Bob left the group                   |
 +---------------------------------------+
```

The leave intent (kind 13) is sent separately from the chat announcement. The chat announcement is a kind 9 message with structured content: `{ type: "leave_intent", pubkey: "..." }`, sent by the departing member alongside the kind 13 message.

Alternatively, the admin could post the chat announcement when it commits the removal. This avoids the edge case where the leave intent succeeds but the chat message fails.

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

## Caveats

### Ghost window

Between the leave intent and the admin's removal commit, the departed member's leaf is still in the ratchet tree. Messages sent during this window are encrypted to a key set that includes the ghost. Since the departed member has purged their local state, they cannot decrypt these messages. The forward-secrecy concern is theoretical — the departed member would need to have preserved their key material AND intercept the encrypted relay traffic.

### No forced removal in v1

This spec covers voluntary departure only. Forced removal (kicking a member) is a separate feature that requires the admin to initiate the Remove proposal directly.

### Pre-existing groups with non-admin members

Members who were never promoted to admin (from groups created before the admin-promotion feature) cannot commit removals. In these groups, ghost leaves persist until an original admin commits. This is acceptable given the soft-mute fallback.

### MLS ordering

Leave intents (kind 13) are application messages and follow the same ordering guarantees as chat and polls. The admin processes them in the order they arrive. The debounce timer provides a small window for batching but does not reorder.

## Implementation Order

1. **Leave intent sync module** -- `leaveSync.ts` with `LEAVE_INTENT_KIND = 13`, serialize/parse helpers. Follows the `pollSync.ts` pattern.
2. **MarmotContext: send leave intent** -- Replace `mlsGroup.leave()` in `leaveGroup()` with a kind 13 `sendApplicationRumor` call, followed by local state purge.
3. **MarmotContext: receive leave intent** -- Handle kind 13 in the `applicationMessage` callback. Add pending-removal queue and debounce timer. Auto-commit removal.
4. **Chat announcement** -- Add `LeaveChatAnnouncement` component. Render `{ type: "leave_intent" }` messages in `GroupChat`.
5. **Member list update** -- Ensure `onMembersChanged` callback refreshes the UI when the removal commit lands.
6. **E2E tests** -- A creates group, invites B. B leaves via leave intent. Verify A's client auto-removes B. Verify A can still send chat/polls. Verify B disappears from A's member list.

## Open Questions

- **Forced removal (kick)**: Should admins be able to remove members who haven't sent a leave intent? This is a separate feature but shares the same Remove + commit mechanism. Deferred.
- **Leave reason**: Should the leave intent include an optional reason string? Adds complexity for minimal benefit. Deferred.
- **Notification**: Should other members see a notification badge when someone leaves? Probably not — it's not actionable for non-admins.
- **Cleanup**: Should the admin's removal commit also remove the departed member from `adminPubkeys`? Yes, but it requires a second `proposeUpdateMetadata` commit. Could be batched.
