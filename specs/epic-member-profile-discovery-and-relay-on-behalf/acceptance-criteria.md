# Acceptance Criteria — Member profile discovery and relay-on-behalf

State-change criteria derived from the spec. Each AC names the function/field/component it touches and the resulting observable or internal state change. AC IDs are referenced from `stories.json`.

Spec: `spec.md` · Architecture: `architecture.md` · Exploration: `exploration.json`

## A. Wire-format upgrade — `profileSync.ts`

- **AC-001** — `serialiseProfileUpdate(profile, signer)` is `async`, calls `signer.signEvent` to produce a Nostr kind:0 event whose `content` is the JSON-stringified `{ nickname, avatar, badgeIds, updatedAt }`, and returns the JSON-stringified `SignedProfileEvent` (object with `id`, `pubkey`, `created_at`, `kind: 0`, `tags`, `content`, `sig`).
- **AC-002** — `parseProfilePayload(rumorContent)` parses a `SignedProfileEvent` envelope, calls `verifyEvent` (from `nostr-tools`), and returns a `ProfilePayload` with `signedEvent` populated when verification passes.
- **AC-003** — `parseProfilePayload` returns `null` (or rejects) when the embedded `sig` does not verify; no `ProfilePayload` is produced and no caller-visible profile fields are returned.
- **AC-004** — `parseProfilePayload` accepts a legacy flat `ProfilePayload` JSON (`{ nickname, avatar, badgeIds, updatedAt }` with no envelope) and returns a `ProfilePayload` whose `signedEvent` is `undefined`.
- **AC-005** — `payloadToMemberProfile` threads `signedEvent` (when present) into the returned `MemberProfile`.

## B. Type extensions — `app/src/types/index.ts`

- **AC-006** — `SignedProfileEvent` is exported from `app/src/types/index.ts` with fields `id: string`, `pubkey: string`, `created_at: number`, `kind: 0`, `tags: string[][]`, `content: string`, `sig: string`.
- **AC-007** — `MemberProfile` gains an optional `signedEvent?: SignedProfileEvent` field.

## C. Profile-request rumor — `profileRequestSync.ts` (new)

- **AC-008** — `profileRequestSync.ts` exports `PROFILE_REQUEST_KIND = 30` and a `ProfileRequestPayload` type with fields `type: 'profile_request'`, `targetPubkey: string`, `sinceUpdatedAt?: string`, `nonce: string`.
- **AC-009** — `serialiseProfileRequest({ targetPubkey, sinceUpdatedAt? })` returns a JSON string carrying a fresh random `nonce` (different across two calls with identical other inputs).
- **AC-010** — `parseProfileRequestPayload(content)` returns a typed `ProfileRequestPayload` for valid input and returns `null` for malformed JSON, missing `type`, or missing `targetPubkey`.
- **AC-011** — `profileRequestSync.ts` exports the timing constants `PROFILE_STALENESS_MS = 7 d`, `REQUEST_DEDUPE_MS = 7 d`, `UNANSWERED_RETRY_MS = 1 h`, `UNANSWERED_MAX_ATTEMPTS = 3`, `RELAY_BACKOFF_MIN_MS = 5_000`, `RELAY_BACKOFF_MAX_MS = 30_000`.
- **AC-012** — `isProfileStale(profile, now)` returns `true` when `profile` is `undefined`/`null` or `now - profile.updatedAt >= PROFILE_STALENESS_MS`, else `false`.
- **AC-013** — `pickBackoffMs()` returns a value `>= RELAY_BACKOFF_MIN_MS` and `<= RELAY_BACKOFF_MAX_MS` for every invocation.
- **AC-014** — `shouldEmitRequest(memo, now)` matches the truth table: emit when `memo` is absent OR `now - memo.lastRequestAt > REQUEST_DEDUPE_MS`; skip when `memo.lastAnsweredAt` is within `REQUEST_DEDUPE_MS`; skip when `now - memo.lastRequestAt < UNANSWERED_RETRY_MS`; emit when `UNANSWERED_RETRY_MS <= now - memo.lastRequestAt <= REQUEST_DEDUPE_MS` AND `memo.attempts < UNANSWERED_MAX_ATTEMPTS`; skip when in that window AND `memo.attempts >= UNANSWERED_MAX_ATTEMPTS`.

