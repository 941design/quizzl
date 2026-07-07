# Message Edit & Delete (DM + Group) — Acceptance Criteria

<!--
  Mode 1 reconciliation note (story-planner, 2026-07-07):

  All AC bodies below are lifted verbatim (IDs and wording preserved) from
  spec.md §5, with the two 2026-07-07 amendments already folded in
  (AC-ORDER-4's persisted-tombstone-marker wording; AC-ORDER-2's
  per-target-id / max-rev-collapse / evict-oldest-targets wording — see
  spec.md ## Amendments).

  Reference-extraction pass against exploration.json: the only
  backtick-quoted file path appearing anywhere in the AC/MV text is
  `app/src/lib/i18n.ts` (AC-INTL-1). exploration.json's "i18n" finding
  affirmatively confirms this file exists and holds the `Copy` type +
  en/de objects consumed via `useCopy()` — verdict PRESENT, no drift.
  All other backtick tokens in the AC text (`rev`, `e`, `k`, `"edit"`,
  `ChatMessage.createdAt`, `created_at`, `en`, `de`, `useCopy()`) are wire
  field names / tag literals / code symbols, not file paths, manifest
  keys, or skill/agent/command names, so they are out of scope for the
  reference-extraction check. No AC in this file was rewritten, retired,
  or flagged for adjudication.
-->

## Terminology

- **Slot** — the conversation position identified by a message's original NIP-01 rumor id. An edit updates a slot's content in place; a delete tombstones the slot; the slot's id never changes across either operation (spec §2.1).
- **`rev`** — the revision clock: the real Unix-seconds wall-clock time attached to every delete/edit signal (a delete's own `created_at`; an edit's explicit `["rev", <seconds>]` tag). A slot's rendered state is the outcome of its highest-`rev` signal (spec §2.4/§2.5).
- **Rumor** — an unsigned Nostr event object (kind-14 DM chat message, kind-9 group chat message, or kind-5 delete/edit signal) exchanged inside a gift wrap (DM) or MLS application message (group); never published to a relay as a standalone relay-facing event.
- **Replacement** — the edit-marked chat rumor (kind-14 DM / kind-9 group) carrying the new content for an edit; authoritative for a Few client without requiring its companion kind-5 (D13).
- **Edit-marked kind-5** — the companion signal published alongside a replacement, carrying `["e", originalId, "", "edit"]`; ignored on receipt by a Few client, consumed only by a non-Few NIP-17 client for degradation.
- **Unmarked kind-5** — a standalone delete signal (no `"edit"` marker); always interpreted as a delete.
- **Tombstone** — the retained-but-unrendered state of a deleted slot; the row persists in storage for dedup and is filtered from render.
- **Pending buffer** — the bounded, per-target-id store of delete/edit signals whose target message has not yet arrived locally (spec §2.8).
- **Few client** — this project's own chat app. **Non-Few client** — any other Nostr/Marmot client (e.g. Amethyst, 0xchat, other NIP-17/Marmot implementations).

## Behavioral vs. Structural Observables

Every Observable below asserts externally-visible behavior (rendered state, published wire shape, or storage state after a signal), not merely the existence of a field or type. The litmus test — *could a stub/no-op satisfy this Observable?* — was applied with particular care to the highest-risk ACs: the `rev`-clock ordering ACs (AC-ORDER-3, AC-ORDER-5), the clobber-guard (AC-STORE-3), and reactions-survive-edit (AC-EDIT-7). Each of those states a concrete before/after storage or render outcome under a named signal sequence, not just a structural shape, so a stub reconciler that ignores `rev` or a no-op clobber-guard cannot pass them.

## Known TAGs

- **DEL** — delete behavior (optimistic removal, signal shape, tombstone retention).
- **TIME** — absence of any age/time-window gate on edit/delete.
- **EDIT** — edit behavior (in-place update, signal shape, rollback, reaction survival).
- **AUTH** — own-messages-only authorization.
- **STORE** — storage convergence, dedup idempotency, clobber-guard.
- **ORDER** — pending-signal retention, buffer bound, order-independent reconciliation, `rev` clamp.
- **LIST** — conversation/group list preview behavior on edit/delete of the last message.
- **IMG** — image-message-specific delete/edit behavior.
- **INTL** — internationalization of new user-facing strings.
- **INTEROP** — honesty of UI copy about non-Few / cross-client guarantees.

## Delete

**AC-DEL-1** — A user MUST be able to delete a message they authored, in both DM and group threads, for text and image messages.

**AC-DEL-2** — On delete, the message MUST be removed from the author's view immediately (optimistic), and MUST be restored if the publish fails.

**AC-DEL-3** — A cooperating Few recipient that holds the target message MUST stop rendering it (and its reactions) upon processing the delete signal — silent removal, no placeholder.

**AC-DEL-4** — The delete signal MUST be an author-signed inner kind-5 referencing the original id via `e`-tag; for DMs it MUST be sealed + gift-wrapped to the original recipient set; for groups it MUST be sent as an MLS application rumor. It MUST NOT be published as a relay-facing kind-5.

**AC-DEL-5** — A deleted message's row MUST be retained locally as a tombstone (not physically purged), so re-delivery of the original rumor MUST NOT resurrect it.

**AC-DEL-6** — Deleting MUST require a confirmation step.

**AC-DEL-7** — A standalone delete's kind-5 MUST NOT carry the `"edit"` marker; a lone unmarked kind-5 MUST be interpreted as a delete, and an `edit`-marked kind-5 MUST be ignored by a Few client (AC-ORDER-3 depends on this distinction).

**AC-DEL-8** — A delete/edit kind-5 MUST `e`-tag the original id, **plus** any prior replacement ids of the slot **that the sender still retains** (D14). Because Few uses in-place storage with no retained revision history (§7), a Few sender retains no prior replacement ids, so in practice it e-tags the original id alone. This is a **best-effort** non-Few degradation aid, not a guarantee (§4.8, AC-INTEROP-2): a message edited more than once and then deleted may leave superseded replacement copies visible on a non-Few client. Few clients reconcile by the original id alone (AC-EDIT-6) and are unaffected.

## Time

**AC-TIME-1** — Edit and delete MUST be offered regardless of the target message's age; no time window may gate them (D6).

## Edit

**AC-EDIT-1** — A user MUST be able to edit a **text** message they authored, in both DM and group threads.

**AC-EDIT-2** — On edit, the message content MUST update **in place** (retain its position), not append at the bottom.

**AC-EDIT-3** — An edited message MUST render an "(edited)" marker on both DM and group surfaces.

**AC-EDIT-4** — The edit signal MUST comprise (a) a replacement chat rumor (kind-14 DM / kind-9 group) whose wire `created_at` **field** (Unix seconds) equals the original rumor's `created_at`, and whose tags include `["e", <originalId>, "", "edit"]` and `["rev", <real Unix seconds>]`; **plus** (b) a companion `edit`-marked kind-5 (spec §2.4) for non-Few degradation. The `created_at` equality is asserted on the wire rumor field, not the millisecond `ChatMessage.createdAt` storage value. Across a repeated-edit chain, "the original rumor's `created_at`" always means the **first** message's `created_at` (the stable slot anchor, §2.1), never the immediately-prior edit's.

**AC-EDIT-5** — An edit that would produce empty content MUST be disallowed (the user is directed to delete instead).

**AC-EDIT-6** — Repeated edits MUST reference the original message id (stable anchor); the slot's id MUST NOT change across edits.

**AC-EDIT-7** — Reactions on a message MUST survive an edit of that message.

**AC-EDIT-8** — A Few client MUST apply an `edit`-marked replacement as a complete edit **without requiring** the companion kind-5; a failed/absent kind-5 MUST NOT cause the slot to be deleted. On publish failure the optimistic edit MUST be rolled back to the prior content. The replacement MUST be published before the companion kind-5.

## Authorization

**AC-AUTH-1** — Edit/delete affordances MUST appear only on messages authored by the current user.

**AC-AUTH-2** — On receive, a delete/edit signal MUST be honored only if its author pubkey matches the original message's author pubkey; a signal from any other author MUST be ignored. **DM: fully enforced** (pubkey cryptographically bound via the seal's real-key signature). **Group: best-effort / group-member-attested** — authorized on the self-asserted inner rumor pubkey; marmot-ts 0.5.1 does not expose the MLS-authenticated sender leaf for application messages, so the pubkey is not cryptographically bound to the sending member (MLS still bars non-members). This is the same trust model Few already applies to group kind-9/kind-7; full MLS-identity binding is tracked upstream (`BACKLOG.json#marmot-ts-0-5-1-drops`). See the 2026-07-07 amendment.

