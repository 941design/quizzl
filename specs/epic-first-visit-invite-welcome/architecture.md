# Architecture — First-visit invite welcome screen

## Paradigm

Modular monolith, package-by-feature within a Next.js Pages-Router static-export
app. UI in `app/pages/` (routes) and `app/src/components/` (components); pure logic
and codecs in `app/src/lib/`; cross-cutting state in `app/src/context/`. This epic
is a **presentation-layer addition plus one context signal** — it introduces no new
transport, no new persistence, and no new external boundary.

## Module map

| Module | Purpose | Location | Owned data |
|---|---|---|---|
| Identity context | Auto-generates/loads the local keypair; the new `isFreshIdentity` signal | `app/src/context/NostrIdentityContext.tsx` | `lp_nostrIdentity_v1`, session `isFreshIdentity` |
| Profile context | Local profile (nickname/avatar); `saveProfile` | `app/src/context/ProfileContext.tsx` | `lp_userProfile_v1` |
| Welcome UI (new) | The blended welcome-invite presentation component | `app/src/components/WelcomeInvite.tsx` (new) | none (stateless presentation) |
| Hero accents | Decorative watercolor accents (reused) | `app/src/components/HeroAccents.tsx` | none |
| Contact-card entry | `/add` deep-link handler + pure decode | `app/pages/add.tsx`, `app/src/lib/addDeepLink.ts`, `app/src/lib/contactCard.ts` | contact caches |
| Group-invite entry | `/groups?join` handler + join card | `app/pages/groups.tsx`, `app/src/components/groups/JoinRequestCard.tsx` | outbound join records |
| i18n | Copy dictionaries | `app/src/lib/i18n.ts` | `Copy` type, `en`/`de` |

## Boundary rules

- No direct imports across feature boundaries except through existing public
  helpers (`useNostrIdentity`, `useProfile`/`saveProfile`, `useCopy`,
  `parseContactCard`, `sendJoinRequest`, the add-flow entry).
- The new `WelcomeInvite` component is **pure presentation**: it takes the invite
  line, the name-input state, disabled/loading flags, and the primary-action
  callback as props. It does not itself call transport, decode cards, or persist —
  the page/card callers own that.
- Reuse existing copy for the pitch (`home.subheadingLead`,
  `home.subheadingPoints`); do not duplicate those strings.

## Seams

- `NostrIdentityContext` → new `isFreshIdentity: boolean` on its context value.
  Consumed by `add.tsx` and the group-invite path. Derived from
  `loadStoredIdentity() === null` at init; session-scoped, no new persistence.
- `WelcomeInvite` presentation ← invite-line text (nullable for the fallback),
  reused pitch copy, name value + onChange, primary-action label + disabled +
  onClick. Two call sites (contact / group) supply variant-specific content and
  the completion callback.
- Contact completion reuses the existing add path (`processContactInput` /
  add-flow); group completion reuses `sendJoinRequest`. The name is persisted via
  `saveProfile` before completion in both.

## Implementation constraints

- **Privacy invariant (hard):** the entered name and any profile metadata must
  never be published as a public/kind-0 event. It rides only the existing
  encrypted, recipient-addressed channels (group join request gift-wrap; targeted
  pairing echo). Verify no new publish path is introduced.
- **Static export:** no dynamic route segments; keep everything on the existing
  `/add` and `/groups` pages via query/fragment params (already the case).
- **i18n:** every new user-visible string added to the `Copy` type and both `en`
  and `de`; dynamic lines use the function-copy pattern.
- **SSR:** identity/profile contexts are `ssr:false` dynamic; the welcome screen
  renders client-side after hydration (consistent with today's gated content).
- **Testing:** unit tests are vitest, `tests/unit/**` only, no jsdom — test pure
  logic via exported functions (e.g. the fresh-identity derivation, the invite-line
  selection incl. the no-name fallback). Behavioral coverage of the two entry
  points belongs to the e2e buckets (contact = non-relay/add flow; group =
  relay bucket). Decorative accent rendering carries no assertions by precedent.

## Order-Sensitive Composition

This epic does **not** compose order-sensitive subsystems. It adds a presentation
layer and one boolean context signal; it introduces no merge/convergence logic, no
event-sourced projection, no multi-writer or redelivery/crash-recovery flow, and no
protocol codec. The reused transport paths (join request, pairing echo) retain
their existing ordering guarantees and are not modified. No whole-flow ordering
guarantee is introduced or altered.