## D. Memo IDB store — `groupStorage.ts` (or co-located `profileRequestStorage.ts`)

- **AC-015** — A new `idb-keyval` store named `quizzl-profile-request-memos` exists, keyed by `${groupId}:${targetPubkey}`, holding `ProfileRequestMemo` records (`groupId`, `targetPubkey`, `lastRequestAt: number`, `lastAnsweredAt: number | null`, `attempts: number`).
- **AC-016** — `loadProfileRequestMemo(groupId, targetPubkey)` returns the stored memo or `null`.
- **AC-017** — `saveProfileRequestMemo(memo)` writes the record verbatim and is observable via a subsequent `loadProfileRequestMemo`.
- **AC-018** — `recordRequestEmitted(groupId, targetPubkey, now)` upserts a memo: if absent, sets `attempts = 1`, `lastRequestAt = now`, `lastAnsweredAt = null`; if present and `now - prev.lastRequestAt > REQUEST_DEDUPE_MS`, resets `attempts = 1`; otherwise increments `attempts` and sets `lastRequestAt = now`.
- **AC-019** — `recordRequestAnswered(groupId, targetPubkey, now)` upserts a memo with `lastAnsweredAt = now` and `attempts = 0`.
- **AC-020** — `clearProfileRequestMemos(groupId)` deletes every memo whose key starts with `${groupId}:`.
- **AC-021** — `mergeMemberProfile` persists `signedEvent` alongside parsed fields when the incoming `MemberProfile` carries one; LWW by `updatedAt` is preserved.
- **AC-022** — `clearAllGroupData(groupId)` calls `clearProfileRequestMemos(groupId)` so memo records for the group are removed.

## E. App-start sweep effect — `MarmotContext.tsx`

- **AC-023** — A `useEffect` in `MarmotContext` runs `sweepStaleProfiles` exactly once after `ready === true`, `groups.length > 0`, and `pubkeyHex` is set; it does not re-run on subsequent re-renders unless those gating values change.
- **AC-024** — `sweepStaleProfiles` walks every group's MLS member list, skips `selfPubkeyHex`, and for each member whose stored `MemberProfile` is missing or stale (per `isProfileStale`) AND for which `shouldEmitRequest(memo, now)` returns `true`, emits exactly one `PROFILE_REQUEST_KIND` rumor and calls `recordRequestEmitted`.

## F. Group-open sweep — `MarmotContext.tsx` and `pages/groups.tsx`

- **AC-025** — `MarmotContext`'s context value exposes `requestProfilesIfStale(groupId: string): Promise<void>`, scoped to a single group's stale members and using the same dedupe predicate.
- **AC-026** — `GroupDetailView` in `pages/groups.tsx`, inside its existing route-enter `useEffect`, calls `requestProfilesIfStale(id)` after the group is set; navigating into a group with stale members triggers exactly one request per stale member (modulo dedupe).

## G. Removal of proactive on-member-add republish

- **AC-027** — The `if (currentMembers.length > prevMemberCount)` block in `MarmotContext.tsx` (current lines 709–716) is removed; growing the member count no longer triggers a profile rumor send.
- **AC-028** — `onHistorySynced` introduction (current lines 719–732) is preserved — newcomers still introduce themselves once after first history sync.
- **AC-029** — `inviteByNpub` republish (current lines 929–936) is preserved — the inviter still pushes their profile on invite.

## H. Target-side immediate response — `MarmotContext.tsx`

- **AC-030** — A new dispatcher arm in `onApplicationMessage` handles `PROFILE_REQUEST_KIND`: it calls `parseProfileRequestPayload`, and when `payload.targetPubkey === selfPubkeyHex`, signs a fresh `SignedProfileEvent` from the local profile and sends a profile rumor with no backoff via `sendRumorSafe`.
- **AC-031** — When an incoming request's `targetPubkey` is not self, the dispatcher delegates to `handleIncomingProfileRequest` and does not directly send a profile rumor for self.
- **AC-032** — Every incoming `PROFILE_REQUEST_KIND` rumor — regardless of target — calls `recordRequestEmitted` so peer-issued requests dedupe across the group.

## I. Peer relay-on-behalf with backoff and cancellation — `profileRequestRunner.ts`

