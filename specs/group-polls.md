# Feature Spec: Group Polls

## Goal

Let any group member create polls that other members can vote on. Polls live in a dedicated side panel next to the chat — not inline — and only produce two chat messages: an announcement when the poll opens and a results summary when the creator closes it.

## Background

Group learning benefits from quick consensus checks ("Which topic next?", "When should we meet?", "Was this exercise helpful?"). Today the only way to gauge group opinion is to ask in chat and manually count replies. A structured poll eliminates ambiguity and keeps the chat focused.

**NIP-88** (merged January 2025) defines kind:1068 for poll creation and kind:1018 for poll responses on the public Nostr network. Since group chats in this app use MLS encryption via marmot-ts (all messages are wrapped in kind:445 Nostr events), we cannot use NIP-88 kinds directly on the wire. Instead, polls and votes are transmitted as new **MLS application message kinds** — the same mechanism used for chat (kind 9), profile sync (kind 0), and score sync (kind 1). The payload structure inside these application messages is modeled after NIP-88 for familiarity and potential future interoperability.

## Key Decisions

### 1. Any member creates; only creator closes

There is no admin-only restriction on poll creation. Any group member can start a poll. Only the poll's creator can close it. This keeps the feature lightweight and avoids admin bottlenecks.

### 2. Multiple concurrent polls allowed

Several polls can be open at the same time. The side panel lists all active polls, ordered by creation time (newest first). This avoids blocking: one long-running poll does not prevent others from being created.

### 3. Vote counts hidden until poll is closed

While a poll is open, voters see the total participant count (how many people have voted) but **not** per-option tallies. This prevents bandwagon effects and encourages independent decisions. Full results are revealed only when the creator closes the poll.

### 4. Single-choice and multiple-choice, creator chooses

When creating a poll the creator picks "single choice" (one option per voter) or "multiple choice" (voter selects one or more options). This follows NIP-88's `polltype` tag (`singlechoice` / `multiplechoice`).

### 5. Re-voting allowed

A voter can change their vote at any time before the poll closes. The latest vote from a given pubkey replaces all previous votes (same semantics as NIP-88).

### 6. Three new MLS application message kinds

| App-message kind | Purpose | Analogous NIP-88 kind |
|------------------|---------|-----------------------|
| **10** | Poll open (creation) | kind:1068 |
| **11** | Poll vote (response) | kind:1018 |
| **12** | Poll close (results) | — (no NIP-88 equivalent) |

These are discriminators inside the MLS application message payload (same layer as kind 9 for chat). They travel encrypted inside kind:445 Nostr events.

### 7. Two chat-visible messages per poll lifecycle

- **Opening**: When a poll is created, a system-style message appears in the chat: _"{Creator} started a poll: {title}"_. This is a regular chat message (kind 9) with a structured payload so the UI can render it distinctly.
- **Closing**: When the creator closes the poll, a results summary is posted to the chat (kind 9) showing the final tallies. This is the permanent record of the poll outcome.

Poll votes (kind 11) do **not** appear in the chat.

## MLS Application Message Payloads

### Kind 10 — Poll Open

```typescript
interface PollOpenPayload {
  /** Unique poll identifier (UUID v4) */
  id: string;
  /** Poll question / title */
  title: string;
  /** Optional longer description */
  description?: string;
  /** Answer options */
  options: PollOptionDef[];
  /** "singlechoice" | "multiplechoice" */
  pollType: 'singlechoice' | 'multiplechoice';
  /** Creator's pubkey (hex) — redundant with MLS sender, included for convenience */
  creatorPubkey: string;
}

interface PollOptionDef {
  /** Short alphanumeric identifier (e.g. "A", "B", "C") */
  id: string;
  /** Human-readable label */
  label: string;
}
```

Serialized as JSON in the application message content field. The MLS sender identity authenticates the creator.

### Kind 11 — Poll Vote

```typescript
interface PollVotePayload {
  /** References the poll ID from kind 10 */
  pollId: string;
  /** Selected option ID(s) — single element for singlechoice, one or more for multiplechoice */
  responses: string[];
}
```

If a voter sends multiple kind 11 messages for the same `pollId`, the one with the latest MLS epoch/timestamp wins.

### Kind 12 — Poll Close

```typescript
interface PollClosePayload {
  /** References the poll ID from kind 10 */
  pollId: string;
  /** Final tally — included so late-joining members see results without replaying votes */
  results: PollResult[];
  /** Total number of unique voters */
  totalVoters: number;
}

interface PollResult {
  /** Option ID */
  optionId: string;
  /** Option label (echoed for display) */
  label: string;
  /** Number of votes for this option */
  count: number;
}
```

