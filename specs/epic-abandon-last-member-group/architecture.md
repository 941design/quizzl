# Architecture — Abandon Last-Member Group

Operational document for this epic. Every agent reads this before touching code.
Derived from `exploration.json`; `spec.md` remains authoritative for intent.

## Paradigm

Modular monolith, package-by-feature, with a hexagonal seam at the marmot/MLS
boundary. Three layers, and this epic must not blur them:

```
components/    render + user interaction; calls context methods only
    ↓
context/       stateful glue; the ONLY place marmot-ts client objects live
    ↓
lib/marmot/    the marmot integration layer: pure logic + idb-keyval storage
```

The epic's whole shape follows from one project constraint: **the unit bucket has
no jsdom and no `@testing-library`** (`app/vitest.config.ts`, default node env —
structural, not merely conventional). Behavior that lives in a component or a
context callback is untestable. So behavior that needs an AC gets extracted into
`lib/marmot/` as a pure function or an injected-deps impl. That is why
`selectLeaveModalState` and `leaveGroupImpl` exist.

## Module map

| Module | Location | Purpose | Owned data |
|---|---|---|---|
| `leaveEligibility` **(new)** | `app/src/lib/marmot/leaveEligibility.ts` | `isLastMember`, `isSoleAdmin` (moved), `selectLeaveModalState` | none — pure |
| `leaveGroupImpl` **(new)** | `app/src/lib/marmot/leaveGroupImpl.ts` | Extracted `leaveGroup` body: send-skip decision, sends, purge | none — Deps-injected |
| `MarmotContext` | `app/src/context/MarmotContext.tsx` | Owns `clientRef` + `groups` overlay; wraps impls with live deps; gains `getLiveMemberPubkeys` | `groups: Group[]`, mirrored to `groupStorage.ts` |
| `LeaveGroupButton` | `app/src/components/groups/LeaveGroupButton.tsx` | Renders whichever of 3 states `selectLeaveModalState` returns | local `isOpen`/`isLoading`/`liveMembers` |
| `inviteLinkStorage` | `app/src/lib/marmot/inviteLinkStorage.ts` | idb-keyval CRUD (`few-invite-links`); gains `clearInviteLinksForGroup` | `InviteLink[]` keyed by `nonce` |
| `joinRequestStorage` | `app/src/lib/marmot/joinRequestStorage.ts` | idb-keyval CRUD (`few-join-requests`) | `PendingJoinRequest[]` keyed by `eventId` |
| `i18n` | `app/src/lib/i18n.ts` | `Copy['groups']` type + en/de objects | 3 new keys |

`leaveEligibility.ts` must be **`.ts`, not `.tsx`** — the vitest node env cannot
parse JSX.

## Boundary rules

1. **No direct imports across module boundaries.** Cross-module access goes
   through declared seams.
2. **Components never read MLS state directly.** They call context methods. This
   epic adds `getLiveMemberPubkeys` to the context rather than letting
   `LeaveGroupButton` reach for marmot-ts (AC-STRUCT-4).
3. **`lib/marmot/` impls must not import from `app/src/context/`.**
   `grantAdminImpl.ts:1-8` states this explicitly. It is why `sendRumorSafe` and
   `buildRumor` get **injected** rather than exported from the context and
   imported back.
4. **marmot-ts import discipline** — the real rule, which an early spec draft got
   wrong:
   - `lib/marmot/` imports it freely (static for types/pure values:
     `applicationRumorDispatcher.ts:40`, `groupStorage.ts:12`,
     `NdkNetworkAdapter.ts:16`, `epochResolver.ts:16`,
     `welcomeSubscription.ts:23`). That layer *is* the integration boundary.
   - `MarmotContext.tsx` imports it **only dynamically** — all ten sites are
     `await import(...)` (644, 702, 926, 1238, 1536, 1716, 1741, 1795, 1825, 1871).
   - **Components: not at all.** `IncomingCallWatcher.tsx:104` already violates
     this. It is a pre-existing violation, **not** sanctioned precedent — do not
     cite it to justify a second.
