# Architecture — Inline Invitation Cards

## Paradigm

Modular monolith, package-by-feature. React (Next.js static export) + Chakra UI +
TypeScript. State via React context + module-level `useSyncExternalStore` stores.
Marmot/MLS access is isolated behind `MarmotContext` (dynamic-imported at the
boundary). This epic adds no new paradigm — it threads existing seams.

## Module Map

| Module | Purpose | Location | Owned data |
|---|---|---|---|
| pending-invitations store | localStorage queue of received Welcomes | `app/src/lib/pendingInvitations.ts` | `PendingInvitation[]` (UNCHANGED this epic) |
| welcome-subscription (marmot lib) | receive/read/accept/decline Welcomes; **pre-join group-data decode** | `app/src/lib/marmot/welcomeSubscription.ts` | pre-join decode helper (NEW sibling of `readPreJoinGroupName`) |
| marmot context | React boundary for marmot ops | `app/src/context/MarmotContext.tsx` | NEW read method exposing pre-join group data |
| contacts lib | pubkey → known-contact name (local) | `app/src/lib/contacts.ts` | `getContact` (reused, unchanged) |
| pubkey format util | truncate hex pubkey for display | NEW `app/src/lib/pubkeyDisplay.ts` (or similar) | extracted `truncatePubkey` |
| invitation card component | inline card variant (name, badge, Invited-by, accept/decline, tap-to-preview) | NEW `app/src/components/groups/InvitationCard.tsx` | none (reads store + context) |
| invitation preview view | read-only pre-join preview | NEW component in / imported by `app/pages/groups.tsx` | none |
| groups page | list/detail/preview routing + list layout | `app/pages/groups.tsx` | query-param routing, list composition |
| badge accents | badge color kinds | `app/src/lib/badgeAccent.ts` | NEW `invitation` kind |
| i18n | copy | `app/src/lib/i18n.ts` | NEW invitation keys; DROP heading/empty |

## Boundary Rules

- No direct imports across module boundaries except through declared seams. UI
  components reach marmot only through `useMarmot()` (never import
  `welcomeSubscription.ts` directly into a component — mirror the existing
  accept/decline dynamic-import boundary).
- The pre-join group-data decode lives in `welcomeSubscription.ts` (lib), is exposed
  to components only via a `MarmotContext` method. Components never construct a
  `MarmotClient` or call marmot-ts directly.
- Contact-name resolution uses `getContact` (local-only). No component performs a
  relay lookup for attribution.
- **Privacy boundary (hard):** nothing added here publishes to a public relay. Group
  name/description/admins are decrypted from the recipient-addressed Welcome;
  attribution reads local contacts only. Verified per AC-REG-2.

## Seams (cross-story contracts)

1. **`readPreJoinGroupData(welcomeRumor, marmotClient): Promise<{name, description, adminPubkeys} | null>`**
   — new sibling of `readPreJoinGroupName` in `welcomeSubscription.ts`. Side-effect-free,
   returns `null` when no local key package matches. Consumed by the context method.
   (Story 1 owns; Stories 2 & 3 consume.)
2. **`MarmotContext.getInvitationGroupData(welcomeEventJson: string): Promise<{name, description, adminPubkeys} | null>`**
   — parses the stored rumor JSON, calls seam 1 with `clientRef.current`. Consumed by
   the card and the preview. (Story 1 owns; Stories 2 & 3 consume.)
3. **`truncatePubkey(hex: string): string`** — extracted shared helper (currently
   inlined at `PendingInvitations.tsx:80-81`). Pure, unit-testable. (Story 1 owns;
   Stories 2 & 3 consume.)
4. **Attribution helper** — `resolveInviterLabel(inviterPubkeyHex, ownPubkeyHex): string`
   = `getContact(...)?.nickname || truncatePubkey(...)` (treat `''` as fall-through).
   Pure/near-pure, unit-testable. (Story 1 owns; Stories 2 & 3 consume.)
5. **Stable testids** (`accept-invitation-${id}`, `decline-invitation-${id}`,
   `pending-invitations-section` wrapper) — AC-TESTID-1. Any story rendering
   invitation UI must preserve these strings. (Story 2 owns the card + wrapper;
   Story 3 preview uses its own `invitation-card`/preview testids but reuses the
   accept/decline handlers.)

## Implementation Constraints

- Static export → preview is reached by `router.query.invite`, never a dynamic path
  segment. Render inside `groups.tsx`, mirroring the `router.query.id` detail branch.
- Async decode must never block the list: the card renders a fallback label
  (`copy.groups.pendingInvitations.unknownGroupFallback` or similar) until/if the
  decode resolves, and a failed decode of one invitation never breaks the list
  (AC-DATA-2).
- Empty-state condition on `groups.tsx` must include `invitations.length === 0` (else
  it misfires once invitations move into the list area).
- Keep `accept-invitation-${id}` / `decline-invitation-${id}` / `pending-invitations-section`
  stable (AC-TESTID-1). Add a code comment on the wrapper explaining the retained
  name is a stable readiness gate for ~19 peripheral specs.
- vitest passing ≠ build passing: run the project typecheck/build for Chakra/TS JSX
  errors, not just unit tests.
- All strings via `useCopy()`, en + de.

## Order-Sensitive Composition

This epic does **not** compose order-sensitive subsystems in the sense that matters
for the mutation-gate posture (no merge/convergence logic, no event-sourced
projection, no multi-writer CRDT flow, no protocol codec, no crash-recovery ordering
is introduced). The one time-ordered interaction — accept → `reloadGroups()` →
invitation removed from store → group appears as joined card — is a linear,
single-writer UI refresh already owned by the existing `acceptPendingInvitation`
context method; this epic does not change that ordering, only the surfaces that
trigger it. No whole-flow ordering guarantee is derived. (Conservative default
recorded: nothing to add to the order-sensitive list.)