Only the poll creator can send this. Other members' close attempts are ignored.

## Data Model

### Poll (IndexedDB)

```typescript
interface Poll {
  /** UUID — primary key */
  id: string;
  /** Group this poll belongs to */
  groupId: string;
  /** Poll question / title */
  title: string;
  /** Optional description */
  description?: string;
  /** Answer options */
  options: PollOptionDef[];
  /** "singlechoice" | "multiplechoice" */
  pollType: 'singlechoice' | 'multiplechoice';
  /** Creator's pubkey (hex) */
  creatorPubkey: string;
  /** When the poll was created (Unix ms) */
  createdAt: number;
  /** Whether the poll has been closed */
  closed: boolean;
  /** Final results (populated on close) */
  results?: PollResult[];
  /** Total voters (populated on close) */
  totalVoters?: number;
}
```

### PollVote (IndexedDB)

```typescript
interface PollVote {
  /** Compound key: `${pollId}:${voterPubkey}` */
  id: string;
  pollId: string;
  voterPubkey: string;
  /** Selected option ID(s) */
  responses: string[];
  /** When this vote was cast (Unix ms) — latest wins */
  votedAt: number;
}
```

### Storage

| IDB store | Key | Value | Purpose |
|-----------|-----|-------|---------|
| `quizzl-polls` | `id` (string) | `Poll` | All polls for all groups |
| `quizzl-poll-votes` | `id` (string) | `PollVote` | All votes, keyed by `{pollId}:{voterPubkey}` |

Polls are scoped to a group via `groupId` field. Queries filter by `groupId` to show only the current group's polls.

## Flows

### Flow 1: Create a poll

1. Member opens the group detail view.
2. In the chat section, clicks the **"Poll"** button (next to the message input, or in a toolbar above the chat).
3. `CreatePollModal` opens:
   a. **Title** — text input (required, max 200 chars).
   b. **Description** — textarea (optional, max 500 chars).
   c. **Options** — minimum 2, maximum 10 option inputs. Each has a text field. An "Add option" button appends a new row; a remove icon deletes a row.
   d. **Poll type** — toggle or radio: "Single choice" (default) / "Multiple choice".
   e. **Create** button — disabled until title and ≥2 non-empty options exist.
4. On create:
   a. Generate a UUID v4 for the poll ID.
   b. Assign sequential option IDs ("A", "B", "C", ...).
   c. Build the `PollOpenPayload` (kind 10) and send via `group.sendApplicationMessage(10, payload)`.
   d. Build a chat announcement (kind 9) with structured content: `{ type: "poll_open", pollId, title, creatorPubkey }`.
   e. Send the chat announcement via `group.sendChatMessage(...)` (or a similar method that produces a kind 9 app message).
   f. Persist the `Poll` record to IndexedDB with `closed: false`.
   g. Close the modal.
5. The poll appears in the side panel. The chat shows the announcement message.

### Flow 2: Cast or recast a vote

1. Member sees the poll in the side panel (`PollCard` component).
2. The card shows: title, description (if any), options as selectable items (radio buttons for singlechoice, checkboxes for multiplechoice).
3. Member selects option(s) and clicks **"Vote"**.
   a. Build the `PollVotePayload` (kind 11) and send via `group.sendApplicationMessage(11, payload)`.
   b. Persist or replace the `PollVote` record in IndexedDB (keyed by `{pollId}:{ownPubkey}`).
   c. Update the local participant count display.
4. **Re-voting**: If the member has already voted, the UI pre-selects their previous choice(s). They can change and click "Update Vote". This sends a new kind 11 message; the latest timestamp wins.
5. The side panel updates to show a check mark and the current total participant count (but not per-option tallies).

### Flow 3: Close a poll

1. The poll creator sees a **"Close Poll"** button on their poll in the side panel.
2. On click, a confirmation dialog appears: "Close this poll? Results will be shared in the chat."
3. On confirm:
   a. Tally all votes from IndexedDB for this poll (latest vote per pubkey).
   b. Build the `PollClosePayload` (kind 12) with results and `totalVoters`.
   c. Send via `group.sendApplicationMessage(12, payload)`.
   d. Build a chat results message (kind 9) with structured content: `{ type: "poll_close", pollId, title, results, totalVoters }`.
   e. Send the chat results message.
   f. Update the `Poll` record: `closed = true`, populate `results` and `totalVoters`.
4. The side panel moves this poll to a "Closed" state — results are now visible.
5. The chat shows a formatted results message.

### Flow 4: Receive poll events (other members)

