# Group Invite Link Onboarding — Acceptance Criteria

## Terminology

- **Nameless user** — a user for whom `hasShareableName(profile.nickname)`
  (`app/src/lib/shareCard.ts:125`) returns `false`. This predicate is the single source of
  truth; no AC below may re-derive "has a name" by any other means.
- **Join card** — `JoinRequestCard` (`app/src/components/groups/JoinRequestCard.tsx`),
  rendered by `pages/groups.tsx:544-554` when `join`, `admin`, and `name` query params are
  all present.
- **Outbound record** — a persisted `{ nonce, adminPubkeyHex, groupName, sentAt }` written
  by this device when it sends a join request.
- **Authenticated sender** — the seal pubkey recovered from a gift wrap whose seal signature
  verified AND for which `rumor.pubkey === seal.pubkey`. This is the *only* trustworthy
  sender identity; the raw `rumor.pubkey` field on its own is attacker-controllable and MUST
  NOT be used for any trust decision.
- **Correlated Welcome** — an inbound Welcome whose **authenticated sender** matches the
  `adminPubkeyHex` of an unexpired stored outbound record.
- **Uncorrelated Welcome** — any inbound Welcome that is not a correlated Welcome: no
  matching record, an expired record, OR a Welcome whose sender failed authentication. This
  includes every Welcome arriving today from any other mechanism.

## Known TAGs

| TAG | Meaning |
|---|---|
| `GATE` | The name gate on the join card (S1) |
| `NAME` | Requester nickname transport and rendering (S2) |
| `AUTH` | Authenticated unwrap (both kinds) + signed join-request seal (S3) |
| `AUTO` | Outbound record and authenticated-admin auto-accept (S4) |
| `SEC` | Security invariants that must hold across all stories |
| `INTL` | Translation coverage |
| `ETE` | End-to-end coverage |

---

## Name Gate (S1)

**AC-GATE-1** — When a nameless user opens a valid invite link, the join card MUST render a
name input and MUST render the "Request to Join" button in a disabled state. Clicking the
disabled button MUST NOT call `sendJoinRequest`.

