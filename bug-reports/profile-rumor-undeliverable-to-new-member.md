# Bug: PROFILE_RUMOR_KIND from one peer never reaches a newly-joined member

**Date:** 2026-05-10
**Severity:** Medium-High — directly visible UX (newly-joined group members see truncated npubs instead of nicknames for one of the existing members, randomly).
**Surfaced by:** `app/tests/e2e/groups-member-profiles.spec.ts:170` (`A invites C — C sees both Alice and Bob profiles`).
**Status:** Test marked `test.fixme` pending root-cause investigation. The test currently fails on ~33–60% of runs.

## Summary

When user A invites a new user C into an existing 2-member group {A, B}, C is supposed to end up with both A's and B's profiles. The post-b58b21e flow relies on:

1. A's `inviteByNpub` republish: A re-sends her profile rumor immediately after publishing the invite commit. C should pick this up via historical fetch + dispatcher.
2. B's `onHistorySynced` republish on re-subscribe: when C joining causes B's `groups` state to change, B's subscribe useEffect re-runs, clears `profilePublishedRef`, and B re-publishes via `onHistorySynced`. C should pick this up via live sub.
3. C's `requestProfilesIfStale(groupId)` (AC-026): when C clicks into the group, C emits `PROFILE_REQUEST_KIND` for any stale member. A and B reply via `sendSelfProfile` (direct path, AC-030) or via `handleIncomingProfileRequest` (relay-on-behalf, AC-031/033).

In practice, **one of A or B's profile rumors never reaches C's `applicationRumorDispatcher` listener**, even after waiting 60 s. Which peer is missing varies between runs; the failing pattern is approximately 33 % when `strfry` is fresh, climbing to ~60–70 % when its database has accumulated state from prior runs.

## Evidence

Per-page dispatcher events captured by adding a `console.log` inside `applicationRumorDispatcher.ts`'s listener (one log per successfully-decrypted application rumor):

**Failing run, fresh strfry:**

```
[pgB]  kind=0  sender=784fa7dd  rumorId=...   ← B receives A's profile (multiple times due to re-subscribe thrash)
[pgA]  kind=0  sender=ae24e4dc  rumorId=...   ← A receives B's profile
[pgA]  kind=0  sender=b009d506  rumorId=...   ← A receives C's profile
[pgB]  kind=0  sender=b009d506  rumorId=...   ← B receives C's profile
[pgC]  kind=0  sender=784fa7dd  rumorId=...   ← C receives A's profile
                                                                ← NO event for C receiving B's profile
```

C's IDB has Alice's `MemberProfile` row, no Bob row. C's profile-request memos show
`Bob: lastAnsweredAt=null, attempts=1` — C did emit the request, never got the reply.

A's and B's `applicationRumorDispatcher` listener does fire for C's `PROFILE_REQUEST_KIND` rumor (we see `[DIAG-PROFREQ] handle ... target=ae24e4dc` on B), and B does enter the `sendSelfProfile` path (we see `[DIAG-SELF-PROFILE] publishing` followed by `published OK`). The rumor is published. It just never reaches C's dispatcher.

Symmetric variant: in other failing runs, **A's** profile is missing on C and B's is present, with the same shape — C never sees A's PROFILE_RUMOR_KIND in the dispatcher even though A clearly publishes it (logs from `[DIAG-INVITER] publishing republish profile rumor`, `[DIAG-INVITER] republish OK`, plus the `sendSelfProfile` reply, plus the `onHistorySynced` republish).

## What we ruled out

- **Test timeout too short.** Bumping the assertion timeout from 30 s to 60 s did NOT fix it (4 of 6 runs still failed). So this is not the relay-on-behalf 5–30 s `pickBackoffMs` window biting the test budget — even the relay path's reply doesn't reach C.
- **`closeOnEose` gap in `subscribeToGroupMessages`.** Both the historical-fetch sub and the subsequent live sub use the same NDK pool; events emitted into the gap should be queued by the relay and delivered to the live sub. Confirmed via the dispatcher logs showing live events for the OTHER peer arriving fine.
- **`futureBuffer` failing to flush.** With raw EpochResolver instrumentation, every page processes 8–15 unreadable events to `futureBuffer`. Many are cross-test ghosts from strfry that never become readable (different MLS group). But that does not explain the same-test missing rumor — A and B's deliveries to each other go through the dispatcher fine, ruling out a generic flush failure on the missing peer's path.
- **Inviter republish failing silently.** `[DIAG-INVITER] republish OK` logs every run, including failing ones. The publish goes out. It just doesn't reach C decryptable.

