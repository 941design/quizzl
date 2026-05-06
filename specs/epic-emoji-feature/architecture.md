# Epic Architecture — emoji-feature

This is the operational architecture for the **emoji-feature** epic.
All teammates (planner, architect, verifier, subagents) read this
before starting work. It is binding for story decomposition,
implementation, and verification.

It synthesizes:

- the spec at `specs/epic-emoji-feature/spec.md`,
- the project decisions at `specs/epic-emoji-feature/decisions.md`
  (D1 – D11),
- the codebase exploration at `specs/epic-emoji-feature/exploration.json`.

If those documents conflict, the order of precedence is:
**decisions.md → exploration.json → spec.md**. Spec sections that the
decisions explicitly override (e.g. `identity_id` in §1.3, NIP-30 in
§2.3) are out of scope.

---

## 1. Paradigm

**Modular monolith** with strict **n-tier layering** inside a single
Next.js 14 app at `app/`. Imports flow downward only:

```
app/pages/ ──▶ app/src/components/ ──▶ app/src/context/ ──▶ app/src/lib/
```

A small **hexagonal seam** lives at `app/src/lib/marmot/`: it adapts
the `marmot-ts` ports (`NostrNetworkInterface`, `EventSigner`) to NDK
and IDB. New marmot-ts callers must go through this seam.

There is no plan to introduce a new top-level paradigm or a new
state-management library for this epic.

## 2. Module Map

The epic touches or extends the modules below. Each story declares
its `owning_module` from this list (planner enforces).

| Module | Directory | Owns | Epic role |
|--------|-----------|------|-----------|
| `chat-shell` | `app/src/components/chat/` | Compose toolbar + message list shell (`ChatBox.tsx`) | Hosts compose-area emoji picker trigger; renders reaction badge row below each bubble; renders reaction-trigger handle on bubble hover |
| `dm-surface` | `app/src/components/contacts/` | DM transport + view (`ContactChat.tsx`) | Wires DM reactions via the new `directMessages` API; receives gift-wrap inbound events |
| `group-surface` | `app/src/components/groups/` | Group UI components | Wires group reactions via `ChatStoreContext` |
| `chat-store` | `app/src/context/ChatStoreContext.tsx` | Group transport controller, optimistic send | Surfaces reactions state and `sendReaction` for groups |
| `marmot-orchestrator` | `app/src/context/MarmotContext.tsx` | MLS init, rumor dispatch, version counters | Adds `case 7:` in the application-message dispatch and a `reactionVersion` counter |
| `dm-transport` | `app/src/lib/directMessages.ts` (split into a folder if it grows) | Outbound NIP-17/59 gift-wrap, inbound dual-decode (kind-4 legacy + kind-1059) | Owns `sealAndWrap`, `unwrapAndOpen`, `publishDirectMessage`, `publishDirectReaction`, `removeDirectReaction` |
| `marmot-adapter` | `app/src/lib/marmot/` | NDK ⇄ marmot-ts port adapters, chat persistence | Hosts the new reactions persistence module |
| `reactions-store` | `app/src/lib/reactions/` (NEW) | Reactions persistence + read API | Owns the reactions schema, idb-keyval namespaces, query helpers, dedup logic |
| `nostr-identity` | `app/src/context/NostrIdentityContext.tsx` | Active keypair | Read-only consumer; no new responsibilities |
| `i18n` | `app/src/lib/i18n.ts` | Copy type + en/de objects | Adds emoji-feature keys; companion `*.i18n.test.ts` |
| `keyboard-shortcuts` | `app/src/components/chat/ChatBox.tsx` (existing handler) | Compose-area key handling | Adds `Cmd/Ctrl+Shift+E` toggle for the picker |

A new top-level UI module is **not** introduced. Picker components
live alongside the message-input under `app/src/components/chat/`.

## 3. Boundary Rules

These hold for the whole epic:

1. **Downward imports only.** No `lib/` file imports from
   `components/`, `context/`, or `pages/`. No `context/` file imports
   from `components/` or `pages/`. Violations fail review.

