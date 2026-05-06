# Architecture — Member profile discovery and relay-on-behalf

This is the operational document the planner, architect, and verifier read before
any story work. It defines the paradigm, the module map this epic touches, the
boundary rules between modules, and seams introduced by the epic.

Spec: `specs/epic-member-profile-discovery-and-relay-on-behalf/spec.md`
Exploration: `specs/epic-member-profile-discovery-and-relay-on-behalf/exploration.json`

---

## 1. Paradigm

**Layered / n-tier with package-by-feature.** The codebase is a Next.js 14 PWA
that ships as a fully static export. Layers, top-down:

```
pages/                          UI routes (query-param routing only — see CLAUDE.md)
  └── components/               Presentational, grouped by feature (groups/, chat/, ...)
        └── context/            React Context providers — the integration seam between
                                UI and the underlying lib/marmot, lib/nostr, IDB, NDK
              └── lib/          Domain helpers
                    ├── marmot/   MLS-on-Nostr glue: rumor sync helpers, persistence,
                    │             signer adapter, NDK ↔ marmot-ts adapter
                    ├── nostr/    Lower-level Nostr utilities
                    ├── reactions/ Per-feature module clusters
                    └── ndkClient.ts  NDK singleton
                          └── idb-keyval  Persistence
                          └── ndk         Network
                          └── marmot-ts   MLS protocol
```

**`MarmotContext.tsx` is the only place that spans React state, marmot-ts
groups, IDB writes, and NDK simultaneously.** Components subscribe to its
context value; lib modules expose typed pure or async functions and never
touch React. This is intentional and load-bearing: the epic must preserve it.

Within `app/src/lib/marmot/`, two file-name suffixes encode purity:

- **`*Sync.ts`** → pure module. No `await`, no IDB, no NDK, no React. Only
  constants, payload types, and (de)serialisation. Examples: `profileSync.ts`,
  `pollSync.ts`, `scoreSync.ts` (the latter has one localStorage seq counter,
  but is otherwise pure).
- **`*Storage.ts` / `*Persistence.ts`** → side-effecting IDB module. Owns one
  or more `idb-keyval` stores and exposes async CRUD. Examples:
  `groupStorage.ts`, `joinRequestStorage.ts`, `inviteLinkStorage.ts`.

Side-effecting modules that aren't pure persistence (NDK subscriptions, queued
network sends, cross-module coordination) get descriptive bare filenames:
`welcomeSubscription.ts`, `syncQueue.ts`, `epochResolver.ts`. The new
`profileRequestRunner.ts` falls in this last group.

---

## 2. Module map

Modules touched or created by this epic:

| Module | Path | Kind | Owned data | Public surface |
|---|---|---|---|---|
| `profileSync` | `app/src/lib/marmot/profileSync.ts` | Pure | none | `PROFILE_RUMOR_KIND`, `ProfilePayload`, `serialiseProfileUpdate`, `parseProfilePayload`, `payloadToMemberProfile` |
| `profileRequestSync` | `app/src/lib/marmot/profileRequestSync.ts` | Pure (**new**) | none | `PROFILE_REQUEST_KIND=30`, `ProfileRequestPayload`, `serialiseProfileRequest`, `parseProfileRequestPayload`, `isProfileStale`, `shouldEmitRequest`, `pickBackoffMs`, timing constants |
| `profileRequestRunner` | `app/src/lib/marmot/profileRequestRunner.ts` | Side-effecting (**new**) | module-level pending-relay timer Map keyed by `(groupId, targetPubkey)` | `sweepStaleProfiles`, `handleIncomingProfileRequest`, `notifyProfileObserved` |
| `groupStorage` | `app/src/lib/marmot/groupStorage.ts` | Side-effecting (IDB) | adds `quizzl-profile-request-memos` IDB store; persists `signedEvent` in member profiles | adds memo CRUD: `loadProfileRequestMemo`, `saveProfileRequestMemo`, `recordRequestEmitted`, `recordRequestAnswered`, `clearProfileRequestMemos` |
| `signerAdapter` | `app/src/lib/marmot/signerAdapter.ts` | Pure factory; methods async I/O | none | `createPrivateKeySigner` (existing — reused, **not modified**) |
| `MarmotContext` | `app/src/context/MarmotContext.tsx` | Side-effecting (React + MLS + NDK) | React state | exposes new `requestProfilesIfStale(groupId)` on context value; new dispatcher arm for `PROFILE_REQUEST_KIND`; new app-start sweep `useEffect`; embeds-signature verification in existing `PROFILE_RUMOR_KIND` arm |
| `types` | `app/src/types/index.ts` | Type-only | none | adds `SignedProfileEvent`, extends `MemberProfile` with `signedEvent?: SignedProfileEvent` |
| `groups` page | `app/pages/groups.tsx` | UI | route state | `GroupDetailView` route-enter `useEffect` calls `requestProfilesIfStale(id)` |