**AC-GATE-2** — The group name (from the link's `name` param) MUST remain visible on the
card while the name input is shown. A nameless user MUST never be asked for a name without
the group name visible in the same view.

**AC-GATE-3** — Entering a name that satisfies `hasShareableName` MUST enable the "Request
to Join" button. Clearing it back to a nameless value MUST disable the button again
(the gate is reactive, not evaluated once on mount).

**AC-GATE-4** — When a user who already has a name opens the same link, the card MUST
render as it does today: no name input, no helper text, button enabled. This repo has no
component-render/snapshot test capability (vitest only, no jsdom — see project conventions),
so this is verified via e2e, not a snapshot: AC-ETE-2 (the existing named-user spec passes
unmodified) **plus** an explicit e2e assertion that no name input is present for the
named-user case.

**AC-GATE-5** — Submitting the name MUST persist it via `saveProfile`
(`app/src/context/ProfileContext.tsx:52-58`) and MUST NOT write `nickname` to storage
through any other path. After submission the name MUST be readable on `/profile` as the
user's nickname — i.e. this is the user's real profile name, not a per-request alias.

**AC-GATE-6** — The name gate MUST be evaluated only after the existing hydration, identity,
and invalid-admin-npub guards (`JoinRequestCard.tsx:43-70`). A user with an unhydrated
identity MUST still see the existing "setting up…" state, not the name input.

**AC-GATE-7** — The gate MUST NOT block the already-a-member path
(`JoinRequestCard.tsx:39-41`). A nameless user who is already a member MUST see the existing
already-member state, not a name prompt.

---

## Requester Nickname Transport (S2)

**AC-NAME-1** — `buildJoinRequestRumor` MUST include the requester's nickname in the rumor
content under a field distinct from the existing `name` field (which carries the *group's*
name). The rumor MUST remain kind `21059` and MUST remain gift-wrapped by the existing
`buildGiftWrap` path — no new event kind, no new transport.

**AC-NAME-2** — `parseJoinRequestContent` MUST treat an absent, empty, non-string, or
otherwise malformed requester-name field as `undefined` and MUST NOT reject the rumor for
that reason alone. A join request from a client that does not send the field MUST still
produce a valid `PendingJoinRequest`.

**AC-NAME-3** — `handleJoinRequest` MUST populate `PendingJoinRequest.nickname` from the
parsed value (replacing the hardcoded `undefined` at `joinRequestHandler.ts:88`), capped
per **AC-SEC-1**.

**AC-NAME-4** — `PendingRequestRow` MUST render the requester's nickname **and** the
truncated npub together. The nickname MUST NOT replace the npub. When `nickname` is
`undefined`, the row MUST render the truncated npub alone (today's behavior).

**AC-NAME-5** — The requester's nickname MUST NOT be resolved from, or fall back to, a
kind-0 lookup in any code path. No AC in this epic is satisfiable by fetching kind-0
metadata. *(See AC-SEC-4.)*

---

## Authenticated Unwrap + Signed Join-Request Seal (S3)

**AC-AUTH-0** — `joinRequestSender.ts`'s `buildGiftWrap` MUST sign the kind-13 seal with the
sender's real key before encrypting it into the gift wrap (today the seal carries an `id` but
no `sig`; only the outer wrapper is signed). This MUST land together with AC-AUTH-1's
enforcement — a build in which the unwrap enforces seal signatures but the join-request seal
is still unsigned would drop every join request, and MUST NOT be shippable as an intermediate
state. Prefer the audited `nostr-tools/nip59` seal/wrap helpers (already used by the DM path)
over signing the hand-rolled seal.

**AC-AUTH-1** — `unwrapGiftWrap` MUST verify the seal's schnorr signature before trusting any
field of the inner rumor, matching `unwrapAndOpen` (`app/src/lib/directMessages.ts:250`).
This applies to **both** kinds the function dispatches (kind 444 Welcome and kind 21059 join
request). A message whose seal signature does not verify MUST NOT be treated as authenticated.

**AC-AUTH-2** — `unwrapGiftWrap` MUST assert `rumor.pubkey === seal.pubkey`
(`app/src/lib/directMessages.ts:262`) and MUST reject the sender identity on mismatch, for
both kinds. The authenticated sender is the seal pubkey; the raw `rumor.pubkey` MUST NOT be
used as the sender for any trust decision on either path.

**AC-AUTH-3** — A message failing AC-AUTH-1 or AC-AUTH-2 MUST NOT throw out of, or halt, the
subscription. A **Welcome** so failing is handled as an **uncorrelated Welcome** (→ AC-AUTO-3)
with authenticated-sender status false, so a spoofed sender can never satisfy the auto-accept
condition. A **join request** so failing is dropped (as today's malformed-input path already
drops unparseable requests) and MUST NOT produce a `PendingJoinRequest`. Dedicated negative
tests MUST assert both: a forged Welcome routed to the pending queue and never auto-accepted,
and a forged join request never surfaced to the admin.

**AC-AUTH-4** — A genuine join request (seal signed per AC-AUTH-0) MUST pass authentication
and produce a valid `PendingJoinRequest` — i.e. the enforcement MUST NOT regress the S2
feature. A test MUST assert a round-trip: `sendJoinRequest` → `unwrapGiftWrap` →
`handleJoinRequest` yields the request with the authenticated sender as its pubkey.

**AC-AUTH-5** — The stale doc comment in `welcomeSubscription.ts` (~lines 199-211) asserting
the rumor is signed MUST be corrected: NIP-59 rumors are unsigned; the seal authenticates.
*(Boy-scout correction of a comment this epic makes load-bearing.)*

**AC-AUTH-6** — The pre-existing pending-invitation display MUST benefit from the same fix:
the `inviterPubkeyHex` recorded for a queued Welcome MUST be the authenticated seal pubkey,
not the raw `rumor.pubkey`. A forged Welcome MUST NOT be able to display a spoofed sender on
the pending card. *(This is the latent bug the fix closes, independent of auto-accept.)*

---

## Outbound Record and Authenticated-Admin Auto-Accept (S4)

**AC-AUTO-1** — On a successful `sendJoinRequest`, the device MUST persist an outbound
record `{ nonce, adminPubkeyHex, groupName, sentAt }`, keyed by `nonce`. On a failed send,
no record is written.

**AC-AUTO-2** — A **correlated Welcome** MUST be accepted without user interaction: it MUST
NOT be enqueued into the pending-invitation queue, and the invitee MUST land in the group
with no second click. Acceptance MUST route through the shared join core that the manual
accept also calls (`joinGroupFromWelcome` + record cleanup), so `knownPeers` population and
downstream effects match a manual accept. The shared core MUST be extracted rather than
enqueue-then-dequeue (which would briefly render the pending card).

**AC-AUTO-3** — An **uncorrelated Welcome** MUST be enqueued into the pending-invitation
queue exactly as today, requiring explicit Accept. This is the ADR-002 guarantee and MUST
be asserted by a dedicated negative test, not merely implied by AC-AUTO-2's positive case.

**AC-AUTO-4** — Correlation MUST be on the **authenticated sender** (per AUTH), matched
against an unexpired outbound record's `adminPubkeyHex`. A Welcome whose *raw* `rumor.pubkey`
matches a record but whose *authenticated* sender does not (spoofed) MUST be treated as
uncorrelated. The nonce is NOT part of correlation (it never reaches the Welcome; see DD-3);
no AC may require a nonce match on the Welcome.

**AC-AUTO-4a** — Correlation MUST also match the **group**, not only the admin, whenever the
Welcome's group name is readable pre-join. The auto-accept reads the Welcome's group name
(via `readWelcomeMarmotGroupData` — a verified side-effect-free pre-join read; see the code
comment on `readPreJoinGroupName`) and applies:
- **Group name readable:** filter the admin's unexpired candidate records to those whose
  stored `groupName` equals the Welcome's group name. Exactly one match → auto-accept and
  consume *that* record. Zero or multiple matches → treat as uncorrelated (→ AC-AUTO-3).
  This holds regardless of how many records share the admin — a single candidate whose
  `groupName` does NOT match the Welcome's group MUST NOT auto-accept (it goes to pending and
  the record survives).
