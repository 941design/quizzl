# Architecture — Message Edit & Delete (DM + Group)

Living operational document for the epic. All story agents read this. Derived from
`exploration.json` (3 code-explorer runs, 2026-07-07) and the validated `spec.md`.

## Paradigm

Modular monolith, package-by-feature, with hexagonal seams at the two transport boundaries
(NIP-17 DM gift-wrap; Marmot/MLS group application rumor). This feature adds **one shared
domain module** (edit/delete reconciliation) consumed by **two transport adapters** (DM in
`ContactChat.tsx`; group via a new dispatcher handler), plus shared **storage** and **wire-
builder** primitives. This mirrors exactly how reactions are structured today
(`reactions/api.ts` shared core + two transport call sites).

## Module map

| Module | Location | Owns | New / Modified |
|---|---|---|---|
| **Storage** | `app/src/lib/marmot/chatPersistence.ts` | `ChatMessage` row shape; append/update/remove; per-thread write queue (`appendQueues`) | **Modified**: add `tombstoned`/`edited`/`rev` fields; add update-in-place primitive (new); add AC-STORE-3 clobber-guard; filter tombstoned at read |
| **Wire builders** | new `app/src/lib/messageEdits/rumor.ts` (mirror `reactions/rumor.ts`) | kind-5 delete builder (unmarked); edit-replacement builder (kind-14/9 + `["e",orig,"","edit"]` + `["rev",T]`); edit-marked kind-5 companion; `rev` clamp helper | **New** |
| **Reconciliation core** | new `app/src/lib/messageEdits/api.ts` (mirror `reactions/api.ts`) | `applyDeleteEditSignal(thread, rumor)`; rev-clock ordering + tie-breaks; tombstone/edit apply; pending buffer (cap+TTL, per-target, max-rev collapse); materialize-on-expiry; persisted delete-marker set; optimistic/rollback pair | **New** |
| **DM adapter** | `app/src/components/contacts/ContactChat.tsx` + `app/src/lib/directMessages.ts` | `publishDirectDelete`/`publishDirectEdit`; inbound kind-5 branch (historical L338-380 + live L418-486); author-pubkey auth via seal | **Modified** |
| **Group adapter** | `app/src/context/ChatStoreContext.tsx` + new `app/src/lib/marmot/handlers/deleteEditHandler.ts` | group delete/edit send (optimistic + `sendRumorSafe` + rollback); new `RumorHandler{kind:5}`; version-bump to trigger re-read | **Modified + New handler** |
| **Rendering / UI** | `app/src/components/chat/ChatBox.tsx` (+ conversation list preview) | own-message action menu (edit/delete); edit-mode composer; "(edited)" marker; delete confirmation; tombstone filter in render; list-preview fallback; image delete-yes/edit-no | **Modified** |
| **i18n** | `app/src/lib/i18n.ts` | en+de keys for all new strings, via `useCopy()` | **Modified** |

## Boundary rules

- **No direct imports across module boundaries except through declared seams.** Specifically:
  handler files under `app/src/lib/marmot/handlers/` MUST have **zero imports from
  `app/src/context/`** (enforced convention today) — they receive deps via an injected bag
  (`HandlerDeps` in `registerHandlers.ts`). The new `deleteEditHandler.ts` follows this.
- **The reconciliation core (`messageEdits/api.ts`) is React-free and context-free.** Both a
  React component (`ContactChat.tsx`) and a non-React dispatcher handler
  (`deleteEditHandler.ts`) call it, so it may import only `chatPersistence` + pure helpers —
  never `context/`. Same rule reactions/api.ts already honors.
- **Storage is the single writer of message rows.** All mutation (append, update-in-place,
  tombstone) enqueues on the existing per-thread `appendQueues` keyed by `storageKey(groupId)`
  so concurrent writes to a thread never race. Do NOT bypass the queue.
- **`removeMessages` (hard delete) is reserved for the ADR-001/002 purge / self-heal path.**
  User delete is a **field flip** (`tombstoned:true`), never a physical remove (AC-DEL-5).

## Seams (cross-story contracts)