**Modules deliberately untouched:** `ndkClient.ts`, `welcomeSubscription.ts`,
`epochResolver.ts`, `chatPersistence.ts`, `pollPersistence.ts`,
`mediaPersistence.ts`, `signerAdapter.ts`. Any change to these escapes scope.

---

## 3. Boundary rules

**Default rule.** No direct imports across module boundaries. Cross-module
access only through declared seam contracts (§4) or already-exported public
surfaces (§2).

Project-specific rules — observable in current code, must be preserved:

1. **MarmotContext owns the MLS write boundary.** All `mlsGroup.sendApplicationRumor`
   and `sendRumorSafe` calls live in `MarmotContext.tsx`. The new
   `profileRequestRunner` does **not** call `sendApplicationRumor` directly —
   it returns the rumor it wants sent (or accepts a `sendRumor` callback) and
   `MarmotContext` performs the send. Same rule that already applies to every
   other rumor kind.

2. **`groupStorage.ts` owns IDB.** The new `quizzl-profile-request-memos`
   store is declared there (or in a new `profileRequestStorage.ts` co-located
   in `lib/marmot/` following the `joinRequestStorage.ts` template). Runner
   and context never call `idb-keyval` directly.

3. **`profileSync.ts` owns profile-payload (de)serialisation.** Sign and
   verify of the embedded `SignedProfileEvent` happen here. `parseProfilePayload`
   becomes the single place where signature verification of incoming profiles
   runs. The runner relays cached signed events verbatim and does **not** need
   to re-verify (the signature is already known good — it was verified before
   we cached it).

4. **`profileRequestSync.ts` owns request-payload shape.** Type, kind constant,
   serialise/parse, dedupe predicate, backoff helper. No IDB, no React.

5. **Signer flows from MarmotContext, not from lib.** The signer needed to
   produce a `SignedProfileEvent` is created via `createPrivateKeySigner` in
   `MarmotContext`'s init effect. `serialiseProfileUpdate` accepts a signer
   parameter; lib code never instantiates one.

6. **NDK is accessed via `getNdk()` only.** Runner and context that need NDK
   import from `app/src/lib/ndkClient.ts`.

7. **Static export discipline.** No new dynamic route segments. The
   `pages/groups.tsx` change reuses query-param routing.

8. **Translations.** Any new user-visible string lands in `app/src/lib/i18n.ts`
   for both `en` and `de`. The current spec is wire-format and background-sync
   only and should not introduce new visible strings; if a story finds it
   needs one, surface it for review.

9. **Preserve MIP-03.** Outer MLS application rumor stays unsigned, with
   `pubkey` set to the sender's identity key. The signature lives **inside**
   `rumor.content` as a stringified Nostr kind:0 event with `sig`. Do not add
   a `sig` field to the outer rumor.

10. **Backward compatibility for unsigned profile rumors.** A legacy peer
    sending the previous flat `ProfilePayload` JSON must still be merged.
    `parseProfilePayload` accepts both shapes; legacy-shape profiles result in
    `MemberProfile.signedEvent === undefined` and are non-relayable until the
    peer upgrades.

---

## 4. Seams

Seams are typed contracts between stories. Each seam below has a producer
story and one or more consumer stories; both reference the same contract
shape. Producer/consumer story IDs are two-digit (`01`-`07`) per
`stories.schema.json`.

### Seam 1 — `SignedProfileEvent`

Producer: **story 01** (`wire-format-signed-profile-event`).
Consumers: **stories 02, 03, 06** (and indirectly the verifier via
`mergeMemberProfile`).

```ts
type SignedProfileEvent = {
  id: string;          // sha256 of canonical Nostr serialisation
  pubkey: string;      // hex
  created_at: number;  // unix seconds
  kind: 0;
  tags: string[][];
  content: string;     // JSON-stringified { nickname, avatar, badgeIds, updatedAt }
  sig: string;         // verified via nostr-tools verifyEvent before merge
};
```

Invariants: produced only inside `serialiseProfileUpdate` from a signer
created in `MarmotContext`'s init effect; verified only inside
`parseProfilePayload`; relayed verbatim by the runner without re-sign and
without re-verify (already known-good before caching). Persisted on
`MemberProfile.signedEvent`. A legacy peer's payload (no envelope) yields
`signedEvent === undefined` and is non-relayable.