5. **Chakra testids never go on `<Modal>`.** It is a portal wrapper that renders
   no DOM node; the attribute is silently dropped with no runtime warning. Put it
   on `<ModalContent>` (as `BlockContactButton.tsx:110` correctly does).
   `LeaveGroupButton.tsx:102` has the broken form today and no spec queries it —
   AC-STRUCT-5 fixes it.

## Seams

| Seam | Contract | Consumers |
|---|---|---|
| `selectLeaveModalState(memberPubkeys, adminPubkeys, ownPubkeyHex) → 'abandon' \| 'blocked' \| 'confirm'` | Pure. Tests last-member **before** sole-admin. `undefined` members ⇒ never `'abandon'`. | `LeaveGroupButton` (S2); unit tests (S1) |
| `getLiveMemberPubkeys(groupId) → Promise<string[] \| undefined>` | Context method. Wraps `getGroup` (`:1655`, already null-safe) + dynamic `getGroupMembers`. Resolves `undefined` — not `[]` — when unreadable. | `LeaveGroupButton` (S2) |
| `leaveGroupImpl(deps, groupId) → Promise<boolean>` | Injected-deps impl. Re-derives last-member from live MLS state itself (AC-STRUCT-3). | `MarmotContext.leaveGroup` (S3); unit tests (S3) |
| `clearInviteLinksForGroup(groupId) → Promise<void>` | `entries()` → filter `groupId` → `Promise.all(del(nonce))`. Mirrors `clearPendingJoinRequestsForGroup` (`joinRequestStorage.ts:72-76`). | `leaveGroupImpl` purge (S3); unit tests (S3) |

## Implementation constraints

**Follow `grantAdminImpl`, not `cancelInvitationImpl`, where they differ.**
`grantAdminImpl` takes zero top-level marmot-ts imports (everything Deps-injected),
which is why `grantAdminImpl.test.ts` needs no `vi.mock('@internet-privacy/marmot-ts')`
at all. Target that.

Conventions both precedents share:
- `Deps` **type** (not interface), listing every side-effecting dependency.
- marmot-ts opaque shapes typed `any`, **not** `unknown` — deliberate, to avoid
  contravariance fights at the boundary (`cancelInvitationImpl.ts:8-10`).
- `MarmotGroupLike` duplicated verbatim per impl, not shared.
- Never throw to the caller; return `{ ok: boolean; error?: string }` with named
  string-literal error codes.
- Live re-read on **every** attempt, never a stale snapshot across retries
  (`grantAdminImpl.ts:50-53, 74-76`).
- On success: `deps.reloadGroups()` then `deps.markBackupDirty(true)`, in that order.
- Context wires via `await import('@/src/lib/marmot/xImpl')` + object-literal deps.
  Closest analogues: `MarmotContext.tsx:1789-1812` (grantAdmin), `:1819-1837` (renameGroup).

**The one dep with no precedent.** `sendRumorSafe` (`MarmotContext.tsx:93-117`)
and `buildRumor` (`:120-130`) are module-private, unexported functions in the
context — not marmot-ts exports. Both precedent impls only ever inject
marmot-ts-shaped things. Inject these as `Deps` fields (rule 3 above forbids the
import-back alternative). `serialiseLeaveIntent` is already a pure import from
`leaveSync.ts:34` and may be called directly.

**Sizing.** `leaveGroupImpl`'s `Deps` will be considerably larger than either
precedent's: the entire purge sequence (`removeGroupFromStorage`,
`clearMemberProfiles`, `clearMessages`, `clearPollData`, `clearGroupMedia`,
`clearProfileRequestMemos`, `clearUnreadGroup`, `reloadGroups`, `markBackupDirty`)
are plain top-level imports in `MarmotContext` today and all become Deps.

