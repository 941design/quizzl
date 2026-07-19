# Architecture — invite-rescind-and-member-removal

## Paradigm

Modular monolith (Next.js static-export PWA), package-by-feature under `app/src`,
with a strict **three-layer seam** already established across the group-membership
surface:

| Layer | Owns | Directory |
|---|---|---|
| **UI** | Rendering, confirm dialogs, per-row label choice | `app/pages/`, `app/src/components/groups/` |
| **Context boundary** | Dynamic-import of pure impls + marmot-ts, `useCallback` wiring, `useMemo` value object, refs | `app/src/context/MarmotContext.tsx` |
| **Pure impl** | MLS ops (commit/proposals) — zero React/context imports, fully unit-testable via injected `Deps` | `app/src/lib/marmot/*Impl.ts` |
| **Storage** | idb-keyval CRUD, LWW merge, inbound-rumor handlers | `app/src/lib/marmot/*Storage.ts`, `app/src/lib/marmot/handlers/` |

This epic adds the one missing concept — **pending-direct-invite state** — and a
second removal affordance, without inventing a new paradigm or MLS message.

## Module map

| Module | Purpose | Location | New / Modified |
|---|---|---|---|
| **PendingInviteStore** | Persist the pending-direct-invite marker (`groupId:pubkey`); read/write/clear (per-key, per-group, `'*'` full) | `app/src/lib/marmot/pendingDirectInviteStorage.ts` | **NEW** (mirror `profileRequestStorage.ts`) |
| **MemberProfileStore** | Member profiles; add a **per-member purge** primitive | `app/src/lib/marmot/groupStorage.ts` | Modified (add `deleteMemberProfile`) |
| **RemovalImpl** | Shared MLS remove — already label-agnostic | `app/src/lib/marmot/cancelInvitationImpl.ts` | Reused as-is (both affordances call it) |
| **MarmotContext** | Expose marker read (`getPendingDirectInvites`), `removeMember`, marker-clear-on-profile wiring | `app/src/context/MarmotContext.tsx` | Modified (4-site method-add pattern) |
| **ProfileHandler** | Clear the marker when the invitee's **own signed** profile arrives | `app/src/lib/marmot/handlers/profileHandler.ts`, `registerHandlers.ts` | Modified (inject `clearPendingDirectInvite` dep) |
| **LeaveGroupImpl** | Per-group leave cleanup fan-out — add marker clear | `app/src/lib/marmot/leaveGroupImpl.ts` | Modified (one `clear*` dep) |
| **MemberList (UI)** | Per-row label choice: Cancel Invite (marked pending) vs Remove Member (else); two confirm dialogs | `app/src/components/groups/MemberList.tsx` | Modified |
| **GroupsPage (UI)** | Load the marker Set alongside `confirmedPubkeys`; `onRemoveMember` handler; post-removal purge + marker-clear | `app/pages/groups.tsx` | Modified |
| **InviteMemberModal (UI)** | Write the marker before `inviteByNpub`; clear on failure | `app/src/components/groups/InviteMemberModal.tsx` | Modified |
| **ProfilePage (UI)** | Same marker-write at the profile-page direct-invite site | `app/pages/profile.tsx` | Modified |
| **i18n** | `removeMember*` keys (en + de) | `app/src/lib/i18n.ts` | Modified |

## Boundary rules

- No direct imports across module boundaries except through the established seam.
  Pure-impl files (`*Impl.ts`) import **nothing** from `app/src/context/`; every
  side-effect (storage, MLS op) arrives as an injected `Deps` function. The new
  marker store is a storage module (idb-keyval), consumed by the UI via a
  **context method**, never imported directly into a pure-impl file.
- `inviteByNpub` stays npub/pubkey-only and is **not** modified. The marker write
  is scoped to the two direct-invite UI call sites (`InviteMemberModal.submitInvite`
  path and `profile.tsx handleAddToGroup`), so `approveJoinRequestImpl` — which
  calls `inviteByNpub` directly at `MarmotContext.tsx:515` — never writes the
  marker. Exclusion is structural (insertion-point choice), not a guard.
- The removal MLS op stays in `cancelInvitationImpl.ts` (IDB-decoupled). The
  per-member **profile purge** and **marker clear** attach in the `groups.tsx`
  caller *after* the removal resolves, gated on a post-hoc "pubkey no longer in
  the tree" check — never inside the pure impl.

## Seams

*(Populated by the story-planner from cross-story dependencies. Candidate seams:
PendingInviteStore↔GroupsPage read contract; RemovalImpl↔GroupsPage post-removal
purge/clear contract; ProfileHandler↔PendingInviteStore clear contract.)*

## Implementation constraints (lead decisions on the explorers' open questions)

1. **Marker write factoring.** The two direct-invite UI call sites write the
   marker via the new storage module (write-before-invite; clear-on-invite-failure),
   wrapping their existing `inviteByNpub` call. **Do NOT route the write through
   `inviteByNpub`** (that would fire on the approve path too). The marker **read**
   for the member list is a single async context method `getPendingDirectInvites(groupId)`
   called **once** in the `groups.tsx` member-loading effect (`:298-343`), producing
   a `Set<string>` threaded to `MemberList` as a new prop — **not** a per-row async
   call (spec §2.3 / V5).