1. MLS application message arrives (kind:445 Nostr event decrypted by marmot-ts).
2. Deserialize the application message. Check the kind discriminator:

   **Kind 10 (Poll Open):**
   a. Parse `PollOpenPayload`.
   b. Store as `Poll` record in IndexedDB with `closed: false`.
   c. The side panel reactively shows the new poll.
   d. (The chat announcement arrives separately as a kind 9 message.)

   **Kind 11 (Poll Vote):**
   a. Parse `PollVotePayload`.
   b. Store or replace `PollVote` in IndexedDB (key: `{pollId}:{senderPubkey}`).
   c. Update participant count in the side panel for the referenced poll.
   d. No chat message is produced.

   **Kind 12 (Poll Close):**
   a. Parse `PollClosePayload`.
   b. Verify the sender is the poll's `creatorPubkey`. If not, ignore.
   c. Update the `Poll` record: `closed = true`, set `results` and `totalVoters`.
   d. Side panel transitions poll to closed state with visible results.
   e. (The chat results message arrives separately as a kind 9 message.)

## UI Components

### New Components

| Component | Purpose |
|-----------|---------|
| `CreatePollModal` | Modal with title, description, options, poll type inputs |
| `PollPanel` | Side panel (right of chat) listing active and closed polls for the current group |
| `PollCard` | Single poll in the panel — shows title, options, vote controls, participant count |
| `PollResultsCard` | Closed poll variant — shows title, option bars with counts/percentages |
| `PollChatAnnouncement` | Renders the "poll opened" system message in the chat |
| `PollChatResults` | Renders the "poll closed" results summary in the chat |

### Modified Components

| Component | Change |
|-----------|--------|
| `pages/groups.tsx` (`GroupDetailView`) | Add `HStack` layout to place `PollPanel` right of `GroupChat`. Add "Poll" button to chat toolbar. |
| `GroupChat` | Detect structured chat messages (`type: "poll_open"`, `type: "poll_close"`) and render `PollChatAnnouncement` / `PollChatResults` instead of plain text |
| `MarmotContext` | Handle app-message kinds 10, 11, 12 in the `applicationMessage` handler. Expose `pollVersion` counter (same pattern as `chatVersion`). |
| `ChatStoreContext` | Optionally: extend to co-manage poll state, or create a dedicated `PollStoreContext` |

## Chat Message Rendering

### Poll Opened (kind 9, structured)

```
 ┌─────────────────────────────────────────┐
 │  📊  Alice started a poll               │
 │  "Which topic should we review next?"   │
 │                                         │
 │  → See poll in the side panel           │
 └─────────────────────────────────────────┘
```

The chat message content is JSON: `{ type: "poll_open", pollId: "...", title: "...", creatorPubkey: "..." }`. The `GroupChat` component detects this structure and renders `PollChatAnnouncement` instead of a plain text bubble.

### Poll Closed (kind 9, structured)

```
 ┌─────────────────────────────────────────┐
 │  📊  Alice closed the poll              │
 │  "Which topic should we review next?"   │
 │                                         │
 │  ████████████████░░░░  Functions  62%   │
 │  ██████░░░░░░░░░░░░░░  Arrays     25%  │
 │  ███░░░░░░░░░░░░░░░░░  Loops      13%  │
 │                                         │
 │  8 votes                                │
 └─────────────────────────────────────────┘
```

The chat message content is JSON: `{ type: "poll_close", pollId: "...", title: "...", results: [...], totalVoters: 8 }`. Rendered by `PollChatResults` with horizontal bar charts and percentages.

## Side Panel Layout

The chat section in `GroupDetailView` changes from a single `GroupChat` to a horizontal split:

```
 ┌──────────────────────────────────────────────────────┐
 │  Chat                              │  Polls (2)      │
 │ ┌────────────────────────────────┐ │ ┌─────────────┐ │
 │ │                                │ │ │ Poll Card 1 │ │
 │ │  message list                  │ │ │  (active)   │ │
 │ │                                │ │ ├─────────────┤ │
 │ │                                │ │ │ Poll Card 2 │ │
 │ │                                │ │ │  (closed)   │ │
 │ ├────────────────────────────────┤ │ │             │ │
 │ │ [message input]  [📊 Poll]    │ │ │             │ │
 │ └────────────────────────────────┘ │ └─────────────┘ │
 └──────────────────────────────────────────────────────┘
```

