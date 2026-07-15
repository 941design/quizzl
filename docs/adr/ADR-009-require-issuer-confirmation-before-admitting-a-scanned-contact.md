# ADR-009: Require issuer confirmation before admitting a scanned contact

**Status**: Proposed
**Date**: 2026-07-15
**Type**: Lightweight
**Affects**: specs/epic-contact-pairing-code/, specs/epic-pending-contact-confirmation/
**Supersedes**: none
**Superseded by**: none

## Context

`epic-contact-pairing-code` shipped a pairing handshake whose anchor
scenario (`AC-ADMIT-6`) promised: after B scans A's contact card once,
*both* DM directions work immediately, with no second scan required on
either side (`AC-PAIR-4` makes the same "auto-admit both" promise for the
multi-use card variant). `handlePairingAck`
(`app/src/lib/pairing/pairingAck.ts:439`, pre-epic) admitted the scanner
into A's contact store the instant the cryptographic nonce/ack handshake
completed, synchronously and with no user action.

A contact card is a **bearer credential**: anyone who obtains a leaked
card — not just its intended recipient — can complete the handshake and
pair with the issuer. Under the old auto-admit behavior that pairing
succeeds *silently and permanently*: the issuer never sees it happen and
has no way to notice or undo it. A leak is undetectable at worst.

`epic-pending-contact-confirmation` (2026-07-15) inserted a pending state
on the issuer's side only: the issuer sees the new contact and must
explicitly confirm before that contact's messages render or ring the
notification bell. This directly and deliberately invalidates
`AC-ADMIT-6`'s "both directions work *immediately*" clause — proven
genuine (not a flake) by running the affected e2e specs
(`app/tests/e2e/dm-pairing-single-scan-mutual.spec.ts`,
`app/tests/e2e/dm-pairing-multi-use.spec.ts`) against the pre-epic
baseline (`6ce9cfd`), where both passed. Neither that epic's spec nor
spec validation had noticed the collision before the pre-ship e2e gate —
see `specs/epic-pending-contact-confirmation/spec.md` `## Amendments`
(2026-07-15, pre-ship e2e gate) for the full narrative.

## Decision

A contact admitted via the passive (issuer) side of the contact-card
pairing handshake is admitted in a **pending-confirmation** state, not
immediately final. The issuer must explicitly confirm before the new
contact's messages render or increment the notification bell.

**The asymmetry is principled, not incidental.** Only the party who
*provided* the card (the issuer) confirms. The scanner continues to be
admitted immediately and is unaffected, because scanning is itself an
intentional act that expresses consent; the issuer performed no such
act — someone simply presented (or leaked) their card to be scanned.

This supersedes `epic-contact-pairing-code`'s `AC-ADMIT-6` and
`AC-PAIR-4` **only** on their "both directions work *immediately*"
clause. `AC-ADMIT-6`'s "no second scan" guarantee is unaffected and
still holds in full — no rescan is ever required, and a confirm tap is
not a scan. The clause now reads: both directions work once the card
issuer confirms.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep immediate auto-admit on both sides (status quo) | A leaked card produces a silent, permanent, undetectable pairing on the issuer's side — the exact failure mode this decision exists to close. |
| Time-boxed auto-expiry instead of manual confirmation | Rejected by product decision during `epic-pending-contact-confirmation` spec drafting (see that spec's Design Decision 3) — no timer-based fallback; the issuer's explicit action is the point, not a deadline. |
| Gate the scanner side too (symmetric confirmation) | The scanner already expressed consent by performing the scan; requiring a second confirmation from the scanner adds friction without closing any leaked-credential gap (the scanner controls whose card they scan). |

## Consequences

**Positive**: A leaked or shared contact card can no longer silently and
permanently pair the leaker with the issuer — the issuer gets a visible,
declinable prompt instead. The decline mechanism reuses the existing
block/archive action (no new UI surface for "reject").

**Negative**: `epic-contact-pairing-code`'s anchor scenario (`AC-ADMIT-6`)
and `AC-PAIR-4` no longer hold as originally written; a future reader of
that epic's spec/AC file who does not cross-reference this ADR would find
its stated behavior contradicted by shipped code. Both affected e2e specs
were updated in the same round to drive the confirm step, so the test
suite does not silently regress.

**Accepted Risks**: The issuer must take an extra action (confirm) before
a legitimate new contact can message them and be noticed — a small UX
cost accepted in exchange for closing the bearer-credential leak window.

## Evolution Triggers

Conditions under which this ADR should be reopened:

- If a future card-issuance mechanism eliminates the bearer-credential
  property (e.g. single-use, recipient-bound cards) such that a leaked
  card cannot be used by anyone but the intended recipient.
- If product decides the issuer-side friction is not worth the security
  gain and reverts to auto-admit (would require re-superseding this ADR
  and restoring `AC-ADMIT-6`/`AC-PAIR-4` as originally written).

## References

- Origin: curator-promoted from `/base:feature` run of `epic-pending-contact-confirmation`, via `direct via /base:adr`
- Related ADRs: ADR-002 (mutual contact graph and pull-only invitations — establishes `knownPeers`, left unchanged by this decision), ADR-008 (block is a deny layer AND-ed at every peer-signal channel — this decision is a deliberate, cited exception, not folded into that composite; see `specs/epic-pending-contact-confirmation/spec.md` Design Decision 5)
- Related specs: specs/epic-contact-pairing-code (AC-ADMIT-6, AC-PAIR-4 — superseded on the "immediately" clause only), specs/epic-pending-contact-confirmation (the epic that introduced this decision)
