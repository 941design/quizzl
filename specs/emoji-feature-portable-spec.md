# Emoji Feature — Portable Specification

A generic specification of the emoji feature set for an end-to-end-encrypted
Nostr chat application (DMs and/or Marmot/MLS groups). This document is
written so it can be lifted directly into another project that is *missing*
emoji support. It deliberately avoids product-specific naming and file paths.

The feature set covers two related but **independent** capabilities:

1. **Compose-area emoji picker** — insert an emoji into the message being
   typed, at the cursor position.
2. **Message reactions** — attach an emoji to an *existing* message as a
   social acknowledgement (👍, ❤️, 🎉, …), without sending a full reply.

Both features can be shipped independently; reactions are the more
expensive of the two because they require new event types, persistence,
and bidirectional sync with the conversation partner.

---

## 1. Generic Feature Set

### 1.1 Compose-area emoji picker

**Trigger.** A button in the message-input toolbar (conventionally a 😊
icon, bottom-right of the textarea, alongside the attachment / voice /
send buttons).

**Picker UI.**
- A dropdown/popover anchored to the trigger button.
- A grid of emoji glyphs. A small curated set (20–30 emojis) is the minimal
  viable picker; production-grade pickers expose the full Unicode emoji
  catalog with category tabs and search (see §1.4 for library options).
- Each glyph is a clickable / focusable cell with an `aria-label`
  describing the emoji.
- Closes on selection, on outside click, and on `Escape`.

**Insertion behavior.**
- The selected emoji is inserted at the textarea's *current cursor
  position* — not appended to the end. This is the single most common
  bug in naive implementations.
- After insertion, the textarea regains focus and the caret advances to
  immediately *after* the inserted glyph.
- Content before and after the cursor is preserved byte-exact. (Emoji are
  multi-byte; use `String.prototype.slice` on the UTF-16 string and let
  the browser handle grapheme clusters in the rendered output.)
- If no caret exists (textarea unfocused), append to end.

**Curated default set (24–26 glyphs).** For projects that do not want to
ship a full picker on day one, a useful default split is:

| Category  | Examples                                  |
|-----------|-------------------------------------------|
| Faces     | 😀 😂 😊 😢 😍 🥰 😎 🤔                    |
| Gestures  | 👍 👋 🙏 ✌️ 👏 💪                          |
| Symbols   | ❤️ ✨ 🔥 💯 ✅ ❌                           |
| Objects   | 🎉 💡 📌 🔔 📝 ✉️                          |

Display in a 4-column grid (≈6 rows). This subset is intentionally small
enough to render without virtualization.

### 1.2 Message reactions

**Trigger.** Hovering a message bubble reveals a reaction handle — either
a small `+` button or an inline 😊 icon. Touch devices use a long-press
gesture instead.

**Reaction picker.** A *separate*, more compact picker than the compose-area
picker. It is rendered as a floating popover above (or below) the
hovered bubble. Six columns × 4 rows is a typical layout. The reaction
picker shares the curated emoji set with the compose picker, but it is
**not** the same component — they have different anchoring, lifecycle,
and styling concerns.

**Quick reactions (optional).** A row of 5–7 most-used emoji shown
directly inline (without opening the picker), plus a "more" affordance.
Slack and iMessage use this pattern.

**Display below the bubble.** Reactions render as compact "pills" or
"badges" stacked horizontally below the message:

- One badge per *unique* emoji, with a count if `count > 1`.
- The user's own reactions are visually highlighted (border accent,
  background fill, or both).
- Clicking an existing badge toggles the user's own reaction with that
  emoji on/off.
- Tapping/clicking on a badge in a 1:1 chat with a single reactor may omit
  the count.
- Tooltip on hover lists the reactors (npubs / display names).

**Toggle / replace semantics.** This is a UX policy decision and the two
sensible options are:

| Policy        | Behavior                                                                 |
|---------------|--------------------------------------------------------------------------|
| Single-emoji  | A user can have **at most one** reaction per message. Selecting a       |
|               | different emoji *replaces* the previous one. Click own badge to remove. |
| Multi-emoji   | A user can have multiple distinct reactions per message. Selecting an  |
|               | emoji they already used removes it; otherwise adds.                     |

Pick one and document it. Slack, Discord, and Element use multi-emoji.
iMessage uses single-emoji ("tapback"). Single-emoji is simpler; multi-emoji
is more expressive.

**Default reaction (optional).** Double-clicking or double-tapping a
message bubble adds a configurable default reaction (commonly 👍). This is
a power-user shortcut and is purely additive.

### 1.3 Persistence

