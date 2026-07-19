# ADR-011: Returning-user invite links land on the groups page, not a full-screen card

**Status**: Proposed
**Date**: 2026-07-20
**Type**: Lightweight
**Affects**: specs/epic-invite-link-awaiting-landing/, specs/epic-first-visit-invite-welcome/, specs/epic-group-invite-link-onboarding/
**Supersedes**: none
**Superseded by**: none

## Context

`epic-first-visit-invite-welcome` (shipped 2026-07-xx, commit `937fc9e`) deliberately
scoped its full-screen welcome treatment of `/groups/?join=&admin=&name=` to genuine
first-time visitors only (`isFreshIdentity === true`); returning users (an existing
local identity, usually with joined groups already) were left on the older
`<JoinRequestCard>` full-screen takeover inherited from `epic-group-invite-link-onboarding`
(`app/pages/groups.tsx:941` pre-epic). That was a considered decision at the time, not an
oversight — see that epic's DD scoping the welcome screen to fresh identities.

`epic-invite-link-awaiting-landing` (this run, 2026-07-19/20) found that returning-user
behavior actively hostile to product goals: the user's own groups list disappeared, the
post-request state was a bare success alert with nothing underneath, and the pending
group never appeared anywhere until the admin approved (see
`specs/epic-invite-link-awaiting-landing/spec.md` `## Problem`). The epic's own
`## Supersession note (cross-epic)` section names this explicitly and states the reversal
"was authorized by the requester and is a candidate for a short ADR at wrap-up."

The reversal was not risk-free: it silently broke 6 prior-epic e2e specs
(`groups-invite-link`, `groups-join-request-live`, `groups-join-request-profile`,
`groups-approved-requester-label`, `groups-welcome`,
`groups-member-admitted-announcement`) that asserted the old full-screen
`join-request-card` for a pre-seeded-identity (returning) invitee. This was discovered
late — only at the S5 e2e story, not at spec/planning time — and reconciled by updating
those 6 specs' returning-user assertions to expect the new landing (their first-visit
assertions were preserved unchanged). See this epic's retro bundle,
`discrepancies[0]`, for the planning-time miss.

## Decision

A returning user (existing local identity) who opens a group invite link
(`/groups/?join=<nonce>&admin=<npub>&name=<groupName>`) now lands on the normal groups
**list view** — their existing groups, offline/backup banners, pending-invitations
section all intact — with an info banner above the list ("Invited" or "Awaiting" state,
driven by whether an `OutboundJoinRequestRecord` already exists for that nonce) and,
once a request is sent, a dimmed "awaiting" card for the pending group co-located with
their real group cards. The full-screen `<JoinRequestCard>` takeover is retired for the
returning-user branch.

The first-visit branch (`isFreshIdentity === true`) is **unchanged** and continues to
take precedence: genuine first-time visitors still see the full-screen welcome screen
shipped by `epic-first-visit-invite-welcome`. Only the returning-user branch reverses.

This decision is `Status: Proposed` because it was applied autonomously by the project
curator at epic wrap-up per the requester's own note that it "is a candidate for a short
ADR at wrap-up" — the user should flip this to `Accepted` on review.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep the full-screen card for returning users, add only a persistence mechanism (e.g. a toast/notification once approved) | Does not fix the immediate loss-of-context problem (the user's own groups vanish for the entire pending window, which can be days per DD-2's 7-day TTL); does not surface the pending group anywhere in the interim |
| Scope the new banner+card landing to invite links only, leave a *separate* full-screen card path for some other case | No other case remained once the first-visit branch (DD-5) is carved out — the "returning user, invite link" case was the sole full-screen consumer left, so a parallel path would be dead code |

## Consequences

**Positive**: returning users keep their app context (groups list, banners) when
following an invite link; the pending request is now visible and persistent (survives
reload/navigation) instead of vanishing after a single success alert; cancel becomes
possible where it previously was not surfaced at all.

**Negative**: reverses a previously-shipped, deliberate epic decision
(`epic-first-visit-invite-welcome`'s returning-user scoping), which cost this run a late
(S5-stage, not planning-stage) discovery-and-reconciliation pass across 6 prior-epic e2e
specs. Future epics that change a route branch consumed as *setup* by prior e2e specs
should grep those specs for the affected `data-testid`s during planning, not wait for the
e2e gate (see the epic's retro `discrepancies[0]` for the concrete lesson).

**Accepted Risks**: none beyond the e2e-reconciliation cost already paid in this run.
The underlying join-request wire format, event kinds, and gift-wrap channel are
unchanged (see the epic's `## Non-Goals`).

## Evolution Triggers

- If a future epic reintroduces a full-screen invite-landing treatment for returning
  users (e.g. for a different link type), re-examine whether this ADR's "list view
  always wins for returning users" decision should be scoped more narrowly.
- If the outbound-join-request TTL model changes (currently 7 days, DD-2) such that
  "awaiting" state can no longer be represented as a simple persisted record, this
  decision's mechanism (not its landing-page conclusion) should be revisited.

## References

- Origin: curator-promoted via `base:project-curator`, direct via `/base:adr`
- Related ADRs: none
- Related specs: specs/epic-invite-link-awaiting-landing/, specs/epic-first-visit-invite-welcome/, specs/epic-group-invite-link-onboarding/