## Strongest remaining hypothesis: per-leaf ratchet desync

ts-mls advances the sender's leaf ratchet (`gen`) on every application message. The recipient must process messages from each leaf in order (or in a sliding window if ts-mls supports one) — otherwise `processMessage` throws `desired gen in the past` (or its future-gen analogue) and the EpochResolver buffers the event, where it sits indefinitely because `flushFutureBuffer` is only invoked from `handleCommit` and there's no further commit to advance things.

Two amplifying factors:

1. **Subscription thrash.** `MarmotContext.tsx:555`'s subscribe-effect dependency list includes `groups`, so every memberPubkeys change (e.g. after a commit lands and `onMembersChanged` fires) tears down all dispatcher subscriptions and re-creates them. Each re-creation clears `profilePublishedRef`, triggering another `onHistorySynced` republish from each peer. So during the C-joins window, A and B each emit 2–3 PROFILE_RUMOR_KIND application messages in quick succession. Each one advances their leaf ratchet by 1.
2. **C's MLS state.** C joins via Welcome at the post-add-C epoch. The admin-promotion commit (also published by A immediately after the invite) advances the epoch one more step. Until C ingests the admin commit, any application message published at the post-admin epoch is unreadable for C. After ingesting the admin commit, the buffer is flushed — but if the rumors were buffered out-of-order relative to the sender's ratchet, the flush retry can still fail.

The asymmetry between Alice and Bob (one of them works, the other doesn't, randomly) is consistent with this: which peer survives depends on the order their burst of application messages happens to land at C relative to C's commit-ingest progression.

## What this hypothesis predicts

If this is right, instrumenting ts-mls's `processMessage` in `EpochResolver` to log the actual exception type and `(epoch, leaf, gen)` should show a deterministic mismatch on the missing peer's events that never resolves across the 60 s window. The relay-on-behalf reply also fails because it's encrypted at the same epoch by a peer whose ratchet C cannot follow.

## What I haven't confirmed

- Whether ts-mls supports out-of-order generations within an epoch (sliding-window decryption). If it does, the hypothesis is wrong.
- Whether the missing rumor is reaching C's NDK subscription at all (would need WebSocket frame logging to disprove a network-layer drop).
- Whether `flushFutureBuffer` ever attempts to retry the missing rumor after the admin-commit ingestion. (No instrumentation on this code path during the failing window since adding logs slowed things into total failure.)

## Suggested next steps for whoever picks this up

1. Add structured logging in `EpochResolver.processEvent` and `flushFutureBuffer` that records `(eventId, epoch, sender-leaf, sender-gen, error-message)` for unreadable events, gated by a flag so it doesn't fire in production. Run the failing test once and read the logs for the missing peer's events.
2. If the events are reaching ingest and failing with a gen-related error, check ts-mls behaviour on out-of-order generations. If ts-mls supports a window but the resolver isn't flushing aggressively enough, fix the resolver (e.g. flush after every successful application-message processing too).
3. Decouple the dispatcher subscription from the `groups`-array dependency in `MarmotContext.tsx:555`. Re-subscribing the entire group every time memberPubkeys updates is wasteful and amplifies the ratchet-drift surface area.
4. Once the underlying flake is fixed, re-enable the test (drop the `test.fixme` and remove this report's pointer).

## Related

- 2026-05-08 e2e iteration report § B3 (profile-request retry attempts stuck at 0) — likely the same class of flake on a different test surface.
- `specs/epic-member-profile-discovery-and-relay-on-behalf/` — the epic that introduced the request/response + relay-on-behalf flow this test exercises.
- Commit `b58b21e` (feat(profile): request/response + relay-on-behalf profile discovery) — replaced the proactive republish-on-member-add code; the orphaned comment block at `MarmotContext.tsx:619-624` is the leftover from that deletion.
