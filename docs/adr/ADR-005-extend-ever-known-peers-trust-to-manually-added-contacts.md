# ADR-005: Extend ever-known-peers trust to manually-added contacts

**Status**: Accepted
**Date**: 2026-07-02
**Type**: Lightweight
**Affects**: app/src/lib/knownPeers.ts, app/src/lib/contacts.ts, app/src/lib/walledGarden.ts
**Supersedes**: none
**Superseded by**: none

## Context

ADR-002 established `knownPeers` ("ever-known peers") as the trust basis for DM reachability beyond live group membership: a peer becomes ever-known only through a *mutual* event — a Welcome to a shared MLS group that the local user explicitly accepted (`docs/adr/ADR-002-mutual-contact-graph-and-pull-only-invitations.md:22-24`, pull-only invitations). ADR-002's own "Evolution Triggers" section explicitly names this scenario in advance: *"The product introduces a concept of 'trusted contacts' managed outside of group membership."*

`specs/epic-add-contact-by-npub/` introduces exactly that: a user can type or scan an arbitrary npub on the Contacts page and add it as a contact with no shared group. Without any change to the trust model, that contact could be *sent* DMs (no outbound gate exists — `ContactChat`'s `sendMessage` has no walled-garden check today) but their replies would be silently dropped by `isAllowedDmSender` (`app/src/lib/walledGarden.ts:53`), since the contact is in neither `group.memberPubkeys` nor `knownPeers`. That produces a contact that appears added but is functionally broken for two-way messaging — worse than not adding the feature at all.

## Decision

A pubkey added via the new `addContactByNpub` (`app/src/lib/contacts.ts`) is seeded into the existing `knownPeers` set (`rememberKnownPeers`, `app/src/lib/knownPeers.ts:100`) at the moment it is added, exactly as if it had been a group co-member. No new set, no change to `isAllowedDmSender`'s signature or the groups-∪-knownPeers rule — this is a new *producer* into the existing append-only set, not a new mechanism.

This is a **deliberate widening of the trust model's basis**: `knownPeers` entries are no longer exclusively backed by a mutual, protocol-verified event (accepted Welcome). A manually-added entry is backed only by unilateral local user action — the local user asserting "I trust this npub," with no verification that the pubkey is reachable, real, or consenting. The judgment made here is that explicit user intent ("I am choosing to add this specific person") is an acceptable trust signal for a *local, single-device* address book entry, on the same footing as "the app's local dev tools" (`MAINTAINER_PUBKEYS_HEX` is already seeded into `knownPeers` unconditionally, `MarmotContext.tsx:533`) — i.e., this is not the first non-group-membership producer into the set, only the first *user-controlled* one.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Add manually-added contacts to storage only, without seeding `knownPeers` | Contact appears added but replies are silently dropped — confusing, and defeats the purpose of the feature (see Context). |
| Introduce a separate `manuallyTrustedPeers` set, checked alongside `knownPeers` in `isAllowedDmSender` | More honest about the different trust provenance, but widens `isAllowedDmSender`'s signature (a function with strict purity/testing invariants per ADR-002 AC-SEC-13) and doubles the sets a future "block" feature (ADR-002's own unaddressed evolution trigger) would need to handle. Rejected for now as unnecessary complexity for a feature this narrow; revisit if a block/revoke feature is built (see Evolution Triggers below). |
| Require the manually-added peer to first message back before trusting them (lazy/reactive trust) | Closer to zero-trust-by-default, but reintroduces exactly the "reply silently dropped" UX problem this feature exists to solve, just deferred by one round-trip. Rejected — no simple way to surface "we saw your first message but didn't let it through" without new UI. |

## Consequences

**Positive**: Manually-added contacts work for two-way DMs immediately, matching user intent and avoiding a confusing half-working feature. No new code path in `isAllowedDmSender` or the purge sweep — both already handle `knownPeers` correctly.

**Negative**: `knownPeers` membership no longer implies "was mutually admitted to a group I administer or joined." An attacker who convinces a user to manually add their npub gains the same reachability as a genuine ex-group-member — but this is a strictly local, user-initiated action (typing/scanning a specific npub), not something an attacker can trigger remotely.

**Accepted Risks**: There remains no in-app way to remove a peer from `knownPeers` (ADR-002's own accepted risk, unchanged by this ADR) — a manually-added contact cannot be "un-trusted" without a full account reset, same as any other ever-known peer.

## Evolution Triggers

- A user-facing "block" or "remove contact" feature is added — at that point, revisit whether manually-added and group-derived `knownPeers` entries need separate provenance so one can be revoked without touching the other.
- Stranger profile discovery (fetching a kind-0 profile for an arbitrary pubkey) is built — at that point, revisit whether the trust decision here should gate that lookup too (e.g., don't leak "I looked you up" to someone not yet trusted).

## References

- Origin: direct via `/base:adr`
- Related ADRs: ADR-002 (supersedes ADR-001; establishes `knownPeers` and names this ADR's scenario as an Evolution Trigger)
- Related specs: specs/epic-add-contact-by-npub/, specs/epic-walled-garden-v2/
