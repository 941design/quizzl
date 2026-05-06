# Acceptance Criteria — Emoji Feature Epic

Each AC uses the form: **[Component/Function] [verb] [resulting state]** — specific, testable, no intent language.

Decisions D1–D11 in `decisions.md` are binding and override the spec. ACs derived
from decisions are marked (D-derived) in parentheses where useful.

---

## Types, Constants & i18n (Story 01)

**AC-01** `app/src/lib/reactions/types.ts` exports a `ReactionThreadKey` discriminated union type with variant `{ kind: "group"; groupId: string }` and variant `{ kind: "dm"; peerPubkeyHex: string }`.

**AC-02** `app/src/lib/reactions/types.ts` exports a `Reaction` interface with fields `id: string`, `messageId: string`, `reactorPubkey: string`, `emoji: string`, `eventId: string`, `createdAt: number`, and `removed: boolean`. The `identity_id` field from the spec §1.3 is absent (D11).

**AC-03** `app/src/lib/reactions/types.ts` exports a `CURATED_EMOJI` constant whose value is a `readonly string[]` of exactly 24 Unicode glyph strings, covering the Faces, Gestures, Symbols, and Objects categories from spec §1.1.

**AC-04** The `Copy` type in `app/src/lib/i18n.ts` is extended with keys `emoji.openPicker`, `emoji.closePicker`, `emoji.reactWith`, `emoji.insertEmoji`, `emoji.removeReaction`, `emoji.couldntReact`, `emoji.reactors`, and `emoji.reactionCount`.

**AC-05** Both the `en` and `de` objects in `app/src/lib/i18n.ts` contain non-empty string values for all eight keys listed in AC-04; no key is undefined or an empty string.

**AC-06** `app/tests/unit/reactions/reactions.i18n.test.ts` calls `getCopy('en')` and `getCopy('de')` and asserts the exact string values for all eight emoji keys, covering both locales.

---

## Reactions Persistence & Read API (Story 02)

**AC-07** `app/src/lib/reactions/api.ts` exports `loadReactions(thread: ReactionThreadKey): Promise<Reaction[]>` that reads from the idb-keyval namespace `quizzl:reactions:group:{groupId}` when `thread.kind === "group"` and from `quizzl:reactions:dm:{peerPubkeyHex}` when `thread.kind === "dm"`.

**AC-08** `aggregateForMessage(rows, messageId, selfPubkey)` returns a `ReactionAggregate[]` where each element has a unique `emoji`, a `count` equal to the number of non-removed rows for that emoji and messageId, a `reactors` array of hex pubkeys in oldest-first order, and `selfReacted: true` iff `selfPubkey` appears in `reactors`. Removed rows are excluded from count and reactors.

**AC-09** `applyInboundRumor(thread, rumor)` with `rumor.content !== "-"` upserts a `Reaction` row keyed on `(messageId, reactorPubkey, emoji)` and returns `{ messageId }`. A second call with the same `rumor.id` is a no-op (dedup on `eventId`).

**AC-10** `applyInboundRumor(thread, rumor)` with `rumor.content === "-"` sets `removed: true` on the matching `(messageId, reactorPubkey, emoji)` row and returns `{ messageId }`. If no matching row exists, it returns `null` without writing.

**AC-11** `applyInboundRumor(thread, rumor)` where the `e` tag references a messageId not present in the idb store returns `null` without writing any row (silent discard per spec §2.4, D-derived).

**AC-12** `applyOptimistic(thread, row)` writes the given `Reaction` row to the idb store and `rollbackOptimistic(thread, optimisticId)` removes the row matching `optimisticId`, leaving all other rows unchanged.

**AC-13** `subscribeReactions(thread, listener)` registers `listener` to be called whenever a row in the given thread's namespace is modified by `applyInboundRumor`, `applyOptimistic`, or `rollbackOptimistic`, and returns an unsubscribe function.

**AC-14** `clearAccountScopedIdbData` in `app/src/lib/storage.ts` is extended to delete both the `quizzl:reactions:group:*` and `quizzl:reactions:dm:*` namespaces, so that account-switching wipes all reaction data (D11, D-derived).

---

## DM Transport Migration — NIP-17/59 (Story 03)