Reactions are *not* derivable from the message stream alone — they arrive
as their own events and must be stored independently of the messages they
attach to. A minimal table:

```
reactions
─────────────────────────────────────────────────────────
id              TEXT PRIMARY KEY      -- local UUID
message_id      TEXT NOT NULL         -- FK to messages.id
reactor_pubkey  TEXT NOT NULL         -- hex or npub of reactor
emoji           TEXT NOT NULL         -- emoji glyph (or "-" for tombstone)
event_id        TEXT                  -- Nostr event id, for dedup
created_at      TEXT NOT NULL         -- ISO timestamp
identity_id     TEXT NOT NULL         -- which local identity owns this row

INDEX  (message_id)                    -- fast per-message lookup
UNIQUE (identity_id, message_id, reactor_pubkey)
                                       -- enforces single-emoji policy at DB level
```

If implementing the multi-emoji policy, replace the unique index with
`UNIQUE (identity_id, message_id, reactor_pubkey, emoji)`.

**Loading.** Load reactions in batch alongside the message page (single
SQL query keyed by the visible message-id set), not lazily per-message —
N+1 queries will visibly stall the message list.

### 1.4 Picker libraries (optional)

For a production-grade picker, these libraries are commonly used:

- **`emoji-mart`** (React) — categorized full Unicode catalog, search,
  skin tone selection, frequently-used tracking. Most popular.
- **`emoji-picker-react`** — lighter alternative with similar feature set.
- **`@emoji-mart/data`** — separate data package; pair with custom UI.
- For a curated 24-emoji picker, no library is needed; hand-rolling is
  ~80 lines of code.

If shipping NIP-30 custom emoji (§2.3), choose a picker that supports
custom image URLs as glyph sources.

### 1.5 Accessibility

- Emoji buttons must have descriptive `aria-label`s ("Insert emoji 👍",
  "React with ❤️").
- Picker grid uses `role="grid"` with arrow-key navigation between
  cells, `Enter` / `Space` to select.
- Reaction badge must announce the emoji and count to screen readers.
- All interactive elements reachable by keyboard; focus ring visible.
- Target WCAG Level AA compliance.

### 1.6 Keyboard shortcuts

| Shortcut             | Action                          |
|----------------------|---------------------------------|
| `Cmd/Ctrl+Shift+E`   | Toggle compose-area emoji picker |
| `Escape`             | Close any open picker           |
| Arrow keys           | Navigate within picker grid     |
| `Enter` / `Space`    | Select focused glyph            |
| Double-click message | Add default reaction (optional) |

---

## 2. Nostr-specific Concerns

### 2.1 Reactions over the wire — NIP-25

Reactions are specified by **NIP-25 ("Reactions")**:
<https://github.com/nostr-protocol/nips/blob/master/25.md>

- **Event kind:** `7`
- **`content`:** the emoji glyph (e.g. `"👍"`).
  - The string `"+"` means "like" (default positive reaction).
  - The string `"-"` means "dislike" **or** "removal of a previous
    reaction" — treat per app policy.
  - Empty content is interpreted as `"+"` by historical clients.
- **Required tags:**
  - `["e", "<target-event-id-hex>"]` — the message being reacted to.
  - `["p", "<target-event-author-pubkey-hex>"]` — the message author,
    so they can subscribe to reactions addressed to them.
- **Optional tags:**
  - `["k", "<kind-of-target-event>"]` — the kind of the target event
    (useful when reacting to events that are themselves reactions, posts,
    media, etc.).
  - `["a", "<addressable-event-coords>"]` — when reacting to a
    parameterized replaceable event.
  - `["emoji", "<shortcode>", "<image-url>"]` — see NIP-30 below.

### 2.2 Privacy: wrap reactions in NIP-17 / NIP-59

A bare kind-7 event is **public**: any relay sees who reacted to which
message with which emoji. For a chat app that already encrypts DMs via
NIP-17 / NIP-59 gift-wrap, **reactions must be wrapped the same way** —
otherwise the reaction layer leaks the conversation graph.

Pattern:

1. Construct the unsigned kind-7 reaction *rumor* (no `id`, no `sig`).
2. Gift-wrap it (NIP-59) addressed to the conversation partner.
3. The on-the-wire event is a kind `1059` gift wrap; the relay sees only
   sender pubkey ↔ recipient pubkey, not the reaction or its target.
4. Receiver unwraps, validates the inner kind, and ingests.

For group DMs (NIP-17 sealed direct messages with multiple recipients),
publish one gift wrap per recipient.

