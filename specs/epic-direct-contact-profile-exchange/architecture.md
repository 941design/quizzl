# Architecture — Direct-Contact Profile Exchange

Living operational document for the epic. All agents read this before touching code.

## Paradigm

Package-by-feature modular monolith with hexagonal seams at external boundaries
(NDK/relay, idb-keyval, localStorage). The established few-chat convention is a
**pure-core + thin-IO-adapter** split: pure math/predicates take all state as
parameters (no React/NDK/storage import surface), and a same-file adapter wraps
the persistence CRUD. React wiring is a separate always-mounted watcher component
that only calls into the pure/adapter module on lifecycle events. This feature
follows that convention exactly (mirrors `nonceStore.ts` / `pendingIntent.ts`).

## Module map

New feature code lives under `app/src/lib/dmProfile/` (new directory) plus one
new watcher component and small edits to existing chokepoints.

| Module | Location | Purpose | Owns |
|---|---|---|---|
| **kinds/codec** | `app/src/lib/dmProfile/kinds.ts` (new) | `DM_PROFILE_REQUEST_KIND=21061`, `DM_PROFILE_ANNOUNCE_KIND=21062` + module-load sentinel assertion; encode/parse/validate request & announce JSON (reject `avatar:null`/absent as malformed) | The two kind constants, the two message shapes, validation |
| **scheduler** | `app/src/lib/dmProfile/scheduler.ts` (new) | Pure backoff (1h→2h→4h→8h→16h→24h cap, ±20% jitter), due-check, incomplete-set computation (§3.1 rules incl. answered-but-incomplete + malformed handling), clock clamp, 30-day give-up + re-arm; idb-keyval CRUD for the persisted per-contact schedule | The `few-dm-profile-schedule` store, all backoff/state-machine math |
| **send** | `app/src/lib/dmProfile/send.ts` (new) | `sendProfileRequest` / `sendProfileAnnounce` over `sealAndWrap`; answer path runs `ensureAvatar` + stamps `updatedAt`=answer-time | Outbound wrap+publish orchestration |
| **receive/dispatch** | `app/src/lib/dmProfile/receive.ts` (new) | Strict `unwrapAndOpen` dispatch arms: request→gated answer (§3.3), announce→gated store (§3.5) + schedule-clear (§3.2) | The two inbound gates, the neutralized cache-write |
| **cache-write seam** | `app/src/lib/contactCache.ts` (edit) | A neutralized write primitive: land a cache entry that does NOT inject a new contact (no `rememberContact` side effect) and knows whether the LWW write completed | Shared by receive.ts (§3.5) AND the §10.1 fix — land once |
| **watcher** | `app/src/components/ProfileHealWatcher.tsx` (new) + `Layout.tsx` (1-line mount) | Always-mounted: mount/`online`/interval due-sweep (jitter + stagger); owns the dedicated kind-1059 subscription that drives receive.ts's arms | Integration wiring only |
| **push triggers** | `app/pages/profile.tsx` (edit) + pairing admission points | announce-on-change (fan to active contacts on nickname/avatar edit); announce-on-pair (scanner + issuer admission) | Reuses send.ts + receive.ts |
| **§10.1 fix** | `app/src/lib/pairing/pairingAck.ts` (edit) | `importCard(senderHex, decoded.profile)` at admission so the issuer persists the scanner's name | Reuses the cache-write seam |

## Boundary rules

- **No direct imports across module boundaries except through declared seams.**
  The pure scheduler and codec modules MUST NOT import React, NDK, or the
  localStorage/idb adapters of other modules. NDK, keys, and signer are passed
  as explicit params to send/receive (never a singleton), matching
  `pairingAck.ts`.
- **Strict unwrap only.** Every inbound arm uses `directMessages.ts#unwrapAndOpen`.
  `welcomeSubscription.ts#unwrapGiftWrap` is FORBIDDEN for this feature (§4.2 /
  AC-PROF-5). The stored profile is keyed by the authenticated `rumor.pubkey`
  (== `seal.pubkey`), never a rumor-claimed identity.
- **Two-layer gate, both directions.** Disclosure (answer a request, accept an
  announce) requires `isAllowedDmSender(...)` **AND** `archivedAt == null`
  read from the `contacts.ts` store. The archive check is a distinct layer on
  top of `isAllowedDmSender` because `knownPeers` is append-only (ADR-005).
- **No contact injection on receive.** The announce receive path MUST NOT create
  a new `lp_contacts_v1` entry. A not-yet-contact announce is dropped. This is
  the neutralized `writeContactEntry` behavior (§3.5), shared with §10.1.
- **Privacy invariant (hard, from CLAUDE.md).** No public kind-0, no broadcast.
  Every request/announce is a NIP-59 gift wrap addressed to one pubkey. The
  announce is unsigned so a recipient cannot republish it as the sender's
  public kind-0.
- **Pubkey map-keys are case-folded defensively** at every read/write site
  (transitive-lowercase guarantee is not relied on).
- **No collision with the existing group mechanism.** New constants are
  `DM_*`-prefixed; `PROFILE_REQUEST_KIND=30` / `PROFILE_RUMOR_KIND=0`
  (`profileRequestSync.ts` / `profileSync.ts`) are a different transport and
  are left untouched.

## Seams (cross-story contracts)

1. **Codec → send/receive.** `kinds.ts` exports the two constants and
   `encode*/parse*` functions. send.ts and receive.ts depend only on this
   typed surface.
2. **Scheduler ↔ watcher.** scheduler.ts exports pure `computeDue(schedules, nowSec)`,
   `advance(schedule, nowSec)`, `computeIncompleteSet(contacts, cache)`, and the
   idb CRUD. The watcher calls these; it holds no backoff math itself.
3. **Cache-write seam (`contactCache.ts`).** A single neutralized-write function
   (no `rememberContact` injection; returns whether the LWW write landed with a
   non-null avatar) consumed by BOTH receive.ts and the §10.1 fix. This is the
   one deliberately-shared surface — it must land with the receive story and be
   reused by the §10.1 story, not re-implemented.
4. **Dedicated inbound subscription.** The watcher opens `ndk.subscribe({kinds:[GIFT_WRAP_KIND], '#p':[ownPubkeyHex]})` and routes strictly-unwrapped rumors to receive.ts. It does not touch the three existing kind-1059 subscriptions.

## Implementation constraints

- Follow spec §13 order: codec → scheduler → send → receive → watcher → push
  triggers → §10.1 fix → e2e. Module ownership keeps each story independently
  verifiable.
- Unit tests: Vitest under `app/tests/unit/`, no jsdom/@testing-library, no
  fast-check. Backoff/state-machine math tested as annotated parametric sweeps;
  the schedule store tested with `fake-indexeddb/auto` + real idb-keyval.
- E2E specs land in the relay bucket by filename prefix (`dm-*`/`groups-*`).
  The self-heal anchor is `dm-profile-self-heal.spec.ts` (NOT `dm-self-heal*`,
  which exists). Backoff is driven by a `seedDueProfileSchedule` idb hook
  mirroring `helpers/pairing.ts#seedPendingIntent`. Bump the 44/56 e2e tally in
  `CLAUDE.md` and `Makefile` inline comments.
- AC-PROF-9 (no chat bubble / no bell) is satisfied by existing fail-closed
  dispatch — it is TESTS ONLY (proof tests), no source change to
  `directMessageNotifications.ts` / `ContactChat.tsx`. Close the pre-existing
  `contactChat.test.ts` foreign-kind proof-test gap for the two new kinds.