**AC-15** `app/src/lib/directMessages.ts` (or a sibling module under `app/src/lib/directMessages/`) exports `sealAndWrap(rumor: UnsignedRumor, recipientPubkey: string, selfPrivKeyHex: string): Promise<NostrEvent>` that returns a signed kind-1059 gift-wrap event following NIP-59 (D9).

**AC-16** `unwrapAndOpen(giftWrap: NostrEvent, selfPrivKeyHex: string): Promise<UnsignedRumor>` decrypts a kind-1059 event and returns the inner unsigned rumor, throwing on invalid seal or mismatched recipient (D9).

**AC-17** `publishDirectMessage` in `directMessages.ts` calls `sealAndWrap` and publishes a kind-1059 event to the relay set; it no longer publishes kind-4 events for any new outbound message. The function name and TypeScript signature are unchanged (D9b).

**AC-18** The DM subscription in `ContactChat.tsx` subscribes to both `kinds: [4]` (legacy NIP-04 inbound) and `kinds: [1059], #p: [selfPubkey]` (gift-wrap inbound) concurrently. Both subscriptions remain active for the lifetime of the component (D9a).

**AC-19** Kind-4 events received on the legacy subscription are decrypted via NIP-04 and passed to `appendMessage`; kind-1059 events are unwrapped via `unwrapAndOpen` and, if the inner rumor is kind 14, passed to `appendMessage`. Both paths deduplicate by inner-rumor `id` so the same message does not appear twice.

**AC-20** A unit test in `app/tests/unit/directMessages/sealAndWrap.test.ts` calls `sealAndWrap` with a known rumor and recipient keypair, then calls `unwrapAndOpen` with the recipient's private key, and asserts the returned rumor's `kind`, `content`, and `tags` match the original input.

---

## Rumor Builder (Story 04)

**AC-21** `buildReactionRumor(emoji, targetMessageId, targetMessageKind, targetAuthorPubkey, selfPubkey, isRemoval)` in `app/src/lib/reactions/rumor.ts` returns an object with `kind: 7`, `content` equal to `emoji` (or `"-"` when `isRemoval` is `true`), a `tags` array containing `["e", targetMessageId]` and `["k", String(targetMessageKind)]`, and a `pubkey` equal to `selfPubkey`.

**AC-22** When `targetAuthorPubkey` is a non-empty string, `buildReactionRumor` includes `["p", targetAuthorPubkey]` in `tags`. When `targetAuthorPubkey` is `undefined`, no `p` tag is present (group rumor path per spec §3.3).

**AC-23** `buildReactionRumor` returns an object whose `id` field is a 64-character lowercase hex string equal to the SHA-256 of the canonical NIP-01 serialisation of the rumor. The object has no `sig` field.

**AC-24** `buildReactionRumor` with `emoji: ""` throws an error (WhiteNoise rejects empty content per spec §3.4).

**AC-25** A unit test in `app/tests/unit/reactions/rumor.test.ts` calls `buildReactionRumor` and asserts all fields specified in AC-21 through AC-24, including the computed `id` against an independently SHA-256-hashed canonical JSON string.

---

## Compose-Area Emoji Picker (Story 05)

**AC-26** `app/src/components/chat/EmojiComposerPicker.tsx` renders a Chakra `Popover` trigger button with `aria-label` equal to `copy.emoji.openPicker` and `data-testid="emoji-composer-trigger"` inside the `ChatBox.tsx` input toolbar.

**AC-27** Clicking `data-testid="emoji-composer-trigger"` opens the picker popover; clicking outside the popover or pressing `Escape` closes it.

**AC-28** `ChatBox.tsx` responds to the `Cmd/Ctrl+Shift+E` keyboard shortcut by toggling the compose picker open or closed, matching the behaviour of the trigger button click.

**AC-29** The picker grid renders exactly the 24 glyphs from `CURATED_EMOJI` in a 4-column layout; each glyph button has an `aria-label` of the form `copy.emoji.insertEmoji` + the glyph character and a `data-testid="emoji-glyph-{emoji}"`.

**AC-30** Clicking a glyph button in the compose picker inserts the glyph at the textarea's current cursor position, preserving text before and after the cursor byte-exact, advances the caret to immediately after the inserted glyph, and closes the picker.

