# Architecture — Group Invite Link Onboarding

## Paradigm

Client-only static-export React/Next app (TypeScript). Package-by-feature under `app/src`,
with a `marmot/` module owning all MLS/Nostr protocol plumbing and `context/` owning React
state providers. This epic touches the `marmot/` protocol module, one `components/groups/`
view, one `context/` provider (read-only use), and `lib/i18n.ts`. No new architectural
layer is introduced; the epic extends existing seams.

## Module map

| Module | Location | This epic's role |
|---|---|---|
| Join card UI | `app/src/components/groups/JoinRequestCard.tsx` | Add nameless-user name gate (S1) |
| Profile state | `app/src/context/ProfileContext.tsx` | Read-only: `saveProfile` is the sole nickname writer (S1 calls it) |
| Name predicate | `app/src/lib/shareCard.ts` | Read-only: `hasShareableName` is the gate's single source of truth |
| Join-request send | `app/src/lib/marmot/joinRequestSender.ts` | Add `requesterName` field (S2); sign the kind-13 seal (S3) |
| Join-request handler | `app/src/lib/marmot/joinRequestHandler.ts` | Parse + cap nickname; populate `PendingJoinRequest.nickname` (S2) |
| Admin pending row | `app/src/components/groups/PendingRequestsSection.tsx` | Confirm name+npub co-render once populated (S2) |
| Welcome/join unwrap | `app/src/lib/marmot/welcomeSubscription.ts` | Enforce seal auth for both kinds (S3); authenticated-admin auto-accept (S4) |
| Outbound records | `app/src/lib/marmot/outboundJoinRequests.ts` (new) | Persist `{nonce, adminPubkeyHex, groupName, sentAt}` (S4) |
| Shared unwrap reference | `app/src/lib/directMessages.ts` | Read-only donor of the authenticated-unwrap pattern (`unwrapAndOpen`) + NIP-59 helpers |
| i18n | `app/src/lib/i18n.ts` | New en+de keys under `copy.groups.joinRequest*` |

## Boundary rules

- No direct imports across module boundaries beyond those already present. Cross-module
  access stays through existing exports (`saveProfile`, `hasShareableName`,
  `joinGroupFromWelcome`).
- The nickname reaches the admin **only** through the existing NIP-59 gift wrap addressed to
  the admin's pubkey. No new event kind, no new relay publish, no kind-0. (Privacy invariant.)
- `saveProfile` (`ProfileContext`) is the **only** writer of the user's nickname. S1 must not
  introduce a second write path.
- Trust decisions use the **authenticated seal pubkey**, never the self-claimed
  `rumor.pubkey`. This is a hard rule for both message kinds after S3.

## Seams (cross-story dependencies)

- **S3 → S4.** Auto-accept (S4) correlates on the authenticated sender; that identity only
  exists once S3's authenticated unwrap lands. S4 depends on S3.
- **S3 internal coupling (send ↔ receive).** Signing the join-request seal
  (`joinRequestSender.ts`) and enforcing seal verification (`welcomeSubscription.ts`) MUST
  land together. Enforcing verification while the seal is still unsigned drops every join
  request. The planner MUST NOT split these into separately-shippable stories.
- **S1 → S2.** The gate (S1) guarantees a name exists before a request is sent; the nickname
  transport (S2) carries it. S2 is only meaningful for requests that passed the gate, but the
  handler must still tolerate a missing field (older clients) — so S2 does not hard-depend on
  S1 at the code level, only at the product level.
- **Shared join core (S4).** `acceptPendingInvitation` cannot run on a never-enqueued
  Welcome; S4 extracts a shared join core (`joinGroupFromWelcome` + record cleanup) that both
  the manual-accept and auto-accept paths call. This is a refactor seam within
  `welcomeSubscription.ts`.

## Implementation constraints

- Static export: no dynamic route segments; the join card stays on `/groups` reading query
  params.
- All new user-facing strings via `useCopy()`, en+de, no hardcoding.
- Tests: vitest unit tests under `app/tests/unit/`; no jsdom / component-render / snapshot
  capability — "renders as today" claims verify via e2e, not snapshots.
- E2E through the app's own publish helpers (second `browser.newContext()`), never raw
  WebSocket to strfry. The full suite (`make test-e2e-all`) is the gate.
- Reuse the audited `nostr-tools/nip59` seal/wrap helpers (already used by `directMessages.ts`)
  for the S3 seal signing rather than extending the hand-rolled seal construction.