2. **Type-only imports across module boundaries are allowed.**
   `ChatBox.tsx` already imports the `ChatMessage` type from
   `lib/marmot/chatPersistence`; the same pattern is acceptable for
   new types like `Reaction` and `ReactionAggregate`.

3. **DM and group state do not share runtime state.** DM reactions
   live under one persistence namespace and are read by
   `ContactChat.tsx`; group reactions live under another namespace
   and are read by `ChatStoreContext`. **Helpers are shared, state is
   not.** The shared helper module is `lib/reactions/` (see §4).

4. **All marmot-ts calls go through the adapter.** New rumor
   construction uses `buildRumor()` from `MarmotContext.tsx`. New
   group sends use `sendRumorSafe()`. Do not introduce a parallel
   wrapper.

5. **All NDK publishing goes through the existing helpers.**
   - DM publish: extend `directMessages.ts`; do not call `ndk.publish`
     directly from components.
   - Group publish: continue via `sendApplicationRumor` inside
     `MarmotContext`; never publish kind-7 directly to relays for
     groups.

6. **Static-export constraints.**
   - No new API routes, no new `/api/*` files invoked at runtime.
   - All persistence stays client-side (idb-keyval / localStorage).
   - All publishing stays browser-direct over WebSocket.
   - Routing stays on the established query-param pattern
     (`/contacts?id=…`, `/groups?id=…`); no `[param].tsx` segments.

7. **i18n compliance is a hard gate.** Every user-visible string is
   added to the `Copy` type and to both `en` and `de` objects, and
   covered by a `.i18n.test.ts` file. No literal strings in
   components.

8. **`crypto.subtle` guard.** Any new crypto code (gift-wrap, hashing
   for rumor IDs) follows the existing `globalThis.isSecureContext`
   guard pattern and runs only after dynamic import to keep SSR safe.

9. **Identity scoping.** This app is single-identity (one keypair via
   `NostrIdentityContext`). The spec's `identity_id` column is
   **dropped** (D11). Do not reintroduce a multi-identity isolation
   concept.

10. **NIP-30 is out of scope.** No `:shortcode:` parsing, no inline
    image rendering for emoji tags. `emoji` tags on inbound rumors
    are carried opaquely by MLS and ignored by the renderer.

## 4. Seams

The cross-story contracts. The planner declares the seam in
`stories.json` *before* the producer or consumer story starts.
Contract first, then the stories that produce/consume it.

### Seam S1 — `Reaction` row

Owned by **`reactions-store`** (`app/src/lib/reactions/`).

```ts
// app/src/lib/reactions/types.ts
export type ReactionThreadKey =
  | { kind: "group"; groupId: string }
  | { kind: "dm"; peerPubkeyHex: string };

export interface Reaction {
  /** Local UUID for optimistic rows; replaced by the wire id on confirm. */
  id: string;

  /** Local message id (== ChatMessage.id) the reaction attaches to. */
  messageId: string;

  /** Reactor identity (hex pubkey). */
  reactorPubkey: string;

  /** Unicode glyph. NIP-30 shortcodes are out of scope (D4). */
  emoji: string;

  /** Wire event id. For groups: the inner kind-7 rumor id. For DMs: the inner kind-7 rumor id (NOT the kind-1059 wrap). Empty string for in-flight optimistic rows. */
  eventId: string;

  /** ms since epoch (matches ChatMessage.createdAt). */
  createdAt: number;

  /** Tombstone marker: true if a `content: "-"` removal rumor has been observed for this (messageId, reactorPubkey, emoji) tuple. Tombstoned rows are not rendered but are kept for dedup. */
  removed: boolean;
}
```

**Multi-emoji invariant (D2):** at most one *non-removed* row per
`(messageId, reactorPubkey, emoji)` triple. Inbound deduplication is
by `eventId`.

### Seam S2 — Reactions read API

Owned by **`reactions-store`**, consumed by `chat-shell`,
`dm-surface`, `group-surface`.