**AC-31** When the textarea has no focus (no cursor), clicking a glyph appends the glyph to the end of the textarea content.

**AC-32** The picker grid implements `role="grid"` and arrow-key navigation between cells; `Enter` and `Space` activate the focused glyph and close the picker (WCAG AA, spec §1.5).

**AC-33** An E2E test in `app/tests/e2e/emoji-composer.spec.ts` opens the compose picker, selects a glyph mid-text, and asserts the textarea value has the glyph inserted at the correct position.

---

## Group Reactions — Outbound & Inbound (Story 06)

**AC-34** `ChatStoreContext` exposes `sendReaction(emoji: string, targetMessage: ChatMessage, isRemoval?: boolean): Promise<void>` accessible via `useChatStore()`.

**AC-35** Calling `sendReaction(emoji, targetMessage)` with `isRemoval` falsy immediately calls `applyOptimistic` to write an optimistic `Reaction` row with `id = crypto.randomUUID()` to the `quizzl:reactions:group:{groupId}` store before any async operation.

**AC-36** After `sendReaction` resolves, `buildReactionRumor` is called with `targetAuthorPubkey: undefined`, the resulting rumor is passed to `sendRumorSafe` (MarmotContext), and the optimistic row's `eventId` is updated to the rumor's `id`.

**AC-37** If `sendRumorSafe` rejects, `rollbackOptimistic` removes the optimistic row and `ChatBox` displays a toast with text equal to `copy.emoji.couldntReact` for the affected message (D7).

**AC-38** `MarmotContext.tsx` applicationMessage dispatch contains a `case 7:` branch that calls `applyInboundRumor({ kind: "group", groupId }, rumor)` and, on a non-null return, bumps a `reactionsVersion` counter (or calls the subscribe listeners) so the group chat re-renders the affected message's badge row (S4).

**AC-39** A kind-7 rumor whose `e` tag references a message id not in the local group message store is silently discarded by `applyInboundRumor` without logging an error (spec §2.4).

**AC-40** A multi-emoji E2E test in `app/tests/e2e/groups-reactions.spec.ts` verifies that: tab A sends a kind-7 group reaction, tab B's message bubble gains a badge row, and tab A can attach a second distinct emoji to the same message without removing the first.

---

## DM Reactions — Outbound & Inbound (Story 07)

**AC-41** `directMessages.ts` exports `publishDirectReaction(emoji, targetMessage, peerPubkeyHex, selfPrivKeyHex): Promise<{ rumorId: string }>` that calls `buildReactionRumor` then `sealAndWrap` then publishes the kind-1059 event, returning the inner rumor's `id`.

**AC-42** `directMessages.ts` exports `removeDirectReaction(emoji, targetMessage, peerPubkeyHex, selfPrivKeyHex): Promise<{ rumorId: string }>` that calls `buildReactionRumor` with `isRemoval: true`, wraps, and publishes, returning the inner rumor's `id`.

**AC-43** `ContactChat.tsx` calls `applyOptimistic` with a `Reaction` row whose `id` equals the rumor's `id` (not a temp UUID) before calling `publishDirectReaction`, so the optimistic row is immediately visible and requires no id swap on confirm.

**AC-44** If `publishDirectReaction` rejects, `ContactChat.tsx` calls `rollbackOptimistic` with the rumor id and displays a toast with text equal to `copy.emoji.couldntReact` (D7).

**AC-45** The gift-wrap subscription in `ContactChat.tsx` processes kind-1059 events: after `unwrapAndOpen`, if the inner rumor's `kind === 7`, `applyInboundRumor({ kind: "dm", peerPubkeyHex }, rumor)` is called and, on a non-null return, the `subscribeReactions` listeners are notified so the DM view re-renders the affected message's badge row (S4).

**AC-46** An E2E test in `app/tests/e2e/dm-reactions.spec.ts` verifies that: tab A sends a DM reaction, tab B's message bubble gains a badge; tab A then removes the reaction; tab B's badge disappears.

---

## Reaction Picker UI, Badge Row & Interactions (Story 08)

**AC-47** `app/src/components/chat/EmojiReactionPicker.tsx` renders a Chakra `Popover` whose trigger is an affordance on the hovered message bubble with `data-testid="reaction-trigger-{messageId}"` and `aria-label` equal to `copy.emoji.reactWith`.