1. **Reconciliation seam** — `applyDeleteEditSignal(thread: {kind:'dm',peerPubkeyHex} | {kind:'group',groupId}, rumor: UnsignedRumor|ApplicationRumor): Promise<ChangeResult>`. Both
   transports pass a structurally identical rumor (`{id,pubkey,created_at,kind,tags,content}`).
   Storage story (S-storage) and reconciliation story (S-reconcile) define this seam; both DM
   and group adapter stories consume it unchanged.
2. **Storage update-in-place seam** — a new `chatPersistence` primitive
   (`updateMessageInPlace(groupId, id, patch)` / `tombstoneMessage(groupId, id, rev)`) that the
   reconciliation core calls. Defined by the storage story; consumed by reconciliation.
   Storage provides an atomic **strictly-older-rev floor** — inside the same queue turn as the
   merge, a write whose `rev` is strictly less than the stored row's `rev` is rejected, closing
   the read-modify-write TOCTOU a caller would otherwise have across two queue turns. Storage
   does **not** resolve equal-rev ties: a write whose `rev` equals the stored `rev` always passes
   the floor, and S3 alone decides (delete-wins; else higher replacement-id wins) which patch to
   construct and send for that case. See the `MessagePatch` doc comment in `chatPersistence.ts`.
3. **Version-bump seam (group)** — the new kind-5 handler calls a state-setter (reuse
   `setChatVersion`, or add `setEditsVersion`) supplied via `HandlerDeps` to trigger
   `ChatStoreContext` re-read. Defined when the group adapter lands.
4. **Composer edit-mode seam (UI)** — `ChatBox` gains an edit-mode input (`editingMessage` +
   `onEditSubmit`, or an overloaded `sendMessage`). `ChatBox` is the single composer owner for
   both surfaces, so this seam is defined once and used by both.
5. **Read-only message access (utility, not a write seam)** — list-preview surfaces
   (`GroupCard.tsx`, the `ContactCardPreview` in `contacts.tsx`) may call
   `chatPersistence.loadMessages(threadId)` + `filterVisibleMessages` **directly** for
   read-only message history. This is a read utility, NOT the write path: all edit/delete
   *mutations* still route exclusively through the `MessageActionHandlers` seam (seam 4 / the
   S4/S5 handlers). The direct read is precedented (`ContactChat.tsx` already loads history this
   way pre-epic) and carries no reconciliation/write authority. Documented here (S6 review,
   2026-07-07) so the read path is an explicit allowed utility rather than an undeclared
   boundary crossing.

## Implementation constraints (binding for this epic)

- **`rev` is new machinery — no precedent in this codebase.** Reactions' only ordering safety
  is binary "removed-wins" (`reactions/api.ts:402-410`); the wall-clock `rev` total order
  (D12/D15/D16) is net-new. Implement exactly per spec §2.4/§2.5: `rev` = real Unix **seconds**;
  sender clamps `rev = max(wallSeconds, slot's last-known rev + 1)` per-slot; delete-wins ties;
  else higher replacement rumor id wins. The edit replacement's wire `created_at` is pinned to
  the **original's seconds** and MUST NOT double as the clock — carry `["rev",T]` separately.
  Note `ChatMessage.createdAt` is **ms**; the wire `created_at` is **seconds** — pin the seconds.
- **Pending buffer: cap + TTL, no drop-in constant exists.** Model the cap on
  `pendingInvitations.ts` (`GLOBAL_CAP=256`, per-key collapse, drop-oldest); add an **explicit
  new named TTL constant** (the TTL half has no precedent — name it, e.g.
  `PENDING_SIGNAL_TTL_MS`, and a `PENDING_SIGNAL_CAP`). Buffer is keyed per unresolved target
  id, collapsing to the max-`rev` signal per id; eviction removes oldest **targets** (AC-ORDER-2).
  On expiry: pending **delete** → persist a content-free tombstone marker keyed by target id
  (later original stays suppressed, AC-ORDER-4); pending **edit-marked replacement** →
  materialize under the original's `e`-tagged slot id retaining `rev`, no "(edited)" marker.
