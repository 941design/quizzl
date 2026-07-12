# ADR-007: Adopt gift-wrapped 1:1 direct-contact profile exchange over an ad-hoc MLS group

**Status**: Proposed
**Date**: 2026-07-12
**Type**: Lightweight
**Affects**: app/src/lib/dmProfile/, app/src/lib/contactCache.ts, app/src/lib/walledGarden.ts
**Supersedes**: none
**Superseded by**: none

## Context

Direct (1:1) contacts had no channel to exchange profile metadata
(`specs/epic-direct-contact-profile-exchange/spec.md:26-43`, §1). A
contact added from a card got the issuer's name but never their avatar
(the card codec carries no avatar field), the issuer never persisted the
scanner's name back (`pairingAck.ts#handlePairingAck` called
`rememberContact` but not `importCard`, §10.1), and nothing self-healed:
an already-formed contact with a missing profile stayed missing forever.

The app's privacy invariant (`CLAUDE.md`) forbids publishing profile
metadata to an unaddressed audience — no public kind-0, ever. Any
profile-exchange transport had to be private and recipient-addressed by
construction.

Two structural pieces already existed to build on:
- **ADR-002** (mutual contact graph, pull-only invitations) established
  `isAllowedDmSender` = current MLS co-member ∪ `knownPeers`
  (`docs/adr/ADR-002-mutual-contact-graph-and-pull-only-invitations.md`).
- **ADR-005** (extend ever-known-peers to manually-added contacts)
  widened `knownPeers`' provenance to include unilateral user action, and
  explicitly named "a block/revoke feature" and "stranger profile
  discovery" as its own unaddressed evolution triggers
  (`docs/adr/ADR-005-extend-ever-known-peers-trust-to-manually-added-contacts.md`).

Neither ADR's allowed-sender set alone is sufficient for a profile
channel: `knownPeers` is **append-only** (`knownPeers.ts` has no removal
API), so gating disclosure on `isAllowedDmSender` alone would keep
disclosing profile data to an archived/hidden contact forever. This
decision needed a narrower, per-purpose disclosure boundary layered on
top of the existing trust graph, not a new trust graph.

## Decision

Adopt a **private, self-healing 1:1 profile channel over NIP-59 gift
wraps** (kind-1059, sender hidden by an ephemeral key, addressed to
exactly one recipient pubkey) — not an ad-hoc/hidden 2-member MLS group
per contact.

Concrete shape (`spec.md` §3-§8):

- **Two new gift-wrap inner rumor kinds**: `profile-request`
  (`DM_PROFILE_REQUEST_KIND = 21061`) and `profile-announce`
  (`DM_PROFILE_ANNOUNCE_KIND = 21062`), disjoint from the MLS
  application-rumor `PROFILE_RUMOR_KIND = 0` used by group profile sync
  — the two are explicitly not conflated (§4 namespace note).
- **Disclosure boundary = `isAllowedDmSender` ∩ active-non-archived
  contact.** Both the answer path (§3.3) and the announce-accept path
  (§3.5) require the authenticated sender to pass ADR-002/005's
  `isAllowedDmSender` **and** to be a contact whose `archivedAt` is
  `null`. The second clause is an explicit check layered on top of the
  append-only `knownPeers` set — archiving a contact is the app's only
  hide/remove action today, and it must stop all profile exchange with
  that peer in both directions even though `knownPeers` cannot forget
  them (§8, "LOCKED Q7").
- **The announce is unsigned by design** (§4.1, D6). Authenticity comes
  solely from the gift-wrap sender-binding
  (`directMessages.ts#unwrapAndOpen`, strict `rumor.pubkey ===
  seal.pubkey` check — never the lenient `welcomeSubscription.ts
  #unwrapGiftWrap`). A signed kind-0 handed to a recipient would be a
  *publishable* profile event a buggy or hostile recipient could launder
  onto a public relay as the sender's kind-0 — which the privacy
  invariant forbids on the sender's behalf.
- **`updatedAt` is stamped at answer-time**, not the profile's last-edit
  time (§4, REVIEW B2), so the LWW write commensurable with group-sync's
  `contactCache` entries can never lose to a stale card import and
  silently no-op the healing message.
- **Push companions accompany the pull/heal loop** (§3.6, LOCKED Q3): an
  announce fans to every active, non-archived contact on a local profile
  edit, and to a single new contact immediately on pairing admission —
  same message, same gate, same receive path as the pull response.

### Rejected alternative: an ad-hoc 2-member MLS group per contact

An earlier proposal was to auto-create a hidden 2-member MLS group per
contact to piggyback on the existing group profile-sync protocol
(`profileSync.ts`). Rejected (`spec.md` §1.3), with mechanism:

- It reintroduces the KeyPackage dependency the pairing flow exists to
  avoid — inviting a peer to an MLS group requires their published,
  unused KeyPackage on a relay (single-use, consumed on join). A gift
  wrap needs only the peer's pubkey, which is always already known.
- It imports the entire MLS lifecycle per contact — commit + Welcome +
  mandatory post-join self-update, then perpetual epoch/key-rotation
  state — to move two text fields. A gift wrap is stateless addressed
  mail with no such state machine.
- Both sides creating the group yields two un-mergeable groups (MLS has
  no dedup); a gift wrap has no creation step, so send/receive symmetry
  is free.
- The thing it would "reuse" does not exist to reuse: Marmot's group
  profile is the *group's* admin-set identity, not a member describing
  themselves to another member individually — there is no per-member
  personal-profile component to piggyback on. The message type would
  have to be built anyway, inside a far heavier container.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Ad-hoc hidden 2-member MLS group per contact | Reintroduces the KeyPackage dependency, the full MLS commit/Welcome/epoch lifecycle, and a group-merge race — all to move two text fields a stateless gift wrap already carries (§1.3 above). |
| Signed kind-0 envelope handed to the recipient (mirroring group sync's `serialiseProfileUpdate`) | A signed kind-0 is a *publishable* event; a buggy or hostile recipient could republish it to a public relay as the sender's own kind-0, violating the app's "no public kind-0" invariant on the sender's behalf (§4.1, D6). |
| Gate disclosure on `isAllowedDmSender` alone (ADR-002/005's existing set) | `knownPeers` is append-only with no removal API — archiving/hiding a contact would never stop disclosure to them, contradicting the product decision that archive revokes profile exchange (§8, LOCKED Q7). |
| A new, separate trust set for profile disclosure, checked instead of/alongside `isAllowedDmSender` | Unnecessary complexity: the existing allowed-sender set is a correct necessary condition (group co-members and ever-known peers can already DM you); only a *narrower* per-purpose exclusion (active-contact) was missing, not a whole new trust graph. |

## Consequences

**Positive**: Every 1:1 contact — including one added by npub with no
shared group (ADR-005) — gets a working profile-exchange channel with no
new relay dependency, no KeyPackage requirement, and no group lifecycle.
Archiving a contact is a complete, symmetric revocation of profile
disclosure in both directions despite `knownPeers`' append-only nature,
without needing to touch ADR-002/005's trust graph. The channel is
inert-safe against old builds (unknown gift-wrap kinds fail closed) and
self-heals the installed base with no migration.

**Negative**: A second, parallel 1:1 message-kind namespace
(21061/21062) now exists alongside the MLS application-rumor namespace
(kind 0) for conceptually the same data (name + avatar) — two producers
of `contactCache` entries under different LWW-comparable `updatedAt`
semantics that future maintainers must keep straight (`spec.md` §4
namespace note explicitly warns against conflating them). Small,
recurring background gift-wrap traffic (bounded by backoff, §3.2) is
added for every incomplete contact.

**Accepted Risks**: The disclosure boundary depends on a hand-maintained
active-contact check layered on top of `isAllowedDmSender` rather than a
change to the trust-graph primitive itself — a future new "allowed
sender" producer would need to remember to compose with this same
archive check, or it silently reopens disclosure to archived contacts
(§8). Presence-signal leakage (answering reveals you were online at
reply time) is accepted as equivalent to any DM reply.

## Evolution Triggers

- A user-facing **block** feature (distinct from archive) is added —
  ADR-005 already named this as its own trigger; if built, it must feed
  the same archive-derived exclusion this ADR's disclosure boundary
  relies on, not a third separate suppression signal.
- **Stranger profile discovery** (fetching a kind-0 for an arbitrary
  pubkey, ADR-005's other named trigger) is built — revisit whether the
  gift-wrapped channel's authenticated-sender model should extend to, or
  stay disjoint from, that lookup.
- The MLS application-rumor profile-sync protocol (`profileSync.ts`,
  kind 0) is ever generalized to per-member personal profiles — at that
  point, re-evaluate whether the two parallel producers of
  `contactCache` (§4 namespace note) should merge.

## References

- Origin: curator-promoted from `/base:feature` run of
  `specs/epic-direct-contact-profile-exchange/` (2026-07-12)
- Related ADRs: ADR-002 (establishes `isAllowedDmSender` = MLS
  co-member ∪ `knownPeers`, this ADR's necessary-but-insufficient
  disclosure precondition), ADR-005 (widens `knownPeers`' provenance to
  manually-added contacts; names the block-feature and stranger-lookup
  evolution triggers this ADR's boundary must someday compose with)
- Related specs: specs/epic-direct-contact-profile-exchange/