### Seam 2 — `ProfileRequestMemo` and memo CRUD

Producer: **story 02** (`request-payload-and-memo-store`).
Consumers: **story 03** (records on every observed request),
**story 05** (sweep consults via `shouldEmitRequest`),
**story 06** (no direct consumption — relay path is uncoupled from memo).

```ts
type ProfileRequestMemo = {
  groupId: string;
  targetPubkey: string;
  lastRequestAt: number;          // unix ms
  lastAnsweredAt: number | null;  // unix ms
  attempts: number;               // resets on answer or 7d window expiry
};

// IDB store: 'quizzl-profile-request-memos', keyed by `${groupId}:${targetPubkey}`
loadProfileRequestMemo(groupId: string, targetPubkey: string): Promise<ProfileRequestMemo | null>;
saveProfileRequestMemo(memo: ProfileRequestMemo): Promise<void>;
recordRequestEmitted(groupId: string, targetPubkey: string, now: number): Promise<void>;
recordRequestAnswered(groupId: string, targetPubkey: string, now: number): Promise<void>;
clearProfileRequestMemos(groupId: string): Promise<void>;
```

Invariants: only `groupStorage.ts` (or co-located `profileRequestStorage.ts`)
calls `idb-keyval` for this store; `clearAllGroupData` and `leaveGroup` both
call `clearProfileRequestMemos`.

### Seam 3 — `ProfileRequestPayload` and pure dedupe helpers

Producer: **story 02** (`request-payload-and-memo-store`).
Consumers: **story 03** (parses incoming dispatcher payloads),
**story 05** (constructs outbound payloads, applies dedupe),
**story 06** (consults `pickBackoffMs` for relay scheduling).

```ts
const PROFILE_REQUEST_KIND = 30;

type ProfileRequestPayload = {
  type: 'profile_request';
  targetPubkey: string;
  sinceUpdatedAt?: string;  // ISO; "only respond if newer"
  nonce: string;
};

serialiseProfileRequest(input: { targetPubkey: string; sinceUpdatedAt?: string }): string;
parseProfileRequestPayload(content: string): ProfileRequestPayload | null;
isProfileStale(profile: MemberProfile | undefined, now: number): boolean;
shouldEmitRequest(memo: ProfileRequestMemo | null, now: number): boolean;
pickBackoffMs(): number;  // RELAY_BACKOFF_MIN_MS <= n <= RELAY_BACKOFF_MAX_MS

// Timing constants:
PROFILE_STALENESS_MS    = 7 * 24 * 60 * 60 * 1000;
REQUEST_DEDUPE_MS       = 7 * 24 * 60 * 60 * 1000;
UNANSWERED_RETRY_MS     = 60 * 60 * 1000;
UNANSWERED_MAX_ATTEMPTS = 3;
RELAY_BACKOFF_MIN_MS    = 5_000;
RELAY_BACKOFF_MAX_MS    = 30_000;
```

Invariants: pure module — no `await`, no IDB, no NDK, no React. All call
sites are read-only with respect to the module.

### Seam 4 — `requestProfilesIfStale(groupId)` on context

Producer: **story 05** (`stale-sweep-app-start-and-group-open`).
Consumer: **story 05** (in-story consumer — `pages/groups.tsx`
`GroupDetailView` route-enter `useEffect`).

```ts
// Exposed on the MarmotContext value:
requestProfilesIfStale(groupId: string): Promise<void>;
```

Invariant: idempotent under rapid repeat — internal dedupe via
`shouldEmitRequest` against the memo store.

### Seam 5 — `notifyProfileObserved` cancellation hook

Producer: **story 06** (`relay-on-behalf-with-backoff`).
Consumer: **story 06** (in-story consumer — `MarmotContext`'s
`PROFILE_RUMOR_KIND` arm).

```ts
notifyProfileObserved(input: {
  groupId: string;
  targetPubkey: string;
  observedUpdatedAt: number;
}): void;  // synchronous cancel; runner-owned timer Map keyed by (groupId, targetPubkey)
```

Invariant: the pending-relay timer Map lives only inside
`profileRequestRunner.ts`. No other module reads or mutates it.

---

## 5. Implementation constraints

Drawn from the spec, exploration, and CLAUDE.md.

**Spec line-reference drift.** The spec was written against an older
`MarmotContext.tsx`. Current ground truth (re-grep before editing):

