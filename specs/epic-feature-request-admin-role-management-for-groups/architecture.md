# Architecture: Admin Role Management for Groups

## Paradigm

Modular Next.js app. `MarmotContext` is the single authority for all MLS interactions; the page coordinator (`groups.tsx`) derives UI state from context and passes it as props to presentational components. Presentational components have no context calls of their own (MemberList is fully prop-driven).

## Module Map

| Module | File | Owned Data / Responsibility |
|---|---|---|
| **MarmotContext** | `app/src/context/MarmotContext.tsx` | All MLS group operations. New: `grantAdmin`, `getPendingRemovals`. Remove: auto-promote block. |
| **grantAdminImpl** | `app/src/lib/marmot/grantAdminImpl.ts` (new) | Pure Deps-injected implementation for admin grant; superset guard; single commit. Mirrors `cancelInvitationImpl.ts`. |
| **MemberList** | `app/src/components/groups/MemberList.tsx` | Fully prop-driven presentational. New props: `adminPubkeys`, `isCurrentUserAdmin`, `onMakeAdmin`, `pendingRemovalPubkeys`. |
| **LeaveGroupButton** | `app/src/components/groups/LeaveGroupButton.tsx` | Soft-leave handler with new last-admin guard. New props: `adminPubkeys`, `ownPubkeyHex`. |
| **GroupsPage** | `app/pages/groups.tsx` | Coordinator: derives `isAdmin`, `adminPubkeys`, `pendingRemovalPubkeys`; wires `onMakeAdmin`; passes new props to MemberList and LeaveGroupButton. |
| **i18n** | `app/src/lib/i18n.ts` | Copy strings. New keys: `makeAdminButton`, `makeAdminTitle`, `makeAdminBody`, `makeAdminConfirm`, `adminBadge`, `lastAdminLeaveBlocked`, `leavePendingBadge`, `removalPendingBadge`. |

## Boundary Rules

No direct imports across module boundaries. Cross-module access only through declared seam contracts. Specifically:

- `grantAdminImpl.ts` has zero imports from `app/src/context/` (mirrors `cancelInvitationImpl.ts` constraint).
- `MemberList.tsx` has zero `useMarmot()` or `useContext` calls — all data comes in as props.
- `LeaveGroupButton.tsx` currently calls `useMarmot()` for `leaveGroup` only; after this epic it also receives `adminPubkeys` and `ownPubkeyHex` as props (not from the hook, because both are already computed in `groups.tsx`).

## Seams

### MarmotContextValue additions

```typescript
// New methods on MarmotContextValue:
grantAdmin: (groupId: string, pubkey: string) => Promise<{ ok: boolean; error?: string }>;
getPendingRemovals: (groupId: string) => string[]; // hex pubkeys with pending eviction
```

### MemberList new props

```typescript
// Additions to MemberListProps:
adminPubkeys?: string[];           // from mlsGroup?.groupData?.adminPubkeys ?? []
isCurrentUserAdmin?: boolean;      // the isAdmin value from groups.tsx
onMakeAdmin?: (pubkey: string) => Promise<void>;  // only passed when isCurrentUserAdmin
pendingRemovalPubkeys?: string[];  // from getPendingRemovals(groupId)
```

### LeaveGroupButton new props

```typescript
// Additions to LeaveGroupButtonProps:
adminPubkeys?: string[];
ownPubkeyHex?: string | null;
```

## Key Data Flows

### grantAdmin flow

```
onMakeAdmin(pubkey) in groups.tsx
  → grantAdmin(groupId, pubkey) in MarmotContext
    → re-read live adminPubkeys from mlsGroup.groupData?.adminPubkeys
    → evaluate superset guard (reject if newSet ⊄ currentSet)
    → Proposals.proposeUpdateMetadata({ adminPubkeys: [...currentAdmins, pubkey] })
    → single mlsGroup.commit({ extraProposals: [proposalAction] })
    → reloadGroups() + markBackupDirty(true)
    → onMembersChanged fires → setGroupDataVersion(v+1)
      → useEffect in groups.tsx → getMarmotGroup → setMlsGroup
        → isAdmin recomputes → MemberList re-renders with updated adminPubkeys
```

### pendingRemovals surface flow

```
kind-13 intent received
  → enqueueLeave(groupId, pubkey) appends to pendingRemovalsRef
  → (on groupDataVersion tick) groups.tsx calls getPendingRemovals(groupId)
    → passed to MemberList as pendingRemovalPubkeys
      → per-member: isPendingLeave = pendingRemovalPubkeys.includes(pubkey)
        → renders leavePendingBadge or removalPendingBadge
```

### last-admin guard flow

```
User clicks "Leave group" in LeaveGroupButton
  → check: adminPubkeys.length === 1 && adminPubkeys[0].toLowerCase() === ownPubkeyHex?.toLowerCase()
    → true: show blocked explanation (lastAdminLeaveBlocked copy), no leave confirmation
    → false: normal leave confirmation flow
```

## Implementation Constraints

1. **Commit discipline**: `grantAdmin` re-reads live `adminPubkeys` from `mlsGroup.groupData?.adminPubkeys` at fire time, never a stale UI snapshot (same as `cancelInvitationImpl.ts:68`).
2. **Superset guard**: Any `adminPubkeys` update whose new set is not a superset of the live current set is rejected before the proposal is built (AC-GRANT-5).
3. **Single commit**: Remove and `proposeUpdateMetadata` proposals always bundled in one `mlsGroup.commit()` call — never two separate commits.
4. **Dynamic import**: All `@internet-privacy/marmot-ts` imports inside callbacks use `await import(...)` — never top-level (SSR safety).
5. **pendingRemovalsRef is a ref, not state**: It is intentionally not reactive. `getPendingRemovals` is a synchronous read; `groups.tsx` calls it on each `groupDataVersion` tick.
6. **i18n mandatory**: All new user-visible strings extend the `Copy` type in `i18n.ts` with matching `en` and `de` entries. No hardcoded strings in components.
7. **Dead code removal**: The auto-promote block (MarmotContext.tsx:1169-1187), `adminPromotionFailed` warning path, `inviteWarningAdminPromotion` i18n key, and `InviteMemberModal` warning display are all deleted together.
8. **Forward-only invariant**: The `grantAdmin` superset guard is the only enforcement. marmot-ts does NOT enforce this — `updateMetadata` does a wholesale replace with no superset constraint. Non-revocability is our client-side invariant only. No UI for demotion is added.
9. **E2E tests**: Must drive all interactions through the app (two browser contexts), never raw WebSocket publish. The existing `groups-admin.spec.ts` (which tests auto-promotion behavior being removed) must be rewritten.
