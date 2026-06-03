# ADR-001: Gate DM reachability exclusively on live MLS group membership

**Status**: Proposed
**Date**: 2026-06-03
**Type**: Lightweight
**Affects**: specs/epic-dm-walled-garden/, app/src/lib/walledGarden.ts, app/src/components/contacts/ContactChat.tsx, app/src/lib/directMessageNotifications.ts, app/src/context/MarmotContext.tsx
**Supersedes**: none
**Superseded by**: none

## Context

Quizzl is a walled-garden product: a user should only be reachable by
people they share a learning group with. Prior to the DM Walled Garden
epic (2026-06-03), arbitrary Nostr pubkeys could deliver direct messages
to a Quizzl client and have them stored in IndexedDB, counted on the
notification bell, and promoted to the contact list. This was not
intentional — it was a gap in the original DM ingestion implementation.

The gap caused a production maintenance window. The live site was
replaced with a maintenance page until the invariant was enforced.

The decision that emerged from that forced fix is load-bearing: it
defines what "reachable" means in the Quizzl product model, and it
constrains every future inbound-event path (current and not-yet-written).

Key facts about the implementation at `app/src/lib/walledGarden.ts`:
- `isAllowedDmSender(peerHex, groups, ownPubkeyHex)` is a pure function
  with no IDB, NDK, or React dependencies. The whitelist is the union of
  `group.memberPubkeys` across joined MLS groups, minus the user's own
  pubkey.
- Four inbound handlers in `ContactChat.tsx` gate on this function
  before any `appendMessage` or `upsertMessages` call.
- Both handlers in `directMessageNotifications.ts` (kind-4 and
  kind-1059) gate before `rememberContact`, `incrementDirectMessage`, and
  dedup-set insertion.
- `rememberContact` in `contacts.ts` is itself gated as defense-in-depth.
- A retroactive purge sweep runs on boot (after group hydration) and on
  every group-membership change, removing IDB threads, unread counters,
  contact-list entries, and reaction state for now-stranger peers.

AC-SEC-8 in `specs/epic-dm-walled-garden/acceptance-criteria.md` codifies
the standing rule: there MUST NOT be a third inbound DM path that is not
gated. Any future NIP or handler that ingests DM-like events falls under
this ADR.

## Decision

The whitelist for DM reachability is defined as: the union of
`group.memberPubkeys` across all MLS groups the local user is currently
a member of, excluding the user's own pubkey. A peer is "allowed" if and
only if they appear in this set at the moment of evaluation.

Every inbound DM path — current and future — MUST gate on
`isAllowedDmSender` before any side effect (IDB append, bell increment,
contact write, reaction storage). The gate runs after cryptographic
verification (NIP-59 unwrap / seal authentication) but before all
storage. No path may skip the gate based on message content, event kind,
or caller identity.

The whitelist is live: it is computed from the in-process group snapshot
at the time of each event, not cached. Joining a group instantly extends
reach; leaving or being kicked instantly revokes it.

The whitelist source is exclusively MLS group membership. No NIP-02
follow lists, no reputation scores, no manual allowlist UI, and no
pre-admission (pending join request) state counts toward reachability.

When a peer's reachability is revoked (they leave or are kicked from all
shared groups), their existing DM thread, unread counters, reaction
aggregates, and contact-list entry are deleted by the next purge sweep.
History is not preserved for now-stranger peers ("keep history, block
new" was explicitly rejected — see Alternatives).

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep history, block new messages from ex-members | Creates a UX class of "ghost contacts" whose provenance and trust state is ambiguous. The product invariant is "no contact outside the walled garden" — historical contact with a now-stranger is the same outcome and handled the same way. (DD-4, spec.md) |
| Lenient purge — mark stranger threads read-only | Leaves the original leak visible to users and contradicts the bug report wording ("must not even be stored", "already fetched messages must be removed"). (DD-5, spec.md) |
| Relay-side filtering | Relays are untrusted. The client is the enforcement boundary. Relay-side filtering would require trusting relay operators and does not protect against relay-operator bypass. (AC-SEC-11) |
| Pre-admission reachability (pending join requests) | Pre-admission contact is the exact attack surface the walled garden exists to close. A pubkey becomes reachable only after their MLS Welcome has been processed and they appear in `group.memberPubkeys`. (DD-2, spec.md) |
| NIP-02 follow-list as supplementary allow source | Follow lists are not managed by Quizzl and can be manipulated externally. Adding them as a reachability source would bypass the MLS-group enforcement boundary. |

## Consequences

**Positive**: The walled-garden invariant is enforced at a single
chokepoint (`isAllowedDmSender` in `walledGarden.ts`). Future DM paths
added by any contributor MUST gate on this function — the AC-SEC-8 rule
and this ADR make the invariant explicit and traceable. The pure-function
design makes the rule trivially unit-testable and reusable from any
call site (watcher, ChatUI, purge sweep, `rememberContact`).

**Negative**: Purge sweep runs on every group-membership change event,
including frequent ones (add-member, remove-member commits). On a
hydrated client with many DM threads this adds wall-clock cost (bounded
at ≤500 ms for ≤200 threads, AC-PERF-1). Leaving or being kicked from
all shared groups with a peer permanently deletes the DM history with no
undo — this is intentional but irreversible.

**Accepted Risks**: The membership check is only as fresh as the local
`group.memberPubkeys` snapshot. A member who is removed but whose Remove
commit has not yet been processed locally remains briefly in the
whitelist. This is accepted (DD-3) to avoid divergence between "who can
reach me" and "who do I think is a member."

## Evolution Triggers

Conditions under which this ADR should be reopened:

- A future NIP introduces a DM-like event kind that the current
  `isAllowedDmSender` signature cannot gate (e.g. a new multi-party
  inbox protocol where sender pubkey is not the `pubkey` field).
- The product adds a concept of "direct connection" outside of MLS
  groups (e.g. a one-to-one non-group contact flow), requiring a
  supplementary reachability source.
- The MLS group model is replaced or supplemented with a different
  membership primitive, making `group.memberPubkeys` no longer the
  canonical membership source.

## References

- Origin: curator-promoted from DM Walled Garden epic post-ship review (direct via `/base:adr`)
- Related ADRs: none
- Related specs: specs/epic-dm-walled-garden/