2. **Marker-clear-on-profile is gated on arrival, not on the LWW merge result.**
   Clear when the invitee's **own signed** profile arrives — `profilePayload.signedEvent`
   present AND its author (`signedEvent.pubkey`, already surfaced as `authorPubkey`
   at `profileHandler.ts:33` and as `memberProfile.pubkeyHex` via `payloadToMemberProfile`)
   equals the marked pubkey — **independent of whether `mergeMemberProfile` returned
   `true`**. A stale/duplicate resend that loses the LWW race is still proof the
   invitee is live; gating on `merged===true` would wrongly skip the clear (V-arch-2).
   Relay-on-behalf safe: require the signed envelope, do not fall back to `rumor.pubkey`.
3. **Per-group marker cleanup is dual-sited**, following every sibling store: clear
   in **both** `clearAllGroupData` (`groupStorage.ts:112`, account reset) **and**
   `leaveGroupImpl`'s per-group leave fan-out (`:25-50`). The spec's §2.2 citation
   named only the former; the latter is required for parity (V-arch-3).
4. **Best-effort marker write** (spec §2.1): if the marker write throws (IDB
   quota/transient), log and proceed with the invite — precedent
   `incrementInviteLinkUsage` / the provisional-profile seed (`MarmotContext.tsx:566`,
   `:538`). A missing marker only downgrades the label to "Remove Member".
5. **Label mutual-exclusion** at the row: `isPending && markerSet.has(pubkey)` →
   "Cancel Invite"; every other in-tree, not-self, admin-visible row → "Remove
   Member". Reuse the existing `confirmedPubkeys`→`isPending` derivation
   (`MemberList.tsx:100`); do not re-derive.
6. **Confirm-dialog testids** go on the inner actionable `<Button>` (e.g.
   `remove-member-confirm-${prefix}`), never on the Chakra `<Modal>` wrapper
   (learning `chakra-ui-modal-does-not-forward`); e2e asserts open/close via the
   button's visibility.
7. **New e2e specs are named `groups-*.spec.ts`** (relay bucket by filename glob).
   Contact setup uses `seedContact`/`inviteContactViaPicker` (`helpers/group-setup.ts`),
   not the heavier `helpers/pairing.ts`. Scenario 1 & 2 MUST close the invitee's
   browser context before the admin approves (masking-trap; template
   `groups-join-request-profile.spec.ts:132-137`).

## Order-Sensitive Composition

**Yes — this epic composes order-sensitive subsystems.** Correctness depends on
ordering, concurrency (multiple admins), redelivery (LWW profile merges), and
crash/race recovery (the `raceDetected` short-circuits).

- **Composed flow:** *pending-direct-invite lifecycle* — mark (before invite) →
  [invitee accepts, own signed profile arrives, OR admin removes, OR concurrent
  co-admin removes] → clear marker + purge profile.
- **Participating modules (Module Map name → Location):**
  - PendingInviteStore → `app/src/lib/marmot/pendingDirectInviteStorage.ts`
  - RemovalImpl → `app/src/lib/marmot/cancelInvitationImpl.ts`
  - MemberProfileStore → `app/src/lib/marmot/groupStorage.ts`
  - ProfileHandler → `app/src/lib/marmot/handlers/profileHandler.ts`
  - GroupsPage → `app/pages/groups.tsx`
- **Whole-flow guarantees that must hold across orderings and interleavings:**
  1. **Marker-implies-pending-or-gone.** A persisted marker never coexists with a
     confirmed member: it is cleared when the invitee's own signed profile arrives
     (they become confirmed) OR when the pubkey leaves the tree. No ordering of
     accept/remove/relay-on-behalf leaves a marker on a confirmed row.
  2. **Purge-on-removal is commit-independent.** The per-member profile purge and
     marker clear run on **every** exit where the pubkey ends up no longer in the
     tree — including both `raceDetected` short-circuits (`cancelInvitationImpl.ts:56-63`,
     `:80-83`) where a concurrent co-admin already committed the Remove and this
     client does no MLS work. Gate on "no longer a member," never on "this client
     committed." Failing this reproduces the re-invite-looks-confirmed bug (§3, F7/V3).
  3. **No stuck-unremovable state.** Because Remove Member is universal (any in-tree
     member, any admin), eviction is always possible regardless of whether the
     marker reached a given co-admin. The marker affects the *label* only, never
     the *capability* — so no interleaving of invite/marker-loss/co-admin-view can
     produce a row an admin cannot act on.
  4. **Orphan-marker safety.** A marker written before an `inviteByNpub` that then
     fails is cleared on that failure; and even if that clear is missed, the
     `isPending && marker` conjunction hides it (the pubkey is not in the tree), so
     a stale marker never surfaces a spurious affordance.