**Testing idioms** (see `exploration.json#testing_conventions` for line refs):
- Negative send assertion: `expect(deps.mockX).not.toHaveBeenCalled()`.
- idb-keyval: mock the **library**, not the storage module, with an in-memory `Map`.
- Source-scan: `fs.readFileSync` + regex; strip comments line-based for AC-STRUCT-5,
  raw for AC-STRUCT-4.

## Order-Sensitive Composition

**Yes — this epic composes an order-sensitive flow.** Recorded per the
conservative default.

**The composed flow:** modal-open live read → decision → user confirm →
execution-time live read → send-skip decision → sends → purge.

**Participating modules** (name + Location, both identifier spaces):

| Module Map name | Location |
|---|---|
| `LeaveGroupButton` | `app/src/components/groups/LeaveGroupButton.tsx` |
| `MarmotContext` | `app/src/context/MarmotContext.tsx` |
| `leaveEligibility` | `app/src/lib/marmot/leaveEligibility.ts` |
| `leaveGroupImpl` | `app/src/lib/marmot/leaveGroupImpl.ts` |
| `inviteLinkStorage` | `app/src/lib/marmot/inviteLinkStorage.ts` |
| `joinRequestStorage` | `app/src/lib/marmot/joinRequestStorage.ts` |

**Candidate whole-flow guarantees that must hold across orderings:**

1. **The two live reads are independent re-derivations — never one snapshot
   threaded through.** `selectLeaveModalState` is called twice in the flow: once
   by the component with the modal-open read, once inside `leaveGroupImpl` with a
   second, later read. Piping the first into the second would look equivalent on
   the single-device happy path and would violate AC-STRUCT-3. The double read is
   what makes "a peer leaves while the confirm modal is displayed" fail safe.

2. **Fail-closed holds independently at both sites, in opposite directions.**
   Both default to `false`, but for opposite reasons — do not unify them:

   | Site | Read fails | Default | Safe because |
   |---|---|---|---|
   | Modal | members `undefined` | `isLastMember → false` ⇒ `'blocked'`/`'confirm'` | Never opens the destructive path on unknown membership. |
   | Impl | no `mlsGroup` | `lastMember → false` ⇒ **send anyway** | Worst case is a redundant send into an empty group. Defaulting to *skip* would silence a real departure. |

3. **Mixed freshness is deliberate, not sloppy.** Members are read live; admins
   stay prop-derived. Making admins live would be a **regression**: a failed live
   read would collapse to `'confirm'` and let a sole admin strand real members.
   Stale admins can only affect `'blocked'`-vs-`'confirm'`, never `'abandon'`, so
   the destructive path is unaffected. (`groups-admin.spec.ts:297-301` documents
   the pre-existing unloaded-`adminPubkeys` race this interacts with.)

4. **Membership staleness windows** — where the `Group.memberPubkeys` overlay can
   diverge from live MLS state:
   - the invite gap: `inviteByKeyPackageEvent` commits at `MarmotContext.tsx:1531`,
     but `persistGroup` lands only at `:1541` (crash-between);
   - before the subscribe-time resync (`:1233-1259`) lands in a fresh session;
   - permanently, in the multi-device case (a restored-backup clone commits an Add
     this device hasn't ingested).

   `getLiveMemberPubkeys` closes the first two. The third is conceded by DD-5/DD-6
   and is non-stranding: device B keeps an intact copy with itself as admin.

5. **The abandon path issues zero MLS commits and zero network sends** (DD-5) — a
   pure local IDB purge. It therefore cannot race a concurrent commit at the
   protocol level. The epic introduces no new concurrency hazard beyond the
   staleness window above, which DD-5/DD-6 already name and accept.

6. **Purge-sequence atomicity — known residual, not fixed here.** The purge
   (`MarmotContext.tsx:1607-1618`) is a flat sequence of unguarded `await`s; only
   the sends are wrapped, because sends are the only steps expected to fail. The
   two new leak-fixing clears append to that sequence, so an IDB error mid-purge
   leaves them un-run — the leak closes on every normal path and stays open on the
   partial-purge path. Pre-existing, out of scope, named so it is a known residual
   rather than a silent gap.
