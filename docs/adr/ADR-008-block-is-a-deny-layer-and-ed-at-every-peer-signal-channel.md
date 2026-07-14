# ADR-008: Block is a deny layer AND-ed at every peer-signal channel, keyed on `archivedAt`

**Status**: Proposed
**Date**: 2026-07-14
**Type**: Lightweight
**Affects**: specs/epic-block-contact/, specs/epic-dm-walled-garden/, specs/epic-contact-pairing-code/, specs/epic-direct-contact-profile-exchange/, project-wide
**Supersedes**: none
**Superseded by**: none

## Context

`epic-block-contact` overloaded the existing `StoredContact.archivedAt` flag
(ADR-005 already anticipated this) as the single source of truth for
"blocked," enforced as `isAllowedDmSender(...) AND NOT isBlockedPeer(...)`
(DD-8, `specs/epic-block-contact/acceptance-criteria.md` AC-CORE-3/AC-CORE-4).
The spec's original §4 enumerated four enforcement sites (notification
watcher, `ContactChat` ingestion x4, view/composer gating, DM-profile heal
channel). A pre-commit whole-tree review (Fable) then found **three more**
outbound signals to a blocked peer that no single story's scoped diff could
see, because each lived on a cross-epic seam invisible from within
`epic-block-contact` alone (`specs/epic-block-contact/spec.md` `##
Amendments`, 2026-07-14):

- the pairing-ack issuer push (`pairingAck.ts`, owned by
  `epic-contact-pairing-code`) — `sendProfileAnnounce` + name-cache write
  on re-pairing admission (AC-PRIV-4);
- the pending pairing-echo drain (`pendingIntent.ts`) — a TOCTOU gap where
  the block set was checked at queue time but not at send time (AC-PRIV-5);
- the `/feedback` route (`epic-feedback-channel`) — a second, previously
  ungated `ContactChat` mount (AC-VIEW-15).

A fourth channel, the DM-profile heal watcher (`epic-direct-contact-
profile-exchange`, ADR-007), was verified already-correctly-gated only
because it happened to key off the same `archivedAt` flag — not because
anyone had designed it against a block feature that didn't exist yet
(`spec.md` §4 "Inbound — DM-profile heal channel"). The post-epic backlog
already contains a fifth, still-open instance of the same shape: incoming
calls (`IncomingCallWatcher.tsx:149`) gate on bare `isAllowedDmSender` and
are NOT block-gated (finding `gate-incoming-calls-with-block-deny`,
tracked, latent while calls are disabled). The pattern is not
self-enforcing — it depends on every future peer-signal-emitting feature
remembering to compose the same gate rather than re-deriving its own.

## Decision

Any feature that emits or persists a signal addressed to (or sourced from)
an individual peer — a DM, a notification/bell increment, a profile
announce, a pairing ack/echo, a call ring, or any future per-peer channel —
**MUST** gate that signal on the composite predicate
`isAllowedDmSender(...) AND NOT isBlockedPeer(...)` (or delegate to the
single shared assembly, `isAllowedDmSenderComposite` in
`app/src/lib/blockedPeers.ts`), keyed on the one truth value
`StoredContact.archivedAt != null`. Concretely:

1. **One deny predicate, one home.** `isBlockedPeer` stays a separate,
   storage-free pure predicate (never folded into `isAllowedDmSender`,
   preserving AC-SEC-13); the composite assembly lives in exactly one
   module (`blockedPeers.ts`) and every call site imports it — never
   re-derives its own AND. `epic-block-contact` explicitly rehomed the
   gate mid-epic (S2→S4) after spotting a fork risk; this is now the
   required shape going forward, not a one-off fix.
2. **The enforcement surface is enumerated by verification, not by
   design.** A per-epic §4-style enumeration of "every site that emits a
   signal to this peer" is necessary but not sufficient — cross-epic
   seams (pairing-ack, pending-intent, feedback route, calls) are
   invisible from inside a single epic's diff. A feature that adds any
   new peer-addressed channel MUST grep for existing `archivedAt`/
   `isAllowedDmSender` gating call sites and existing epics that emit
   peer-addressed signals, not just its own new code.
3. **Deny always wins over allow**, and blocking never touches
   `knownPeers`/ADR-005 trust or shared-group membership (DD-5, AC-SCOPE-1/
   AC-SCOPE-2) — block is purely an additional AND-ed veto, never a
   rewrite of the allow function.

This absorbs no rejections from `BACKLOG.json#archive[]`; it codifies a
decision that emerged from within-epic implementation, not a cluster of
prior "no"s.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Leave the gate as an epic-local convention (each new peer-signal feature re-derives its own block check) | Already proven insufficient once: three cross-epic leaks shipped past per-story review and were only caught by a separate whole-tree pass; the pattern needs to be a named, citable decision so the next feature (e.g. the still-open calls-gating finding) checks it deliberately instead of relying on another whole-tree review to catch the gap again. |
| Fold `isBlockedPeer` into `isAllowedDmSender` (single combined allow/deny function) | Rejected by the epic itself (DD-8): breaks `isAllowedDmSender`'s storage-free purity invariant (AC-SEC-13) and would force every existing caller of the allow function to become block-aware even where deny is irrelevant (e.g. group membership checks, DD-5). |

## Consequences

**Positive**: A single, citable rule for "does this new peer-addressed
signal need block-gating?" — future features (calls, any future per-peer
broadcast) can be checked against this ADR at spec-review time rather than
rediscovered by a late whole-tree review. One shared gate implementation
(`blockedPeers.ts`) prevents the forked-gate risk the epic itself flagged
and fixed mid-run.

**Negative**: Every new peer-addressed feature now carries an explicit
verification obligation ("did you check this against ADR-008's channel
list") that is easy to skip if the epic's author doesn't know the ADR
exists — the ADR is only as effective as it is actually consulted during
spec-writing.

**Accepted Risks**: The enumeration of "channels that emit a peer-
addressed signal" is not exhaustive and cannot be made exhaustive by this
ADR alone — the calls channel is a known, currently-open gap
(`gate-incoming-calls-with-block-deny`), and cross-tab propagation of the
block-revision counter is a separate, orthogonal gap
(`block-revision-sibling-revision-counters-have`). This ADR documents the
*rule*; it does not itself close every known instance.

## Evolution Triggers

- If a future feature adds a new peer-addressed channel and ships without
  checking it against this ADR's gate (i.e. another leak is found by a
  whole-tree/adversarial review rather than by design), tighten the rule
  from "MUST grep for it" to a required spec-review checklist item.
- If `gate-incoming-calls-with-block-deny` is picked up, its story should
  cite this ADR directly rather than re-deriving the rationale.
- If a second deny-list concept (e.g. mute, distinct from block) is ever
  introduced, revisit whether the composite-gate-in-one-module pattern
  generalizes or needs a pluggable deny-predicate list.

## References

- Origin: direct via `/base:adr` (proposed autonomously by `base:project-curator` at the end of the `epic-block-contact` `/feature` run)
- Related ADRs: ADR-005, ADR-007
- Related specs: specs/epic-block-contact, specs/epic-dm-walled-garden, specs/epic-contact-pairing-code, specs/epic-direct-contact-profile-exchange