- **Group name NOT readable (null):** fall back to admin-only match — exactly one unexpired
  candidate for the admin → auto-accept it; more than one candidate → uncorrelated (cannot
  disambiguate → pending).

The implementer MUST NOT arbitrarily consume the first record sharing the admin pubkey, and
MUST NOT skip the group check for a single candidate when the group name is readable. Tests
MUST cover: the two-records-one-admin case; a single record whose group does NOT match the
Welcome (→ pending, record survives); and the group-name-unreadable single-candidate
fallback.

*Rationale:* the group name — unlike the nonce — does reach the Welcome and is reliably
readable pre-join (proven against real marmot-ts). Matching on it tightens auto-accept to the
group the user actually requested, closing the residual where a same-admin Welcome for an
unrequested group would silently auto-join and consume the wrong record. The admin-match
fallback preserves the common single-request case when the name cannot be read.

**AC-AUTO-5** — A consumed record MUST be removed after a correlated auto-accept (the
specific record disambiguated per AC-AUTO-4a, not merely "a record for this admin"), such
that a replay of the same Welcome finds no matching record on its second arrival and takes
the AC-AUTO-3 path. Other unexpired records for the same admin MUST survive.

**AC-AUTO-6** — The outbound record store MUST be bounded at 256 total records, consistent
with the existing pending-invitation cap (`epic-walled-garden-v2` AC-INVITE-3). Records MUST
expire after a TTL of **no less than 7 days** (admin approval can legitimately lag by days;
a shorter TTL would break the primary flow). An expired record MUST NOT correlate, and its
Welcome MUST take the AC-AUTO-3 path.