- **AC-033** — `handleIncomingProfileRequest({ groupId, payload, now, sendRumor })` loads the cached `MemberProfile` for `payload.targetPubkey`; if `signedEvent` is cached AND (`payload.sinceUpdatedAt` is absent OR cached `updatedAt > payload.sinceUpdatedAt`), it schedules a `setTimeout(pickBackoffMs())` keyed by `(groupId, targetPubkey)` in a module-level `Map`.
- **AC-034** — When the scheduled timer fires, the runner invokes the supplied `sendRumor` callback with the cached `signedEvent` verbatim (no re-sign, no re-verify) wrapped in a `PROFILE_RUMOR_KIND` rumor.
- **AC-035** — `notifyProfileObserved({ groupId, targetPubkey, observedUpdatedAt })` clears the pending timer for `(groupId, targetPubkey)` when `observedUpdatedAt >= scheduledForUpdatedAt`, so a faster peer's response cancels our relay.
- **AC-036** — `MarmotContext`'s `PROFILE_RUMOR_KIND` arm calls `notifyProfileObserved` for every successfully verified incoming profile, including ones the user themselves emits.
- **AC-037** — `handleIncomingProfileRequest` does not schedule a relay when no `signedEvent` is cached for the target (legacy-only profiles are non-relayable).
- **AC-038** — `handleIncomingProfileRequest` does not schedule a relay when `payload.sinceUpdatedAt` is present and `>=` the cached `updatedAt` (the requester already has something at least as fresh).

## J. Receiver-side dedupe and merge

- **AC-039** — When two peers' relays land for the same target, the second `mergeMemberProfile` call is a no-op (LWW by `updatedAt`); both rumors have identical `SignedProfileEvent.id` so this is observable as zero net IDB writes for the duplicate.
- **AC-040** — A profile rumor whose embedded `SignedProfileEvent.sig` does not verify is dropped before `mergeMemberProfile`; no IDB write occurs and the cross-group contact cache (`lp_contactCache_v1`) is not updated.

## K. `leaveGroup` cleanup — `MarmotContext.tsx`

- **AC-041** — `leaveGroup(groupId)` (the `useCallback` in `MarmotContext.tsx`) calls `clearProfileRequestMemos(groupId)` so memo records for the group are removed when the user leaves.

## L. Existing call-site updates for async `serialiseProfileUpdate`

- **AC-042** — Every existing caller of `serialiseProfileUpdate` in `MarmotContext.tsx` (`onHistorySynced` introduction, `inviteByNpub` republish, `publishProfileUpdate`, and any other extant call site) `await`s it and passes the in-context signer; the build (`next build`) succeeds without type errors.

## M. E2E and unit verification

- **AC-043** — Unit test `app/tests/unit/profileRequestSync.test.ts` covers `isProfileStale` boundaries, the full `shouldEmitRequest` truth table (parameterised, ideally fast-check), and `pickBackoffMs` range (property test).
- **AC-044** — Unit test for `profileSync.ts` exercises a sign/verify round trip and a legacy-fallback parse (no envelope).
- **AC-045** — E2E spec `app/tests/e2e/groups-profile-request.spec.ts` includes the six scenarios from the spec's Verification section: aged-history backfill (target online), periodic refresh (8 d shift), per-peer dedupe (rumor counts), relay-on-behalf with target offline, retry state machine (1 h / 7 d / 3 attempts boundaries), and forged-sig rejection.
- **AC-046** — E2E helpers `installRumorCounter(page, kinds)` / `getRumorCount(page, kind, direction)`, `deleteIdbRecord(page, dbName, storeName, key)` exist under `app/tests/e2e/helpers/` and are used by the new spec.

## N. Author-identity binding (added in story 01 round 2)

- **AC-047** — `payloadToMemberProfile` MUST key the resulting `MemberProfile.pubkeyHex` from `payload.signedEvent.pubkey` when present; the caller-supplied `fallbackPubkeyHex` parameter is used only when `signedEvent` is absent (legacy unsigned payloads). The `MarmotContext.tsx` `PROFILE_RUMOR_KIND` dispatcher arm MUST drop the rumor (no IDB write, no contact-cache update, no score-nickname update) when `signedEvent` is present and `signedEvent.pubkey !== rumor.pubkey` (outer MLS sender). This protects the relay-on-behalf seam (story 06) from silent identity confusion and rejects first-hand rumors that wrap another author's signed profile.