- **Retain-and-apply replaces silent-discard at THREE gate sites.** Reactions discard unknown-
  target references at: group `reactionHandler.ts:36-41`, DM historical `ContactChat.tsx:352-362`,
  DM live `ContactChat.tsx:447-463`. The kind-5 path must instead route unknown targets to the
  pending buffer. Put the retain logic inside the shared reconciliation module so all three
  callers get it uniformly (do NOT reimplement per-caller).
- **Author authorization (AC-AUTH-2) is deferred to application time.** For a pending signal the
  author isn't known until the target arrives. DM: verify via the seal's real-key signature
  (`unwrapAndOpen` already binds sender). Group: verify via the MLS-authenticated **rumor**
  pubkey — NOT the kind-445 ephemeral wrapper author (see learning
  `kind-445-events-have-ephemeral-authors`). Only the original author may signal their own slot.
- **Concurrency posture = ADR-003 (LWW).** `marmot-ts commit()` does not throw on same-epoch
  concurrent conflict (learning `marmot-ts-commit-does-not-throw`); there is no protocol-level
  no-clobber. All ordering is resolved at the application layer on `rev`. Do not design as if a
  no-clobber primitive exists.
- **Testing: NO fast-check, NO jsdom.** The base plugin's JS/TS language skill defaults to
  fast-check, but this project has zero fast-check usage and an explicit "not a dependency"
  comment (`themes/contrast.hexParsing.test.ts:3-6`). Order-independence (AC-ORDER-3) and
  idempotency (AC-STORE-2) MUST be tested via the project's established **table-driven `it.each`
  / hand-rolled parametric-loop** convention (see `reactions/api-property.test.ts`), NOT by
  introducing a generator framework. Unit tests: `app/tests/unit/**/*.test.ts` only; mock
  `idb-keyval` with a `Map`; clear both the map and the module's in-memory cache in `beforeEach`;
  rumor-builder tests use real `nostr-tools` crypto with the `webcrypto` polyfill; test closures
  that can't be exported by re-deriving the predicate inline, never by mounting React.
- **E2E: drive through the app.** Use a second `browser.newContext()` peer + a `window.__few*`
  dev bridge that calls the real publish function (mirror `window.__fewDmReactions.send` /
  `window.__fewReactions.send`) — never hand-sign + raw-WebSocket. Assert async wire/reconcile
  state via `expect.poll` on `data-testid` readiness markers, never `waitForTimeout`. Full gate
  is `make test` (`make test-e2e-all` = 48 tests). New testids: e.g. `edited-marker-<id>`,
  `msg-deleted-<id>`.
- **i18n:** all new user-facing strings get en+de entries in `i18n.ts`, consumed via
  `useCopy()`. Shared chat strings today split between `Copy.emoji` (flat) and `Copy.groups`
  (chat*/image*) — either is precedented; pick one and be consistent. Copy MUST stay neutral —
  no "erased"/"deleted for everyone" (AC-INTEROP-1).

## Known cross-cutting decisions the planner/architect must not silently drop

- **Failure-UX divergence:** DM reaction failures toast; group failures only throw. Edit/delete
  must make a deliberate choice (unify to toast on both, or match each transport's current
  behavior). Document it in the relevant story.
- **`ChatMessage` field threading:** every writer constructs `ChatMessage` object literals
  (`chatHandler.ts`, `ChatStoreContext.sendMessage`/`sendImageMessage`, `ContactChat` inbound).
  Adding fields is additive/safe but each construction site needs the new fields threaded.
- **Image messages need no separate delete path** — they share the `ChatMessage` store; the
  tombstone flag covers them. Only "edit affordance hidden for images" (AC-IMG-2) and "blob not
  removed" (AC-IMG-3) are image-specific, both handled in the UI/rendering layer.

## Suggested story boundaries (planner authors the authoritative split)

The module map implies a natural, module-owned, sequential split: (1) storage foundation →
(2) wire builders → (3) reconciliation core + pending buffer → (4) DM adapter → (5) group
adapter → (6) UI/i18n/rendering → (7) e2e. Storage and reconciliation are the load-bearing
seams and should land before either transport adapter. The planner may merge or resplit, but
must keep one owning module per story so seams stay typed and each story is independently
verifiable.