```ts
// app/src/lib/reactions/api.ts
export interface ReactionAggregate {
  emoji: string;
  count: number;
  reactors: string[];   // hex pubkeys, stable order: oldest first
  selfReacted: boolean; // true iff the active identity has a non-removed row for this (messageId, emoji)
}

export function loadReactions(thread: ReactionThreadKey): Promise<Reaction[]>;
export function aggregateForMessage(rows: Reaction[], messageId: string, selfPubkey: string): ReactionAggregate[];
export function subscribeReactions(thread: ReactionThreadKey, listener: () => void): () => void;
// internal-ish helpers (also exposed for tests):
export function applyInboundRumor(thread: ReactionThreadKey, rumor: { id: string; pubkey: string; created_at: number; content: string; tags: string[][] }): Promise<{ messageId: string } | null>;
export function applyOptimistic(thread: ReactionThreadKey, row: Reaction): Promise<void>;
export function rollbackOptimistic(thread: ReactionThreadKey, optimisticId: string): Promise<void>;
```

`subscribeReactions` follows the established **module-singleton +
useSyncExternalStore** pattern from `app/src/lib/unreadStore.ts`. No
new context provider is introduced for reactions.

### Seam S3 — Outbound reaction send

Two transport-specific functions, one shared rumor builder.

```ts
// app/src/lib/reactions/rumor.ts
export function buildReactionRumor(
  emoji: string,
  targetMessageId: string,
  targetMessageKind: number,
  targetAuthorPubkey: string | undefined, // omit for groups (D in §3.3 spec)
  selfPubkey: string,
  isRemoval?: boolean,
): UnsignedRumor;
```

```ts
// DM (extends app/src/lib/directMessages.ts)
export function publishDirectReaction(
  emoji: string,
  targetMessage: ChatMessage,
  peerPubkeyHex: string,
  selfPrivKeyHex: string,
): Promise<{ rumorId: string }>;

export function removeDirectReaction(
  emoji: string,
  targetMessage: ChatMessage,
  peerPubkeyHex: string,
  selfPrivKeyHex: string,
): Promise<{ rumorId: string }>;
```

```ts
// Group (extends app/src/context/ChatStoreContext.tsx via MarmotContext)
sendReaction(emoji: string, targetMessage: ChatMessage, isRemoval?: boolean): Promise<void>;
```

The `chat-shell` consumes a single uniform prop:
`onReact(emoji: string, message: ChatMessage, op: "add" | "remove") => Promise<void>`.

### Seam S4 — Inbound reaction ingest

Two entry points, one shared apply path.

- **DM** — inside the new gift-wrap subscription in
  `ContactChat.tsx`: after `unwrapAndOpen`, if `rumor.kind === 7`,
  call `applyInboundRumor({ kind: "dm", peerPubkeyHex }, rumor)`.
  Unknown `e` tag → silent discard (spec §2.4).
- **Group** — inside the kind dispatch in `MarmotContext.tsx` near
  line 534: `case 7:` → `applyInboundRumor({ kind: "group", groupId }, rumor)`.

Both paths bump the `reactionsVersion` (or call the
`subscribeReactions` listeners) so the UI re-renders.

### Seam S5 — DM transport migration (D9)

Owned by **`dm-transport`**. New module surface:

```ts
export function sealAndWrap(
  rumor: UnsignedRumor,
  recipientPubkey: string,
  selfPrivKeyHex: string,
): Promise<NostrEvent>; // signed kind-1059 gift wrap

export function unwrapAndOpen(
  giftWrap: NostrEvent,
  selfPrivKeyHex: string,
): Promise<UnsignedRumor>;
```

`publishDirectMessage` is **rewritten** to use `sealAndWrap`. The
existing function name and external signature stay stable; the
*wire format* changes. Callers do not need to change.

The DM subscription in `ContactChat.tsx` is **dual-listening**:

- `kinds: [4]` → existing NIP-04 decrypt path (read-only inbound,
  forever, per D9a).
- `kinds: [1059], #p: [selfPubkey]` → new gift-wrap unwrap path.

Both paths feed the same `appendMessage` for chat (kind-14) and the
same reaction ingest for kind-7. Dedup by inner-rumor `id`.

## 5. Implementation Constraints