**Removal.** To remove a reaction, send a *new* kind-7 with `content: "-"`
and the same `e` / `p` tags, gift-wrapped to the same recipient. The
receiver deletes the prior reaction from this `reactor_pubkey` on the
target message. Do **not** rely on NIP-09 deletion events — they are
unreliable and don't compose with gift wrap.

### 2.3 Custom emoji — NIP-30

**NIP-30 ("Custom Emoji")**:
<https://github.com/nostr-protocol/nips/blob/master/30.md>

Lets users render `:shortcode:` placeholders in event content as inline
images sourced from URLs:

- In the event's `content`, write `:partyparrot:`.
- Add a tag `["emoji", "partyparrot", "https://host/partyparrot.gif"]`.
- Renderers replace each `:shortcode:` in the text with an `<img>` whose
  `src` is the URL from the matching `emoji` tag.

**For chat reactions:** the `content` of the kind-7 event may itself be a
`:shortcode:` rather than a Unicode glyph, with the corresponding `emoji`
tag attached to the kind-7 event. The receiver's UI renders the badge as
the image instead of a glyph. NIP-30 is independent of NIP-25; not all
clients support it. Nostling does **not** currently implement NIP-30.

**Emoji packs — NIP-51.** A user's preferred custom emoji set is
discoverable via NIP-51 categorized lists (kind `30030`, "emoji sets").
Subscribe to your own and your contacts' emoji-set events to build the
shortcode → URL lookup for the picker.

**Security.** `emoji` tag URLs are user-supplied. Sanitize before
rendering: enforce HTTPS, content-type sniffing, size limits, and route
through your existing image cache / proxy to avoid IP leakage.

### 2.4 Inbound reaction handling

For each incoming gift wrap whose unwrapped rumor is kind 7:

1. Read the `e` tag → look up a *local* message with that `event_id`.
2. If the local message is missing: **silently discard**. Do not fetch
   from the relay — this avoids leaking interest in events the user
   never received.
3. If `content == "-"`: delete any reaction row for
   `(message_id, reactor_pubkey)`.
4. Otherwise upsert the reaction row, deduplicating on the inbound
   `event_id` (ignore if already stored — relays re-broadcast).
5. Push an IPC / event-bus notification to the renderer so the
   conversation view refreshes the affected message's badges without a
   full reload.

### 2.5 Optimistic UI

Adding a reaction must feel instant:

1. Write the reaction row to local DB immediately, render the badge.
2. Asynchronously gift-wrap and publish to relays.
3. On publish success, update the row's `event_id` for later dedup.
4. On publish failure, log and either retry or roll back the local row
   (project policy). If at least one relay accepted the publish, treat
   as success — partial relay success is normal.

---

## 3. Marmot / MLS-on-Nostr Specifics

If the chat app is built on **Marmot** (MLS-on-Nostr / WhiteNoise), group
reactions follow a different transport but the same on-the-rumor shape.

### 3.1 No dedicated MIP for reactions

There is **no** Marmot Improvement Proposal specifically for reactions.
The relevant spec is **MIP-03 ("Group Messages")**, which names kind `7`
as the reaction event kind alongside kind `9` (chat). MIP-03 makes no
normative reference to NIP-25 or NIP-30.

### 3.2 Reactions are MLS application messages

A reaction in a Marmot group is **not** a separate NIP-25 event sent
outside the MLS envelope. It is an **MLS application message**:

1. Construct an unsigned kind-7 *rumor* (see shape below). The rumor has
   `pubkey`, `kind`, `content`, `tags`, `created_at`, `id` — but **no
   `sig`** (MIP-03 forbids signed rumors inside MLS to prevent public
   relay replay).
2. Pass it to the MLS group:
   - **MDK (Rust):** `mdk.create_message(group_id, rumor)`
   - **marmot-ts:** `group.sendApplicationRumor(rumor)`
3. The library encrypts the rumor with the current MLS epoch key and
   emits a **kind `445`** event on the wire (the MLS application-message
   kind).
4. Only members holding the current epoch key can decrypt and observe
   the reaction. Relays cannot.

### 3.3 Inner rumor shape

```json
{
  "kind": 7,
  "content": "👍",
  "tags": [["e", "<target-message-event-id-hex>"]],
  "pubkey": "<sender-pubkey-hex>",
  "created_at": 1730000000,
  "id": "<event-hash>"
}
```

The `["p", ...]` tag is conventionally omitted in groups (every group
member is implicitly addressed via the MLS envelope) — but adding it
hurts nothing and keeps the rumor shape NIP-25-compliant for non-MLS
clients that might re-export the rumor.

### 3.4 No library helpers, no NIP-30 support