- The poll panel is collapsible. A toggle button (or the "Poll" button) shows/hides it.
- On narrow screens (mobile), the panel could overlay or be accessed via a tab toggle above the chat.
- Active polls appear first, closed polls below in a collapsed/accordion section.
- The panel header shows the count of active polls: "Polls (2)".

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Poll creator leaves the group | The poll remains open but can no longer be closed. Consider: auto-close orphaned polls after a configurable period, or allow any member to close them. For v1: poll stays open indefinitely. |
| Vote arrives after poll is closed | Ignore — kind 11 messages for a closed poll are silently dropped. |
| Vote references unknown poll ID | Queue the vote and apply it when the poll-open message arrives (out-of-order MLS delivery). |
| Member joins after poll was created | They receive the poll-open event during MLS history sync. Votes they missed are also replayed, so participant counts are accurate. |
| Member votes, then poll-open replays during sync | Deduplicate: if the poll already exists in IDB, skip. Votes are keyed by `{pollId}:{pubkey}`, so duplicates overwrite harmlessly. |
| Close message arrives before all votes are synced | The close payload contains final `results` and `totalVoters`, so local tallies are replaced by the authoritative results from the creator. |
| Creator tries to close with 0 votes | Allowed — results show all options at 0. The chat message shows "0 votes". |
| Option text is very long | Truncate at 100 chars in the poll card; full text on hover/expand. |
| 10 options | Maximum enforced in `CreatePollModal`. UI scrolls if needed. |
| MLS epoch boundary during voting | Votes are application messages; they survive epoch changes. No special handling needed. |

## Caveats

### No NIP-88 interoperability in v1

Polls exist only inside the MLS-encrypted group. They are not visible on the public Nostr network and cannot be voted on by non-members. This is by design (group privacy), but means no cross-client poll compatibility.

### Vote privacy within the group

All group members can decrypt all MLS application messages, including kind 11 votes. A technically capable member could inspect raw messages to see who voted for what before the poll closes. The "hidden until closed" guarantee is a **UI-level** privacy measure, not a cryptographic one. True vote privacy would require additional protocol work (e.g., blind signatures or homomorphic tallying) which is out of scope.

### MLS message ordering

MLS does not guarantee strict global ordering. Votes and close messages may arrive in different orders on different clients. The design handles this:
- Votes are idempotent (latest per pubkey wins).
- The close payload includes authoritative results, so local tally discrepancies are resolved.
- Out-of-order poll-open messages are handled by queueing early votes.

### Orphaned polls

If the creator goes offline permanently, the poll stays open forever. A future enhancement could add a timeout or allow any admin to force-close an orphaned poll.

### No edit after creation

Polls cannot be edited after creation (no changing title, options, or poll type). The creator must close and recreate if they made a mistake. This keeps the protocol simple — no "poll update" message kind needed.

## Implementation Order

1. **Data layer** — IndexedDB stores for polls and votes (`quizzl-polls`, `quizzl-poll-votes`). CRUD helpers mirroring `chatPersistence.ts`.
2. **Poll sync module** — `pollSync.ts` mirroring `profileSync.ts` / `scoreSync.ts`. Serialize/deserialize kinds 10, 11, 12 payloads.
3. **MarmotContext integration** — Handle kinds 10, 11, 12 in the `applicationMessage` handler. Add `pollVersion` counter.
4. **PollStoreContext** — React context providing polls, votes, and actions (`createPoll`, `castVote`, `closePoll`) for the current group. Follows the `ChatStoreContext` pattern.
5. **CreatePollModal** — Form UI for title, description, options, poll type.
6. **PollCard / PollResultsCard** — Side panel cards for active and closed polls.
7. **PollPanel** — Container listing polls, with active/closed sections and collapse toggle.
8. **Layout change** — Modify `GroupDetailView` to place `PollPanel` beside `GroupChat` in an `HStack`.
9. **Chat rendering** — Extend `GroupChat` to detect structured poll messages and render `PollChatAnnouncement` / `PollChatResults`.
10. **E2E tests** — Create poll as User A, vote as User B, close as User A, verify results in chat.

## Open Questions

- **Poll expiry**: Should polls support an optional auto-close time (like NIP-88's `endsAt` tag)? Deferred to v2.
- **Orphan handling**: What happens to polls whose creator left? Auto-close after N days, or allow admin override? Deferred to v2.
- **Notification**: Should new polls trigger a notification badge (similar to unread chat messages)? Possibly — but it adds complexity to the unread store.
- **Backup**: Should polls be included in the relay backup (kind 30078)? Votes are ephemeral but poll definitions may be worth preserving. Deferred pending backup strategy review.
- **Mobile layout**: On small screens, should the poll panel be a bottom sheet, a tab, or accessible via a button that replaces the chat view? Needs UX exploration.
