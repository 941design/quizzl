# ADR-002: Mutual contact graph and pull-only invitations

**Status**: Proposed
**Date**: 2026-06-03
**Type**: Lightweight
**Affects**: app/src/lib/knownPeers.ts, app/src/lib/walledGarden.ts, app/src/context/MarmotContext.tsx, app/src/components/contacts/ContactChat.tsx, app/src/components/DirectMessageNotificationsWatcher.tsx, app/src/lib/contacts.ts, app/src/lib/unreadStore.ts, app/src/lib/marmot/chatPersistence.ts, app/src/lib/reactions/api.ts
**Supersedes**: ADR-001

## Context

ADR-001 established the walled-garden invariant: DM reachability is gated exclusively on live MLS group membership. A peer is allowed if and only if they appear in `group.memberPubkeys` at the moment of evaluation.

This strict live-only rule has a correctness problem: when two users (Alice and Bob) have shared a group, and one of them (Alice) leaves or is kicked from that group, the DM history between them is immediately deleted from both sides by the next purge sweep. Bob cannot receive any further DMs from Alice until they share another group. This is maximally safe but too aggressive in one edge case: a user who was legitimately part of the walled garden at some point in the past should not become completely unreachable the moment they leave.

There is also a forward-looking concern: the Walled Garden v2 epic introduces the concept of pull-only invitations (Story S2), where a Welcome must be explicitly accepted by the local user before the sender becomes reachable. This requires the whitelist to remember who was ever a co-member, not only who is a co-member right now, so that the invitation flow has a sound trust basis.

Key observations:
- The threat model is external strangers arriving with unsolicited DMs. A peer who was already a co-member was already admitted to the walled garden; their membership status at any future moment is less relevant to the threat model.
- "I shared a group with this person" is a meaningful trust signal even after the group disbands.
- Adding an ever-known set is append-only and thus cannot introduce false-allow paths by mistake (a peer cannot be removed from knownPeers by any app action).

## Decision

The whitelist for DM reachability is expanded from live-only group membership to:

> **whitelist = current MLS member set ∪ ever-known peers set**

where "ever-known peers" means: any peer whose hex pubkey appeared in `group.memberPubkeys` of a group the local user was a member of, at any time since the installation of this update.

The ever-known set is persisted in `localStorage['lp_knownPeers_v1']` as a JSON array of lowercase hex pubkeys. It is:
- **Append-only**: entries are added on every group-membership change; no app action removes entries.
- **Pure**: the set is read synchronously from localStorage into a `ReadonlySet<string>` that is passed as a parameter to `isAllowedDmSender`. The whitelist function itself remains pure.
- **Maintained**: `MarmotContext` runs a `useEffect` on `[groups, pubkeyHex]` that calls `rememberKnownPeers` with the union of all current `group.memberPubkeys` (excluding own pubkey). This fires after boot and on every group-membership change.

The purge sweep (AC-PURGE-1, AC-PURGE-2) continues to run on every group-membership change, but now uses the extended whitelist: a peer is a stranger only if they appear in neither the current group set nor the ever-known set.

### Pull-only invitations (Welcomes require user consent)

A Welcome from another user does NOT automatically add them to the whitelist. The Welcome must be accepted by the local user (or auto-accepted under a configured policy). Only after the Welcome is processed and the peer appears in `group.memberPubkeys` does `MarmotContext`'s maintenance effect add them to `lp_knownPeers_v1`. This closes the pre-admission attack surface: receiving a Welcome does not make the sender reachable.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep ADR-001 (live-only) | Correct but too aggressive: ex-members whose groups disbanded lose DM reachability even though they were legitimately admitted. Creates surprising UX when groups are temporary (study-session-scoped groups). |
| Read-only threads for ex-members (keep history, block new) | Already rejected in ADR-001 — creates ghost contacts with ambiguous trust state. The ever-known-peer approach avoids this by continuing to allow new DMs from known-good peers. |
| NIP-02 follow-list as trust source | Still rejected — follow lists are not Nostling-managed and can be manipulated externally. |
| Per-group contact lists (allow only while group is live) | Equivalent to ADR-001 but more complex. Provides no additional safety benefit over live-only membership while incurring the same UX cost. |
| Auto-accept all Welcomes immediately | Widens the pre-admission attack surface — anyone who can craft a Welcome event could become reachable. Rejected for security. |

## Consequences

**Positive**:
- Ex-members remain reachable for DMs after leaving a group, as long as they were ever admitted. This matches user intuition ("I know this person from our study group").
- The ever-known set is append-only: adding it cannot create false-deny regressions (existing members stay allowed).
- `isAllowedDmSender` remains pure — the ever-known set is passed as a parameter, not read inside the function. The purge sweep, bell watcher, and ContactChat all operate on the same parameter-passing pattern.
- Pull-only invitation safety: Welcomes do not grant reachability until processed + accepted.

**Negative**:
- The purge sweep now preserves DM history for ex-members as long as they are ever-known. This is intentional but means the walled garden is no longer strictly synchronised with live group membership.
- The ever-known set grows monotonically. On a device that has cycled through many groups over months, the set may contain hundreds of peers. The set is stored as a flat JSON array; performance impact is negligible for realistic sizes.
- The append-only property means a peer cannot be removed from knownPeers without a full account reset. Users who want to block a specific ex-member have no in-app mechanism (this is out of scope for the current epic).

**Accepted Risks**:
- The ever-known set is only as complete as the membership events the local client has processed. A peer who joined a group while the client was offline and left before the client reconnected may not appear in the ever-known set. This is accepted as an edge case.

## Evolution Triggers

- A user-facing "block" feature is added, requiring removal from knownPeers.
- The MLS group model is replaced with a different membership primitive.
- The product introduces a concept of "trusted contacts" managed outside of group membership.

## References

- Supersedes: ADR-001-gate-dm-reachability-exclusively-on-live-mls-group-membership.md
- Related specs: specs/epic-walled-garden-v2/
- Implementation: Story S1 (ever-known peers), Story S2 (pull-only invitations)