- Neither MDK nor marmot-ts ships a dedicated `sendReaction()` helper.
  Callers construct the kind-7 rumor and call the generic
  `create_message()` / `sendApplicationRumor()`.
- Neither MIP-03 nor any other MIP references **NIP-30**. The Marmot
  libraries provide no custom-emoji rendering. A client may include the
  `emoji` tag in the inner rumor — it will be carried opaquely through
  MLS — but no existing Marmot client renders it.
- WhiteNoise validates the emoji content (rejects empty / oversized);
  marmot-ts performs no reaction-specific validation.

### 3.5 Persistence in groups

The reactions table from §1.3 still applies. Two notes:

- **`reactor_pubkey`** is the inner rumor's `pubkey` (the group member),
  not the kind-445 outer event's pubkey (which may be an ephemeral key).
- **`message_id`** references the local id of the *target* group message,
  whose `event_id` is itself the rumor id of an earlier kind-9 chat
  message inside the same group. The `e` tag in the reaction rumor
  points to that rumor id, not to any outer kind-445 event id.

### 3.6 Forward-secrecy considerations

Because reactions are MLS application messages, they are protected by
the group's *current* epoch key. A member who is later removed from the
group cannot decrypt new reactions — but reactions they sent before
removal remain in their own local store and in the local stores of
members who received them. This matches the standard MLS messaging
guarantees and requires no special UX treatment.

---

## 4. Acceptance Criteria

A correct implementation must satisfy all of:

**Compose picker.**
- [ ] Trigger button visible in the message-input toolbar.
- [ ] Clicking opens a picker; outside click and `Escape` close it.
- [ ] Selecting an emoji inserts it at the *current cursor position*.
- [ ] Caret moves to immediately after the inserted glyph; textarea
      regains focus.
- [ ] Picker keyboard-navigable; WCAG AA compliant.

**Reactions — local.**
- [ ] Hover/long-press on a message reveals a reaction trigger.
- [ ] Reaction picker offers the curated emoji set.
- [ ] Selecting an emoji renders a badge below the bubble immediately.
- [ ] Per-user reaction policy (single or multi) enforced consistently
      in UI and DB.
- [ ] Clicking own badge removes the reaction; UI updates instantly.
- [ ] Reactions survive an app restart (loaded from DB on conversation
      open).

**Reactions — sync.**
- [ ] Outgoing reactions are gift-wrapped (NIP-17 / NIP-59 for DMs;
      kind-445 MLS application message for Marmot groups). The relay
      sees no plaintext reaction or target.
- [ ] Conversation partner / group members observe the reaction without
      a manual refresh.
- [ ] Reaction removal (`content: "-"`) propagates to and applies on the
      receiver.
- [ ] Inbound reactions referencing unknown messages are silently
      discarded (no fetch, no log spam).
- [ ] Inbound reaction events deduplicate on `event_id`.

**Robustness.**
- [ ] Adding/removing reactions never blocks the message list scroll.
- [ ] Loading a long conversation makes O(1) DB queries for reactions,
      not O(n) per message.
- [ ] Optimistic UI rolls back gracefully if all relays reject a
      reaction publish (project policy decides whether to retry).

---

## 5. Suggested Implementation Order

1. Compose-area picker (curated 24-emoji subset, no library, ~150 LOC).
2. Reactions — DB migration and shared types.
3. Reactions — outbound: build/sign/gift-wrap kind-7, publish.
4. Reactions — inbound: ingest gift-wrapped kind-7, dedup, store, push
   to renderer.
5. Reactions — UI: badges below bubble + reaction picker.
6. Reactions — toggle/replace semantics + own-reaction highlight.
7. Optional: NIP-30 custom emoji (picker + tag emission + safe rendering).
8. Optional: full-catalog picker via `emoji-mart`.
9. Optional: NIP-51 emoji-set sync for cross-device custom-emoji
   discovery.

Steps 1 and 2–6 are independent and can be parallelized across two
contributors.

---

## 6. References

- NIP-17 (Sealed Direct Messages): <https://github.com/nostr-protocol/nips/blob/master/17.md>
- NIP-25 (Reactions): <https://github.com/nostr-protocol/nips/blob/master/25.md>
- NIP-30 (Custom Emoji): <https://github.com/nostr-protocol/nips/blob/master/30.md>
- NIP-51 (Lists, incl. emoji sets): <https://github.com/nostr-protocol/nips/blob/master/51.md>
- NIP-59 (Gift Wrap): <https://github.com/nostr-protocol/nips/blob/master/59.md>
- Marmot MIP-03 (Group Messages): see the Marmot MIPs repository
- MLS RFC 9420: <https://www.rfc-editor.org/rfc/rfc9420>
