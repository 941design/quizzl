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
- **`futureBuffer` failing to flush — STRONGER REFUTATION.** Originally suspected the buffer was sitting on the missing rumor between commits. As of 2026-05-10, `EpochResolver.processEvent` was changed to call `flushFutureBuffer()` after every successfully-processed application message (in addition to commits) so any out-of-order rumor that becomes readable mid-batch gets retried immediately. **8-run sample after that change: 5 failed, 3 passed — same flake rate.** So the missing rumor is not sitting in `futureBuffer` at all; the additional flush is harmless but irrelevant to this bug.
- **Inviter republish failing silently.** `[DIAG-INVITER] republish OK` logs every run, including failing ones. The publish goes out. It just doesn't reach C decryptable.

## Updated hypothesis (2026-05-10): the rumor isn't reaching ingest at all

Now that the futureBuffer angle has been ruled out empirically, the failure has to live upstream of `EpochResolver.processEvent`. Two candidates remain:

1. **NDK subscription gap or filter mismatch on C.** The kind-445 event for the missing peer's profile is published by A or B, lands on strfry, but never reaches C's `subscribeToGroupMessages` live sub. Possible mechanisms: the relay's per-subscription bookkeeping treats the historical-fetch close + live-sub open as separate sessions and drops events that arrived in the millisecond window between, OR NDK's internal subscription manager loses an event due to the `closeOnEose: true` historical fetch tearing down before the live sub has registered. Symptom would match: A and B's *other* events still reach C (because they happen later, well within the live-sub window), but the burst published right after invite/republish slips through. Worth checking with raw WebSocket frame logging on C's page.
2. **MLS-level epoch divergence on C that isn't recovered.** C's Welcome encodes state at the add-C commit. A then publishes the admin-promotion commit and her profile rumor at the post-admin epoch. If C's historical fetch returns the events out of created_at order (or strfry returns them with collisions in created_at), C might attempt to ingest the profile rumor before the admin commit, fail, buffer it — and the just-added flush-on-app-msg retry doesn't help because the *commit* never gets processed either (lost in the same gap as candidate 1).

The earlier per-leaf ratchet hypothesis is still possible but loses force given that flush-on-app-msg didn't move the needle.

## What I haven't confirmed

- Whether the missing rumor is reaching C's NDK subscription at all (would need WebSocket frame logging on C — `page.on('websocket')` + `ws.on('framereceived')` — to count kind-445 frames vs. dispatcher fires).
- Whether the relay actually has the missing event when C asks for it (would need a direct strfry query mid-test, e.g. `nak req -k 445 wss://...` from inside the docker network).
- Whether ts-mls would reject the rumor with a specific error (would need instrumentation around `mlsGroup.ingest()` to surface the thrown error per-event).

## Suggested next steps for whoever picks this up

1. **Confirm whether the rumor reaches C.** On the page where C runs, attach a `page.on('websocket')` listener and count incoming kind-445 frames during the failing window. Compare with dispatcher fires. If frame count > dispatcher fire count, the gap is in NDK→ingest. If frame count == dispatcher fire count (and excludes the missing rumor), the gap is on the wire.
2. **Cross-check on the relay.** Spawn a parallel `nak req -k 445 -t h=<groupIdHex> wss://localhost:7777` against strfry while the test is running. Confirms whether the missing rumor was actually published.
3. **Decouple the dispatcher subscription from the `groups`-array dependency in `MarmotContext.tsx:555`** regardless of the eventual fix. Re-subscribing the entire group every time `memberPubkeys` changes triggers redundant historical fetches and re-publishes; even if it's not the proximate cause here, it's a clear correctness/perf liability that magnifies any underlying fragility.
4. **Once the underlying flake is fixed**, re-enable the test (drop the `test.fixme` and remove this report's pointer).

## Related

- 2026-05-08 e2e iteration report § B3 (profile-request retry attempts stuck at 0) — likely the same class of flake on a different test surface.
- `specs/epic-member-profile-discovery-and-relay-on-behalf/` — the epic that introduced the request/response + relay-on-behalf flow this test exercises.
- Commit `b58b21e` (feat(profile): request/response + relay-on-behalf profile discovery) — replaced the proactive republish-on-member-add code. The leftover orphan comment in `MarmotContext.tsx` was cleaned up in the same commit that landed the flush-on-app-msg retry.
- `EpochResolver.processEvent` flush-on-app-msg retry was added 2026-05-10 in the course of investigating this bug. It's a defensible correctness improvement (any rumor that *can* become readable after a ratchet step now gets retried immediately) but does not measurably affect this flake.