| Spec citation | Current location |
|---|---|
| `MarmotContext.tsx:99` `buildRumor` | line 99 (still accurate) |
| `MarmotContext.tsx:541` kind 0 receiver arm | line 545 |
| `MarmotContext.tsx:672–678` proactive republish on member-add (to remove) | lines 709–716 |
| `MarmotContext.tsx:683–695` `onHistorySynced` introduction (keep) | lines 719–732 |
| `MarmotContext.tsx:893–896` `inviteByNpub` republish (keep) | lines 929–936 |
| `groupStorage.ts:137` `mergeMemberProfile` | line 137 (accurate) |

Architects should re-grep before any patch — line numbers may shift again as
adjacent stories land.

**`serialiseProfileUpdate` becomes async.** Today it is synchronous and
returns a string. After the wire-format upgrade it is `async (profile, signer)
=> Promise<string>`. Every existing caller (`MarmotContext.tsx` lines ~723,
~824, ~930, ~1029 plus the soon-to-be-removed ~710) must `await` and pass the
signer. This is the largest single call-site change in the epic.

**`leaveGroup` is in `MarmotContext.tsx`, not `groupStorage.ts`.** The spec's
file-by-file table attributes the `clearProfileRequestMemos` wire-up to
`groupStorage.ts` only. In reality, `clearAllGroupData` lives in
`groupStorage.ts:182–188` and `leaveGroup` is a `useCallback` inside
`MarmotContext.tsx:954–969`. Both touchpoints must be wired.

**No standalone typecheck or CI.** TypeScript checking happens implicitly via
`next build`. Architects must add `cd app && npm run build` (or `npx tsc
--noEmit`) to story-level validation manually. The repo has no `.github/`.

**Test infrastructure gaps.** The new E2E spec needs three primitives that do
not exist today; one of the stories must produce them as helpers under
`app/tests/e2e/helpers/`:

- A rumor-counting harness — `installRumorCounter(page, kinds)` /
  `getRumorCount(page, kind, direction)`. Implementation idea: `addInitScript`
  that monkey-patches the marmot-ts `onApplicationMessage` callback to bump a
  `window.__rumorCounters` map. Or `exposeFunction` for cleaner accumulation.
- A targeted IDB record-delete helper — `deleteIdbRecord(page, dbName,
  storeName, key)`. Wraps `page.evaluate` opening the named DB and deleting a
  single entry, leaving the rest intact.
- An E2E clock-control helper — Playwright 1.45+ ships `page.clock.install()`
  + `page.clock.fastForward()`. The project is on 1.58, so this is available
  natively. The retry-state-machine scenario uses it; no custom shim needed.

**fast-check** is the project's property-based testing tool of choice
(`skills/languages/javascript-typescript.md`). For the truth-table tests of
`shouldEmitRequest`, parameterised property tests are appropriate; for
`pickBackoffMs`, a property test asserting `RELAY_BACKOFF_MIN_MS <= result <=
RELAY_BACKOFF_MAX_MS` over many invocations is a clean fit.

**Receiver-side dedupe by event id.** Multiple peers may relay the same
cached `SignedProfileEvent`. The IDB merge already does LWW by `updatedAt`;
identical signed events have identical `id`s, so dedupe is implicit — no new
ID-tracking structure needed.

**No proactive scheduled work.** The spec is explicit: no background timers,
no `setInterval`. Triggers are app-start (one `useEffect` after `ready` first
goes true) and group-open (route-enter). The pending-relay `setTimeout` for
backoff is the only timer the epic introduces, and it is keyed and
cancellable.

**Privacy posture.** A profile-request rumor reveals "who I haven't heard from
recently" inside an encrypted MLS group. Acceptable — the group already knows
its membership.

---

## 6. Suggested implementation order (from the spec, validated)

1. Wire-format upgrade in `profileSync.ts` (sign / verify / persist
   `signedEvent`). Verify against existing profile-propagation E2E tests.
2. Memo store and pure helpers in `profileRequestSync.ts` and the new memo
   CRUD in `groupStorage.ts`. No new wire traffic yet.
3. Request rumor + handler: `PROFILE_REQUEST_KIND`, dispatcher arm,
   target-side immediate response.
4. Remove proactive on-join branch.
5. App-start and group-open sweeps; expose `requestProfilesIfStale`.
6. Relay-on-behalf with backoff + cancellation.
7. E2E and unit tests (some land alongside their producing story; the full
   six-scenario E2E can be a final story).

The planner is free to merge or split these into stories, but the order is a
strong default — each step depends on the previous and is independently
verifiable against existing tests.