**AC-48** `EmojiReactionPicker` closes when: a glyph is selected, outside the popover is clicked, or `Escape` is pressed.

**AC-49** `ChatBox.tsx` renders a `ReactionBadgeRow` below each message bubble that has at least one non-removed reaction, showing one badge per unique emoji with `data-testid="reaction-badge-{messageId}-{emoji}"`.

**AC-50** Each badge in `ReactionBadgeRow` displays the emoji glyph and a count when `count > 1`; the count element has `data-testid="reaction-count-{messageId}-{emoji}"`.

**AC-51** A badge whose `selfReacted` field is `true` (from `aggregateForMessage`) is rendered with a visually distinct style (border accent or background fill) distinguishable from non-self badges.

**AC-52** Clicking `data-testid="reaction-badge-{messageId}-{emoji}"` for an emoji where `selfReacted` is `true` calls `onReact(emoji, message, "remove")`; for one where `selfReacted` is `false` calls `onReact(emoji, message, "add")`.

**AC-53** Hovering a badge renders a tooltip listing the display names or hex pubkeys of all reactors from `ReactionAggregate.reactors`, with `aria-label` text containing `copy.emoji.reactors`.

**AC-54** The multi-emoji invariant is enforced: calling `onReact` on an emoji a user has already applied calls `removeDirectReaction` / `sendReaction` with `isRemoval: true`; calling it on a new emoji calls the add path — without removing the user's other reactions on the same message (D2).

**AC-55** `ChatBox.tsx` accepts an `onReact(emoji: string, message: ChatMessage, op: "add" | "remove") => Promise<void>` prop and passes it to both `EmojiReactionPicker` and `ReactionBadgeRow`; the prop is supplied by `ContactChat.tsx` for DMs and by `GroupChat.tsx` for groups.

**AC-56** An E2E test in `app/tests/e2e/groups-reactions.spec.ts` verifies the own-reaction highlight: after reacting, the badge for that emoji has the highlighted style; after clicking the same badge, the badge is removed.

---

## Robustness (cross-story)

**AC-57** `loadReactions(thread)` returns all reaction rows in a single idb-keyval `get` call on the thread's namespace key, so loading reactions for a conversation with N messages makes O(1) storage calls, not O(N) (spec §1.3 loading note).

**AC-58** `applyOptimistic`, `applyInboundRumor`, and `rollbackOptimistic` do not block on the message list scroll by virtue of being async idb operations; the badge row re-renders are driven by the `subscribeReactions` listeners, not by synchronous state in the scroll container.

**AC-59** After publishing fails on all relays (DM) or `sendRumorSafe` rejects (group), the reaction badge row returns to its pre-optimistic state (no badge for the rolled-back emoji) within one render cycle of the rollback call (D7).

---

## Privacy & Transport (cross-story)

**AC-60** For DM reactions, the on-the-wire event published to the relay is kind 1059 (gift wrap). No kind-7 event is published in plaintext. This is verifiable in the E2E test by inspecting `page.route` intercepts or relay event logs.

**AC-61** For group reactions, the on-the-wire event is kind 445 (MLS application message). No kind-7 event is published in plaintext to any relay. This is verifiable by asserting that no kind-7 appears in the strfry relay log during the groups E2E test.

**AC-62** `emoji` tags on inbound kind-7 rumors are ignored; no NIP-30 shortcode parsing or inline image rendering occurs (D4).

---

## i18n & Accessibility (cross-story)

**AC-63** Every emoji button in both `EmojiComposerPicker` and `EmojiReactionPicker` has a non-empty `aria-label` string; no emoji button renders without an accessible label.

**AC-64** Both picker grids implement `role="grid"` with `role="gridcell"` on each glyph button; arrow keys move focus between cells without scrolling the page.

**AC-65** The `ReactionBadgeRow` announces each badge to screen readers via `aria-label` containing the emoji and count, e.g. "👍 3" (derived from `copy.emoji.reactionCount` key).

**AC-66** No user-visible string in `EmojiComposerPicker.tsx`, `EmojiReactionPicker.tsx`, `ReactionBadgeRow`, or any toast is a hardcoded literal; all are accessed via `useCopy()` referencing keys in the `Copy` type.