## Storage & Dedup

**AC-STORE-1** — For an identical set of signals delivered in any order, the DM and group transports MUST converge to an **identical rendered local model** (behavioral invariant; a shared reconciliation function is the recommended, but not the verifiable, means).

**AC-STORE-2** — Tombstoned and edited rows MUST remain dedup-stable — reprocessing the same signal MUST be idempotent.

**AC-STORE-3** — Re-delivery of an **original** message rumor MUST NOT revert an already edited or tombstoned slot (the original carries no `rev` and MUST NOT override a signal; upsert-by-id MUST NOT clobber edited content or the edited/tombstone flags).

## Ordering

**AC-ORDER-1** — A delete/edit signal whose target id is unknown at receive time MUST be retained (with authorization deferred to application time) and applied when the target arrives (NOT discarded).

**AC-ORDER-2** — Pending unresolved signals MUST be bounded by an explicit cap and TTL (a named constant, reusing the app's existing buffered-state bound — not an unstated value). The buffer MUST be keyed per unresolved target id, collapsing to the max-`rev` pending signal per id on insert (not storing every historical signal for that id); this keeps eviction from being an arrival-order accident that could drop a higher-priority pending signal under buffer pressure while a lower-priority one survives. Eviction under the cap removes oldest **targets**, not raw signals.

**AC-ORDER-3** — Reconciliation MUST be order-independent: the slot's rendered state MUST equal the outcome of its **highest-`rev`** signal for every arrival order of {original, delete, edit-replacement}. Ties MUST resolve deterministically: **delete-vs-edit at equal `rev` → delete wins**; **edit-vs-edit at equal `rev` → higher replacement rumor id wins** (D15). No arrival order or multi-device split may produce divergent final content.

**AC-ORDER-4** — On buffer expiry, a pending **delete** whose target never arrived MUST persist a **content-free tombstone marker** keyed by the target id (id-only, no row) — so a later-arriving original for that id is still suppressed and MUST NOT render. A pending **edit-marked replacement** whose original never arrived MUST be **materialized under its original (`e`-tagged) slot id** — retaining its `rev`, rendered as an ordinary message without the "(edited)" marker — so a later original or delete for that id reconciles normally instead of forming a duplicate slot. Both branches persist their effect on expiry; neither silently drops it. The persisted delete-marker set is **cap-bounded** (same cap as the pending buffer, AC-ORDER-2) but is **NOT** TTL-expired — a marker is durable suppression of a retracted message, so ageing it out would resurrect that message; markers are evicted only under cap pressure (oldest first), never by age. Reconciliation is additionally **self-healing**: a pending signal or marker whose target row already exists is applied to that row directly (deferred authorization is satisfiable from the row's own author), so a missed resolve call or a crash between append and resolve converges on the next signal or thread-open sweep rather than diverging permanently.

**AC-ORDER-5** — `rev` MUST be sender-clamped to `max(wallSeconds, slot's last-known rev + 1)` (D16); a signal's slot MUST be resolvable by matching any of its `e`-tagged ids against the slot's original id or any stored replacement id (§2.5).

## Rendering & Lists

**AC-LIST-1** — Once an edit signal for a thread's last message has been processed, that thread's list preview MUST reflect the new text. (If DM ingest only runs while a thread is open, "processed" occurs on next open; the spec does not require a background DM ingest path — see spec §4.6 / implementation note.)

**AC-LIST-2** — Once a delete signal for a thread's last message has been processed, the preview MUST fall back to the previous surviving message (or the empty state).

## Images

**AC-IMG-1** — An image message MUST be deletable (tombstoned) like any other message.

**AC-IMG-2** — An image message MUST NOT offer an edit affordance.

**AC-IMG-3** — Deleting an image message MUST NOT attempt to remove the Blossom blob; the file remaining fetchable is a documented limitation, not a defect.

## Internationalisation

**AC-INTL-1** — All new user-facing strings (edit/delete actions, "editing" state, cancel, delete confirmation, "(edited)") MUST have both `en` and `de` entries in `app/src/lib/i18n.ts` and MUST be consumed via `useCopy()`.

**AC-INTL-2** — No new user-visible string may be hardcoded in a component.

## Interop Honesty

**AC-INTEROP-1** — No UI copy may imply a hard/enforced deletion (e.g. "erased", "deleted for everyone"). Copy MUST remain neutral.

**AC-INTEROP-2** — No AC or UI copy may assert that a non-Few client honors delete/edit as a guarantee. Non-Few DM interop is expected-but-unverified (spec §4.8) and MUST be treated as a best-effort degradation, validated only by the gating manual check MV-2.

## Manual Validation

| MV id | Behavioral intent | Owner | Blocked on |
|-------|-------------------|-------|------------|
| MV-1 | DM delete/edit sent from Few is honored by a second Few client (message hides / updates in place with "(edited)"). | QA / product owner | AC-DEL-3, AC-EDIT-2, AC-EDIT-3 |
| MV-2 | DM delete sent from Few, observed on a NIP-17 non-Few client (e.g. Amethyst), hides the original (best-effort interop check; degradation for edit acceptable). Gating per spec §4.8 before the interop row of §1 is relied on. | QA / product owner | AC-INTEROP-2 |
| MV-3 | Group delete/edit sent from Few is honored by a second Few group member. | QA / product owner | AC-DEL-3, AC-EDIT-2, AC-EDIT-3 |
| MV-4 | A delete signal that arrives before its target message (simulated ordering) results in the message never rendering (pending-apply works). | QA / product owner | AC-ORDER-1 |
| MV-5 | Reactions on a message survive an edit and vanish on a delete. | QA / product owner | AC-EDIT-7, AC-DEL-3 |
| MV-6 | Order-independence: for the same message, the arrival orders (edit→delete), (delete→edit), and (edit#1→edit#2 delivered reversed) all converge to the same final render (delete wins; newest edit wins), confirming the `rev`-clock reconciliation. | QA / product owner | AC-ORDER-3 |
