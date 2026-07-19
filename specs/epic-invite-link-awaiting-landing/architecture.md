# Architecture — invite-link-awaiting-landing

## Paradigm

Modular monolith, package-by-feature. This app layers as:
- **Storage libs** (`app/src/lib/**`) — framework-free, side-effecting persistence + pure logic, unit-tested via mocked idb-keyval / localStorage.
- **Context providers** (`app/src/context/**`) — React state (Marmot/MLS groups, language).
- **Components + pages** (`app/src/components/**`, `app/pages/**`) — Chakra UI, consume contexts and reactive stores via hooks.

This feature adds one reactive read layer over an existing storage lib and rewires one page branch + adds two presentational components. No new context provider, no new network channel, no new event kind.

## Module map

| Module | Location | Purpose | Owned data |
|---|---|---|---|
| Outbound-join-request store | `app/src/lib/marmot/outboundJoinRequests.ts` | Persist + **now reactively surface** this device's sent join requests | `few-outbound-join-requests` IDB store; module-level snapshot + listener set |
| i18n copy | `app/src/lib/i18n.ts` | EN/DE strings for banner + awaiting card + cancel | `groups.*` copy keys |
| Groups page | `app/pages/groups.tsx` | Returning-user invite-link landing: list + banner + awaiting cards | route-branch logic only |
| Awaiting banner | new component (e.g. `app/src/components/groups/InviteAwaitingBanner.tsx`) or inline in groups.tsx | Info banner: invited (pre-confirm) / awaiting (post-confirm) states | none (presentational) |
| Awaiting card | new component (e.g. `app/src/components/groups/OutboundJoinRequestCard.tsx`) | Dimmed/badged awaiting row + Cancel | none (presentational) |
| Join-request send | `app/src/components/groups/JoinRequestCard.tsx` | Existing send + name-gate logic, reused inline by the banner | none |

## Boundary rules

- No direct imports across module boundaries except through each module's declared exports. Components read the outbound store only via its exported hook/`subscribe`/`getSnapshot`, never by reaching into idb-keyval directly.
- **All mutations of `few-outbound-join-requests` MUST funnel through `saveOutboundJoinRequest` / `deleteOutboundJoinRequest`** (and the dead `clearAllOutboundJoinRequests` if ever revived). The reactive emitter lives inside those functions; a mutation that bypasses them silently breaks reactivity. Add a one-line contract comment where the emitter lands.
- User-facing strings come only from `i18n.ts` via `useCopy()` — never hardcoded (project rule).
- The privacy invariant is untouched: this feature publishes nothing new; Cancel is a purely local IDB delete.

## Seams (cross-story contracts)

- **S-STORE → S-PAGE/S-CARD**: the reactive read path exposes `subscribe(listener): () => void`, a synchronous cached `getSnapshot(): OutboundJoinRequestRecord[]` (unexpired only, stable reference until a real change), a load-state signal (not-yet-loaded vs loaded), and a `cancelOutboundJoinRequest(nonce)` action. Consumers depend only on this surface.
- **S-I18N → S-PAGE/S-CARD**: banner/card/badge/cancel copy keys under `groups.*` (both EN + DE) are the contract the UI reads.
- **S-SEND → S-PAGE**: the banner's inline "Request to join" reuses `JoinRequestCard`'s send + name-gate; either the card is embedded in a compact variant or its send handler is factored so the banner can invoke it. The shared name-gate predicate `isWelcomeJoinRequestDisabled` must gate the visible field (prior learning).

## Implementation constraints

- **`useSyncExternalStore` stability**: `getSnapshot()` must return a cached array reference that changes only when the record set actually changes (recompute the cached snapshot inside the emitter, not per-render). A fresh literal per render causes an infinite render loop and a React warning (prior learning `react-hook-returning-fresh-object-literal`). Model on `unreadStore.ts` (`_snapshot` cached, `_emit()` after writes).
- **Async initial populate**: unlike `pendingInvitations.ts`, IDB has no synchronous first snapshot. Populate the cached snapshot via an async load on first subscribe/module init, then `_emit()`. Expose a loaded flag so the UI can avoid a false-empty flash (render nothing / a subtle placeholder until loaded, then the empty or populated state).
- **Expiry consistency**: `getSnapshot()` returns only unexpired records (same 7-day TTL as `loadUnexpiredOutboundJoinRequestsForAdmin`). Expiry is evaluated at snapshot-compute time.
- **URL cleanup on send**: after a successful inline Request-to-join, `router.replace` to bare `/groups` (trailing-slash aware) so a reload renders the awaiting state from persistence, not the pre-confirm banner. If a record already exists for the link's nonce on open, show the awaiting state (idempotent — do not offer to re-request).
- **First-visit precedence (DD-5)**: the branch deciding first-visit welcome screen vs groups-page landing is NOT changed; only the returning-user branch that today returns the full-screen `JoinRequestCard` is rewired.
- **Testing**: React/hook logic tested via extracted pure functions + source-scan (no jsdom). Reactive emitter tested with the `pendingInvitations.test.ts` two-test shape (notify-on-mutation, silent-after-unsub) plus a snapshot assertion. i18n parity via a per-feature EN/DE exact-string test.

## Order-Sensitive Composition

This epic composes a mild order-sensitive flow worth recording as a **candidate** (conservative default):

- **Composed flow**: async snapshot populate racing a live mutation (`save`/`delete`), and the auto-accept `deleteOutboundJoinRequest` (welcomeSubscription, background) racing a user Cancel or a reload.
- **Participating modules**: Outbound-join-request store (`app/src/lib/marmot/outboundJoinRequests.ts`), Groups page (`app/pages/groups.tsx`), and the auto-accept path in `app/src/lib/marmot/welcomeSubscription.ts:553`.
- **Candidate whole-flow guarantees across orderings**:
  1. A record deleted by auto-accept or Cancel must never reappear in a later snapshot (the emitter recomputes from storage, so a late-arriving async load must not clobber a newer post-delete snapshot — mirror `unreadStore.ts`'s `initTouched`/live-increment guard if a load-vs-mutation race is observed).
  2. After auto-accept, the awaiting card for that nonce disappears and the real joined group appears — no window where BOTH is shown, and no *lasting* window where neither is shown. **(Amended 2026-07-19, Decider RETRY):** the original "no neither frame" was over-specified — a candidate invariant, not a DD requirement. The shipped auto-accept path refreshes `MarmotContext.groups` asynchronously (`onGroupJoined → void reloadGroups()`, fire-and-forget), so a brief transitional neither-frame is structurally possible; it was observed zero times in 11/11 e2e runs and has no data/correctness impact. AC-OBS-2 now enforces "never BOTH" strongly and "no *lasting* neither" (bounded appearance of the real card). Hardening the transition to be frame-perfect would require reordering prior-epic auto-accept code — deferred as disproportionate to a never-observed cosmetic frame.
  3. Cancel followed by a later admin approval falls through to the manual Accept/Decline pending path (DD-4) — the cancelled record's absence must not drop the Welcome silently.

These are candidates for the story-planner's verification questions, not asserted invariants yet.
