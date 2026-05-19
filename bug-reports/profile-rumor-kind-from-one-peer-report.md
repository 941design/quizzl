# Bug: PROFILE_RUMOR_KIND from One Peer Never Reaches Newly-Joined Member

## Bug Description

When user C joins an existing 2-member group {A, B}, one of A or B's `PROFILE_RUMOR_KIND`
events fails to reach C's `applicationRumorDispatcher` listener on ~33–60% of runs. The
group-member-profiles e2e test (`A invites C — C sees both Alice and Bob profiles`) is
marked `test.fixme` pending root-cause diagnosis and fix.

Source: BACKLOG.json finding `profile-rumor-kind-from-one-peer` promoted 2026-05-18.
See also: `bug-reports/profile-rumor-undeliverable-to-new-member.md` (full investigation
history including ruled-out hypotheses).

## Expected Behavior

After C joins the group and navigates to the group detail view, C should see both Alice's
and Bob's nicknames/avatars in the member list (not truncated npubs). The profiles are
delivered as `PROFILE_RUMOR_KIND` (kind 0) application rumors over MLS-encrypted kind-445
events.

## Actual Behavior

C sees one peer's profile correctly but the other peer's profile is missing. Which peer is
missing varies between runs (~50/50 split). C's IDB shows `lastAnsweredAt=null, attempts=1`
for the missing peer — C emitted the profile request but never received a reply. Even
waiting 60 seconds does not resolve it; the reply is published ("published OK" in logs) but
never reaches C's dispatcher.

## Root Cause (from code exploration)

`subscribeToGroupMessages` in `welcomeSubscription.ts` uses a two-phase subscription
pattern:

**Phase 1** — `fetchEventsWithTimeout(filter, { closeOnEose: true })`: collects all
historical kind-445 events from the relay, processes them in `created_at` order, then
returns when strfry sends EOSE.

**Phase 2** — `ndk.subscribe(filter, { closeOnEose: false })`: opens the live subscription
for future events.

There is a gap between Phase-1 EOSE and Phase-2 WebSocket registration. During this gap,
kind-445 events published on the relay are **silently lost** — they are not in the Phase-1
result set (historical fetch already completed) and the live sub does not yet exist to
receive them.

This gap is hit by A's profile rumor: in `inviteByNpub` (MarmotContext.tsx:1115–1119),
A publishes the profile rumor **synchronously** immediately after the admin-promotion
commit, right when C is most likely executing the Phase-1→Phase-2 transition of its
subscription setup. B's profile rumor is published later (after B's full `onHistorySynced`
re-subscribe cycle, hundreds of milliseconds later), which may or may not fall in the
same gap.

The bug report (undeliverable-to-new-member.md) incorrectly classified the subscription
gap as "ruled out" because "live events for the OTHER peer arriving fine" — but the other
peer's events arrive later precisely because they are deferred to `onHistorySynced`,
masking that both paths can hit the gap at different probabilities.

## Reproduction Steps

1. Three users: Alice (admin), Bob (member), Carol (new invitee).
2. Alice creates a group, invites Bob. Bob joins. Wait 10 seconds for profile exchange.
3. Alice invites Carol. Carol joins.
4. Carol navigates to the group detail view.
5. On ~33–60% of runs, Carol sees a truncated npub instead of a nickname for Alice or Bob.

The e2e test at `app/tests/e2e/groups-member-profiles.spec.ts:175` reproduces this.

## Impact

**Severity**: Medium-High. Directly visible UX regression: new group members see truncated
npubs instead of nicknames for one of the existing members, randomly. Severity is capped at
medium because the profile eventually becomes visible when a subsequent profile exchange
occurs (e.g., when the missing peer sends a chat message).

## Fix Target

`app/src/lib/marmot/welcomeSubscription.ts` — `subscribeToGroupMessages` function.

Add a `since` filter to the Phase-2 live subscription covering the Phase-1 start
timestamp. This ensures the relay replays any events published in the Phase-1→Phase-2 gap.

The Phase-1 `processedIds` dedup set (line 206) ensures double-delivered events from the
overlap window are not processed twice.

## What Has Been Ruled Out

See `bug-reports/profile-rumor-undeliverable-to-new-member.md` for full history:
- Timeout too short (60s still fails)
- futureBuffer not flushing (flush-on-app-msg retry added, no improvement)
- Inviter republish silently failing (logs confirm "published OK")
- MLS epoch mismatch on the published rumor (both A/B publish at correct epoch N+2)
- Asymmetric filter in dispatcher or profileHandler (no peer-specific filter exists)