- **Test commands:** always `make test-unit`, `make test-e2e`,
  `make test-e2e-groups`, `make build`. Never raw `npx`. The platform
  stamp at `app/node_modules/.platform_<OS>-<ARCH>` will trip native
  binary failures otherwise.
- **Unit tests:** Vitest, `app/tests/unit/**/*.test.ts`. No
  component rendering — there is no `@testing-library/react` in this
  project. Picker behaviors that need DOM (cursor insertion, focus,
  popover) go in **e2e** instead, or refactor the logic into a pure
  function and unit-test the pure function.
- **E2E tests:** Playwright `*.spec.ts` under `app/tests/e2e/`.
  Reaction sync tests need the relay-backed harness:
  `make test-e2e-groups`.
- **i18n tests:** companion `*.i18n.test.ts` per CLAUDE.md and
  exploration §7. Assert exact strings for both `en` and `de`.
- **Popover UI:** mirror `app/src/components/NotificationBell.tsx`
  (only existing Chakra `Popover`). Use `useDisclosure`,
  `PopoverTrigger`, `PopoverContent`, `PopoverBody`, `PopoverArrow`.
- **Selectors in tests:** prefer `data-testid` and
  `getByRole({ name })`. Set `aria-label` on every emoji glyph button
  per spec §1.5.
- **Optimistic-UI:**
  - Group reactions use `crypto.randomUUID()` as the optimistic
    `id`, matching `ChatStoreContext.tsx:177`.
  - DM reactions sign-then-publish — the inner rumor `id` is
    available pre-publish, so insert the row with the real id and
    skip the temp UUID dance.
  - Rollback policy on publish failure: D7 — log + remove local row +
    inline "couldn't react" toast; no auto-retry.
- **Persistence migrations:** none expected. New idb-keyval
  namespaces (`quizzl:reactions:group:{groupId}`,
  `quizzl:reactions:dm:{peerPubkeyHex}`) start empty. The DM
  transport migration (D9) does **not** migrate IDB-stored history;
  existing `quizzl:messages:{*}` rows render as-is.
- **Account-scoped clear:** add reactions namespace clearing to
  `clearAccountScopedIdbData` in `app/src/lib/storage.ts:223-237`.
  Forgetting this leaks data across account switches.
- **Bundle size:** no new npm dependency for the picker (D3). If a
  story claims it needs one, escalate to the lead.

## 6. Story Sequencing Hint (non-binding)

The planner produces the canonical `stories.json`. As architectural
guidance only, the sequencing that minimizes seam churn is:

1. **i18n + types** — add `Copy` keys, `Reaction*` types in
   `lib/reactions/types.ts`. Pure data, no behavior.
2. **Reactions persistence + read API (S1, S2)** — idb-keyval
   namespaces, aggregation, subscribe pattern. Unit-testable in
   isolation.
3. **DM transport migration to NIP-17/59 (S5)** — outbound
   `sealAndWrap` + dual-listening inbound. Independent of reactions
   per se; reactions for DMs depend on it.
4. **Compose-area picker (§1.1)** — `ChatBox.tsx` integration,
   curated 24-emoji grid, cursor insertion, keyboard shortcut.
5. **Group reactions outbound + inbound (S3, S4 group leg)** — wire
   into `MarmotContext` + `ChatStoreContext`. Render badges in
   `ChatBox`.
6. **DM reactions outbound + inbound (S3, S4 DM leg)** — wire into
   `ContactChat`. Reuses the picker UI from step 4.
7. **Reaction picker UI + own-reaction highlight + tooltip** —
   the popover-on-bubble interaction.

Steps 1-2 are independent and can run in parallel with step 3. Steps
4-7 depend on 1-2.

## 7. What This Epic Does *Not* Do

For clarity to all teammates — these are explicit non-goals:

- No NIP-30 custom emoji (D4).
- No NIP-51 emoji-set sync.
- No `emoji-mart` dependency or full-Unicode picker (D3).
- No quick-reactions inline row (D5).
- No double-tap default reaction (D5).
- No multi-identity isolation (D11).
- No SSR/server-side anything (existing constraint).
- No NIP-04 outbound for any new code path (D9b).
- No automated CI added in this epic.