**AC-AUTO-7** — The pending-invitation card's rendered content MUST be unchanged by this
epic (beyond AC-AUTH-6's correction of *which* pubkey is recorded). Verified by: the
`PendingInvitations` component is untouched in the diff, and the existing
`epic-walled-garden-v2` AC-INVITE-4 tests pass unmodified. The card still shows only:
truncated pubkey, relative timestamp, Accept, Decline — no group name.

---

## Cross-Cutting Security Invariants (SEC)

**AC-SEC-1** — The requester's nickname MUST be capped at 32 UTF-8 bytes **on receive**, in
`handleJoinRequest`, independently of any send-side cap. The send-side cap
(`saveProfile`) is a UX affordance; the receive-side cap is the security control, because
the sender is untrusted. A test MUST assert that an over-long nickname from a hostile
sender is truncated by the receiver.

**AC-SEC-2** — The requester's nickname MUST be rendered as text, never as markup. A
nickname containing HTML or script MUST render as literal characters in the admin's row.

**AC-SEC-3** — The truncated npub MUST remain visible in the admin's pending row for every
request, regardless of nickname content (anti-impersonation, DD-6), AND that npub MUST be the
**authenticated** sender pubkey (per AC-AUTH-0/1/2), not a self-claimed field. This is the
guarantee that makes the admin's approve decision sound: the name is attacker-chosen, but the
npub is provably the requester's. A test MUST assert both that a requester whose nickname
mimics another party's display name is still rendered with their own distinct npub, and that
a join request carrying a forged `rumor.pubkey` never reaches the admin's row at all
(rejected at unwrap per AC-AUTH-3).

**AC-SEC-4** — No code path added by this epic may publish the user's kind-0, or any
profile metadata, to a public relay. The requester's nickname MUST reach the admin
exclusively inside the NIP-59 gift wrap addressed to the admin's pubkey. *(CLAUDE.md
privacy invariant — non-negotiable.)*

**AC-SEC-5** — The admin's approve/deny step MUST be unchanged. `approveJoinRequest`
(`MarmotContext.tsx:1675-1695`) and `denyJoinRequest` (`:1697-1709`) MUST retain their
current behavior. No AC in this epic is satisfied by weakening, skipping, or auto-firing
admin approval.

---

## Translations (INTL)

**AC-INTL-1** — Every new user-facing string MUST have both `en` and `de` entries in
`app/src/lib/i18n.ts` and MUST be consumed via `useCopy()`. No new user-visible string may
be hardcoded in a component.

**AC-INTL-2** — New keys MUST follow the existing `copy.groups.joinRequest*` grouping and
naming convention.

---

## End-to-End (ETE)

**AC-ETE-1** — A new e2e case MUST cover the full nameless-invitee path: nameless user opens
link → gate blocks the request → user enters a name → admin's pending row shows that name →
admin approves → **invitee lands in the group with no second click**. The final assertion
MUST be that the group card appears without any Accept interaction.

**AC-ETE-2** — The existing named-user path in `groups-invite-link.spec.ts` MUST continue to
pass. Its *card-rendering* steps are unmodified — in particular an explicit assertion that no
name input renders for a user who already has a name (this is how AC-GATE-4's "renders as
today" is verified, since the repo has no snapshot capability). Its *trailing* assertion is
updated to reflect the intended auto-accept behavior: a named user who opens an invite link
and requests to join has, exactly like a nameless one, implicitly opted in by opening the
link, so their Welcome auto-accepts too (S4 correlates on the invite-link outbound record,
NOT on namelessness). The old assertion waited for a manual pending-invitation Accept, which
S4 deliberately removes for every invite-link requester. Updating that one assertion to
"lands in the group directly, zero Accept elements" is tracking intended behavior, not
masking a regression. *(The original "pass unmodified" wording wrongly implied auto-accept
was scoped to nameless users; it never was — see DD-3 and AC-AUTO-*, which are all at
invite-link-flow granularity.)*

**AC-ETE-3** — All peer publishes in new e2e code MUST go through the app's own helpers via
a second `browser.newContext()`. Raw `WebSocket` publishing to strfry is forbidden
(CLAUDE.md).

**AC-ETE-4** — The e2e gate for this epic is the full suite (`make test-e2e-all`), not a
filtered subset (CLAUDE.md).

---

## Manual Validation

These require a human and cannot be asserted by an automated test.

| AC | What to check |
|---|---|
| **AC-MANUAL-1** | On a real phone, open an invite link as a brand-new user. Confirm the name field and the group name are legible together without scrolling, and that the disabled button reads as *"enter a name first"* rather than *"something is broken."* |
| **AC-MANUAL-2** | Confirm the German copy for the gate reads naturally to a native speaker — a literal translation of "so the group knows who you are" is likely to land awkwardly. |
| **AC-MANUAL-3** | With two real devices, confirm the auto-accept transition is not jarring: the invitee should understand they have joined, not wonder what happened. Judge whether a confirmation toast is warranted. |
