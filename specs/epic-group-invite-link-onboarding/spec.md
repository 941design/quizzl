# Group Invite Link Onboarding

**Status**: pre-implementation
**Source**: natural-language request, requester decisions locked in `## Design Decisions`

## Problem

A brand-new user who opens a group invite link arrives at the admin as an anonymous
string of hex, and is then asked to confirm an invitation they already asked for.

Today's flow, concretely:

1. **No name is ever requested.** `NostrIdentityContext` generates a keypair silently on
   first mount (`app/src/context/NostrIdentityContext.tsx:174-183`). There is no
   onboarding step anywhere in the app — a first-time visitor has an identity before any
   UI renders.
2. **The join card does not care.** `JoinRequestCard` gates only on identity hydration and
   the presence of a pubkey (`app/src/components/groups/JoinRequestCard.tsx:43-59`). It
   never checks whether the user has a name, so a nameless user can send a join request.
3. **The requester's name is never transmitted.** The join-request rumor carries
   `{ type, nonce, name }` where `name` is the *group's* name echoed back, not the
   requester's (`app/src/lib/marmot/joinRequestSender.ts:33-43`).
4. **So the admin approves a stranger.** `joinRequestHandler.ts:88` hardcodes
   `nickname: undefined`, and `PendingRequestsSection.tsx:34` therefore renders
   `truncateNpub(npub)` for every request. The admin's approve/deny decision is made with
   no information beyond "someone used my link."

   The existing epic's **AC-8** (`specs/epic-group-invite-links/acceptance-criteria.md:65`)
   says the row should show "nickname/avatar if resolvable from kind 0 metadata." **That AC
   is vacuous in this product**: the privacy invariant forbids ever publishing the user's
   own kind-0, so no Few user has a kind-0 for anyone else to resolve. (Reading a kind-0 is
   not itself forbidden — it simply never returns anything for a Few user, so the clause can
   never deliver a name.) The hardcoded `nickname: undefined` reflects that dead end; the AC
   was never amended. This epic amends it to source the name from the gift-wrapped rumor
   instead.

5. **The invitee is asked to confirm twice.** After the admin approves, the Welcome lands
   in the pull-only pending queue (`app/src/lib/marmot/welcomeSubscription.ts:196-198`)
   and the invitee must navigate back to `/groups/` and click **Accept**
   (`app/src/components/groups/PendingInvitations.tsx`). But the invitee already opted in —
   twice — by opening the link and clicking "Request to Join". Worse, per **AC-INVITE-4**
   the pending card shows only a truncated pubkey and a timestamp, so the invitee sees an
   anonymous card for an invitation they explicitly requested by name.

The net effect: the party who *should* have context (the admin, deciding whether to admit
someone) has none, and the party who *already gave* consent (the invitee) is asked for it
again.

## Solution

Four changes. Three address the chain above; the fourth is a security prerequisite the
third exposed.

1. **Ask a nameless user for a name, in place, before they can request to join.** The join
   card already displays the group name it read from the link; the name field appears in
   that context, so the user understands what they are naming themselves *for*. Users who
   already have a name see today's card, unchanged.

2. **Carry the requester's nickname to the admin inside the existing gift wrap.** The
   join-request rumor is already NIP-59 gift-wrapped and addressed to the admin's pubkey —
   which CLAUDE.md explicitly names as an allowed channel for profile data ("addressed
   private mail that happens to transit a relay"). The nickname rides in that rumor's
   existing content payload. No new channel, no new event kind, no kind-0.

3. **Authenticate gift-wrap senders on both paths (security prerequisite).** The Welcome
   subscription's `unwrapGiftWrap` (`app/src/lib/marmot/welcomeSubscription.ts:40-68`) does
   **not** verify the seal signature and does **not** check `rumor.pubkey === seal.pubkey` —
   it returns the sender as `rumor.pubkey ?? ''`, a value taken directly from attacker-
   controllable JSON. The sibling DM path already solves this: `unwrapAndOpen`
   (`app/src/lib/directMessages.ts:230-274`) verifies the seal signature (`:250`) and asserts
   `rumor.pubkey === seal.pubkey` (`:262`), its own doc comment naming this as "closes the
   Mallory forgery vector." This epic brings `unwrapGiftWrap` up to that standard, reusing
   the proven helper's semantics rather than inventing new crypto.

   **`unwrapGiftWrap` is shared by two message kinds**, and the fix must account for both:
   - **kind 444 (Welcome)** — the seal is *already signed* by the library
     (`marmot-ts`/applesauce sign the seal on construction), so verification simply starts
     passing. This closes the latent forged-Welcome bug that exists in the app today
     (a forged Welcome can currently spoof the sender on the pending-invitation card, with
     the user's Accept click as the only backstop; auto-accept in change 4 removes that
     backstop).
   - **kind 21059 (join request)** — the seal is built by hand in `joinRequestSender.ts`'s
     `buildGiftWrap` (lines 56-112) and is **never signed** (only the outer wrapper is). If
     verification were switched on without also signing this seal, every join request would
     fail authentication and be silently dropped — breaking this epic's own S2 feature. So
     the send side MUST be fixed too: sign the join-request seal (reuse the proven NIP-59
     helper already used by the DM path — `directMessages.ts` imports `nostr-tools/nip59` —
     rather than the ad-hoc hand-rolled seal). This closes a parallel, pre-existing spoofing
     hole: today an attacker holding a valid invite link can forge a join request naming a
     *victim's* pubkey, and on approval the admin's `inviteByNpub` would pull that
     unconsenting third party into the group. Fixing it is what makes **AC-SEC-3**'s
     "the admin approves a provably-authentic npub" guarantee actually true.

   Both are sequenced first among the security work, before change 4 depends on them.

4. **Auto-accept the Welcome that answers a join request this device sent.** On sending a
   request, persist `{ nonce, adminPubkeyHex, groupName, sentAt }`. When a Welcome arrives,
   auto-accept it **only** when all hold: the seal signature verifies, `rumor.pubkey ===
   seal.pubkey`, and the *authenticated* seal pubkey is an admin this device has an
   outbound record for. Anything else — an unsolicited Welcome, or a Welcome whose claimed
   sender fails authentication — still goes to the pending queue exactly as today.

   **Why authenticated-admin match, and not the exact `{nonce, admin}` match first
   proposed.** Two facts, both verified against the code, dismantled the original design:
   (a) the kind-444 Welcome that marmot-ts produces carries **no nonce** and offers no hook
   to add one (`createWelcomeRumor` in `@internet-privacy/marmot-ts`), so an exact nonce
   match is not reachable without an out-of-scope admin-side change; and (b) once the
   unwrap is authenticated (change 3), only the true admin can produce a correlating
   Welcome — and the admin *minted the nonce*, so a nonce match would constrain the admin
   not at all. Authentication delivers what the nonce was mistakenly credited with. This
   also matches the codebase's own precedent: **ADR-009** grants the *active* party
   (the scanner, who consented by acting) auto-admission, and requires confirmation only of
   the *passive* party. The invitee here is the active party — they opened the link and
   requested to join — so auto-accepting their answered request is consistent with that
   asymmetry, not a departure from it.

   **Residual, stated deliberately (DD-3), as narrowed by Amendment 1:** auto-accept now also
   matches the *group* (via the pre-join-readable group name), not only the admin, whenever
   that name is readable. So a same-admin Welcome for a group the user did NOT request goes to
   the pending queue rather than auto-joining. The residual survives only in the narrow case
   where the group name cannot be read pre-join AND the user has exactly one outstanding
   request to that admin — then an authenticated Welcome from that admin auto-accepts
   regardless of group. A *stranger* cannot, and a *forged* Welcome cannot — those remain
   gated in every case.

## Scope

### In Scope

- A blocking name gate on `JoinRequestCard`, for nameless users only.
- The requester's nickname travelling inside the existing gift-wrapped join-request rumor.
- The admin's pending-request row rendering that nickname **alongside** the truncated npub.
- A new invitee-side store of outbound join requests.
- Authenticating gift-wrap senders in `unwrapGiftWrap` (seal-signature +
  `rumor.pubkey === seal.pubkey`) for **both** Welcome and join-request kinds.
- Signing the join-request seal on the send side (`joinRequestSender.ts`) so join requests
  survive the now-enforced authentication and their sender npub becomes unforgeable.
- Authenticated-admin auto-accept in the Welcome subscription path.
- Amending `specs/epic-group-invite-links/` AC-8 to remove the kind-0 clause.
- i18n (`en` + `de`) for all new user-facing strings.
- E2E coverage of the nameless-user path (currently unexercised).

### Out of Scope

- **The admin's approve/deny step.** Untouched. Auto-accept replaces the *invitee's*
  second confirmation, never the admin's decision.
- **AC-INVITE-4 / the pending-invitation card.** Untouched (DD-5).
- **Avatars.** The join request carries a nickname only. Avatar exchange is
  `specs/epic-direct-contact-profile-exchange/`'s concern.
- **A general onboarding wizard.** This epic adds one contextual gate on one card, not an
  app-wide first-run flow.
- **The contact-card / pairing name nudge** (`pages/profile.tsx:342-352`). Left as-is.

## Constrained by ADRs

- **ADR-002 (Mutual contact graph and pull-only invitations)** — governs this epic's
  auto-accept. ADR-002's rejected alternative is *"Auto-accept all Welcomes immediately —
  widens the pre-admission attack surface."* This epic does not do that. Auto-accept fires
  **only** for a Welcome whose *authenticated* sender (seal-verified, not the self-claimed
  `rumor.pubkey`) is an admin this device provably asked to join. An unsolicited Welcome, or
  one whose claimed sender fails seal authentication, is still queued for explicit consent.
  The pre-admission attack surface is therefore unchanged for strangers. **ADR-002 is not
  superseded and needs no amendment** — but that conclusion depends entirely on change 3
  (authenticated unwrap) landing; without it, the correlation inputs are forgeable and the
  claim is false. The two are coupled and sequenced accordingly.
- **ADR-005 (ever-known-peers)** — auto-accept routes through the same
  `joinGroupFromWelcome` path as a manual accept, so `MarmotContext`'s existing effect
  populates `knownPeers` identically. No change to trust derivation.
- **ADR-009 (Require issuer confirmation before admitting a scanned contact)** — establishes
  the active/passive asymmetry this epic's auto-accept relies on: the *active* party (who
  consents by acting) may auto-admit; only the *passive* party must confirm. ADR-009 also
  documents that a contact card is a *bearer credential* — possession proves nothing about
  identity — which is why authenticated-*sender* matching (change 3), not
  possession-of-nonce matching, is the correct basis for auto-accept here. *(ADR-009 is
  Status: Proposed, not Accepted. The asymmetry it describes is stable, but if ADR-009 is
  revised before this epic ships, re-check DD-3's reliance on it.)*
- **ADR-011 (Proposed) (Returning-user invite links land on the groups page, not a
  full-screen card)** — `epic-invite-link-awaiting-landing` (2026-07-20) reverses the
  returning-user branch of this epic's invite-link landing: the full-screen
  `<JoinRequestCard>` this epic shipped is retired for returning users, replaced by the
  groups list + info banner + awaiting card. This epic's own auto-accept mechanics
  (`joinGroupFromWelcome`, the authenticated-unwrap correlation) are unchanged; only the
  landing surface changes.

## Relationship to Other Epics

- **`specs/epic-group-invite-links/`** — this epic extends it and **amends its AC-8**
  (kind-0 nickname resolution → gift-wrapped nickname).
- **`specs/epic-walled-garden-v2/`** — owns the pull-only queue and AC-INVITE-4. This epic
  adds a correlated bypass *in front of* the queue; the queue's own contract is untouched.
- **`specs/epic-contact-pairing-code/`** — owns the `?pairing=1` name nudge. Deliberately
  **not** reused here (DD-2): that flow redirects to `/profile` because reciprocation is
  post-hoc; this flow gates in place because the name is a precondition.

## Design Decisions (locked by requester)

- **DD-1 — Blocking gate, nameless users only.** A user with no shareable name cannot send
  a join request; "Request to Join" stays disabled until a name is entered. A user who
  already has a name sees the card exactly as it renders today — no field, no change.
  *Rationale:* the admin's approve/deny decision is worthless without a name, and this is
  the only moment the user is guaranteed to be looking at the group they want to join.

- **DD-2 — Gate in place on the join card; no redirect.** The name field renders on
  `JoinRequestCard`, under the group name it already displays. We do **not** reuse the
  pairing flow's redirect-to-`/profile?pairing=1` pattern.
  *Rationale:* the pairing nudge is post-hoc and non-blocking (the contact was already
  added; the name only enables reciprocation). Here the name is a precondition, and
  bouncing a first-time user to a settings page loses the context that motivates it.

- **DD-3 — Auto-accept requires an authenticated-admin match.** A Welcome is auto-accepted
  only when its seal signature verifies, `rumor.pubkey === seal.pubkey`, and the
  authenticated seal pubkey is an admin this device has a live outbound record for. The
  correlation is on the *authenticated sender*, not on the nonce.
  *Rationale:* two facts retired the exact `{nonce, admin}` match originally proposed here.
  First, the kind-444 Welcome carries no nonce and offers no injection hook, so an exact
  nonce match is unreachable without an out-of-scope admin-side change. Second — and
  decisively — once the unwrap is authenticated, only the true admin can produce a
  correlating Welcome, and the admin minted the nonce, so a nonce match constrains the admin
  not at all. Authentication delivers the guarantee the nonce was mistakenly credited with.
  The accepted residual (the asked admin may admit me to a different group than advertised)
  is stated in the Solution section and is inside the consent envelope. This decision
  reverses an earlier requester preference for exact match, made when both the
  unreachability of the nonce and the forgeability of the unauthenticated sender were not
  yet known.

- **DD-4 — The nickname travels inside the NIP-59 gift-wrapped rumor, never kind-0.**
  *Rationale:* CLAUDE.md's privacy invariant is absolute — no public kind-0, ever. The
  gift wrap is already addressed and encrypted to the admin alone, which the invariant
  explicitly permits. This is what makes the amended AC-8 implementable at all.

- **DD-5 — AC-INVITE-4 stands; the pending-invitation card is untouched.** The group name
  in an *unaccepted* Welcome is an unauthenticated, sender-chosen string, and rendering it
  would make the card a phishing surface. Invite-link users never see that card (they
  auto-accept), so the requester's goal is met without weakening it.
  *Rationale:* considered and explicitly rejected by the requester after the mechanism was
  surfaced.

- **DD-6 — The requester's nickname is untrusted display text.** It is attacker-chosen (any
  holder of the link picks their own). Two mitigations, both required:
  1. Capped at 32 UTF-8 bytes on **send and receive** — matching the existing cap in
     `ProfileContext.saveProfile` (`app/src/context/ProfileContext.tsx:52-58`). The
     receive-side cap is load-bearing: the sender is the attacker and cannot be trusted to
     have applied it.
  2. The truncated npub stays visible **alongside** the nickname in the admin's row — never
     replaced by it — so a requester naming themselves after someone else cannot
     impersonate them.

  *Rationale:* unlike AC-INVITE-4's case, the admin is making a decision *about this
  person*, so their claimed name is exactly the signal needed — but a claimed name must
  never be able to masquerade as an identity.

## Technical Approach

### Name gate — `app/src/components/groups/JoinRequestCard.tsx`

The card already renders the group name from the URL param at line 132 and gates on
hydration/identity at lines 43-59. Add a further gate, evaluated after those: when
`hasShareableName(profile.nickname)` (`app/src/lib/shareCard.ts:125` — the codebase's
single "does this user have a name" predicate, already reused by five call sites) is false,
render a name `<Input>` and keep the request button disabled.

On submit, the name is persisted through the existing `saveProfile`
(`app/src/context/ProfileContext.tsx:52-58`) chokepoint — which already applies the 32-byte
cap and avatar backfill — before `sendJoinRequest` fires. Do not write the nickname
anywhere else; `saveProfile` is the only writer.

### Nickname in the rumor + signed seal — `app/src/lib/marmot/joinRequestSender.ts`

Two changes to this file, both in S2/S3 territory (S2 adds the field, S3 signs the seal —
the planner may keep them together since they touch the same function):

1. **Nickname field.** `buildJoinRequestRumor` (lines 27-44) already emits
   `{ type: 'join_request', nonce, name: groupName }`. Add the requester's nickname as a new
   field. `name` is already taken by the group's name, so the new field must not reuse it —
   suggest `requesterName`.
2. **Sign the seal (S3).** `buildGiftWrap` (lines 56-112) currently builds the kind-13 seal
   by hand and never signs it — `sealWithId` gets an `id` but no `sig` (only the outer
   kind-1059 wrapper is signed, with the ephemeral key). Once `unwrapGiftWrap` enforces seal-
   signature verification (below), this unsigned seal would fail and every join request would
   be dropped. Sign the seal with the sender's real key before encrypting it into the wrapper.
   Prefer the proven `nostr-tools/nip59` seal/wrap helpers already imported by the DM path
   (`directMessages.ts`) over extending the hand-rolled construction — reusing the audited
   path is lower-risk than hand-signing. This makes the join-request sender npub unforgeable
   (AC-SEC-3).

### Handler — `app/src/lib/marmot/joinRequestHandler.ts`

`parseJoinRequestContent` must tolerate the field's absence (older clients, and any
attacker who omits it) and treat it as `undefined`. Replace the hardcoded
`nickname: undefined` (line 88) with the parsed value, capped per DD-6. The
`PendingJoinRequest` type (`nickname?: string`) already accommodates this — no schema
change.

### Admin row — `app/src/components/groups/PendingRequestsSection.tsx`

**Verify before editing:** the row at lines 30-41 *already* renders the truncated npub as
secondary text alongside the nickname — the `request.nickname ?? truncateNpub(npub)` at
line 34 is only the primary-name expression, not the whole row. DD-6's co-rendering
requirement therefore appears to be already satisfied structurally. S2's row work reduces to
confirming both are present once `nickname` is actually populated (it is always `undefined`
today, so the co-render path has never had real data). Do not rewrite the row on the
assumption the npub is missing; check first.

### Authenticated unwrap (both kinds) — `app/src/lib/marmot/welcomeSubscription.ts`

This is change 3 and a prerequisite for the auto-accept below. Today `unwrapGiftWrap`
(lines 40-68) returns `pubkey: rumor.pubkey ?? ''` with no seal-signature verification and
no `rumor.pubkey === seal.pubkey` check — the sender is attacker-controllable. Bring it to
the standard already set by `unwrapAndOpen` (`app/src/lib/directMessages.ts:230-274`):
verify the seal's schnorr signature (`directMessages.ts:250`), decrypt the inner rumor with
the *authenticated* seal pubkey, and assert `rumor.pubkey === seal.pubkey`
(`directMessages.ts:262`), rejecting on mismatch. Prefer reusing / sharing that helper over
duplicating the checks; the architect decides whether to call it directly or extract a
common core, but the semantics must match. The stale doc comment at `welcomeSubscription.ts`
lines ~199-211 asserting the rumor is signed must be corrected — NIP-59 rumors are unsigned;
it is the *seal* that authenticates.

**`unwrapGiftWrap` is shared by both dispatch paths** (kind 444 Welcome and kind 21059 join
request — the function unwraps first, then branches on `welcomeRumor.kind` at lines
165-194). The enforced verification therefore applies to **both** kinds. This is safe only
because the send-side seal-signing fix above lands with it: the Welcome seal is already
signed by the library, and the join-request seal becomes signed in `joinRequestSender.ts`.
The two must ship together — enforcing verification without the send-side fix would drop all
join requests (see the S3 dependency in Stories).

A message that fails authentication does **not** throw the whole subscription; it is treated
as an uncorrelated message (→ for a Welcome, the pending queue; for a join request, dropped
as today's malformed-input handling does) with its authenticated-sender status marked
false, so a spoofed sender can never satisfy the auto-accept condition below.

### Outbound record — `app/src/lib/marmot/outboundJoinRequests.ts` (new)

A small store of `{ nonce, adminPubkeyHex, groupName, sentAt }`, written when
`sendJoinRequest` succeeds. Mirror the existing sibling stores' conventions
(`joinRequestStorage.ts`, `inviteLinkStorage.ts` — both IndexedDB, keyed by a natural id;
key this one by `nonce`). The **correlation lookup is by `adminPubkeyHex`**, not by nonce
(the nonce never reaches the Welcome; see DD-3), so the store must support "is this
authenticated pubkey an admin I have an outbound record for." Needs a bounded size and an
expiry sweep: cap at 256 total records (consistent with `epic-walled-garden-v2`
AC-INVITE-3), and a TTL of **at least 7 days** — admin approval can legitimately lag by
days, so the TTL must not be shorter than the realistic approval window. An expired record
does not correlate.

### Authenticated-admin auto-accept — `app/src/lib/marmot/welcomeSubscription.ts`

At lines 191-238 the handler currently calls `enqueuePendingInvitation()` unconditionally.
After the authenticated unwrap above, insert the correlation check before that call:
auto-accept **iff** the unwrap authenticated the sender AND that authenticated seal pubkey
matches an unexpired outbound record's `adminPubkeyHex`. On match, run the shared join
logic and consume the record; otherwise enqueue exactly as today.

**Implementation note (not an open question — resolved):** `acceptPendingInvitation`
(lines 451-513) returns early unless the entry is already in the queue, so it cannot be
called for a Welcome that was never enqueued. Extract the join core
(`joinGroupFromWelcome` + record cleanup) into a shared helper that both the manual-accept
path and the auto-accept path call. Do not enqueue-then-immediately-dequeue as a shortcut —
that would briefly render the pending card and defeat the purpose.

### i18n — `app/src/lib/i18n.ts`

New keys for the name field label, its helper text, and the disabled-button state, in both
`en` and `de`. Follow the existing `copy.groups.joinRequest*` grouping (lines 155-161 /
775-782).

### Tests

- Unit: rumor round-trip with and without `requesterName`; the receive-side 32-byte cap;
  the join-request seal is signed and round-trips through the authenticated unwrap
  (a genuine request passes; a request with a forged `rumor.pubkey` that mismatches the seal
  is rejected); the authenticated-unwrap seal-signature + `rumor.pubkey === seal.pubkey`
  checks for both kinds (valid seal passes; forged/mismatched seal is rejected); correlation
  match/no-match on authenticated pubkey; record expiry past the TTL.
- E2E: `app/tests/e2e/groups-invite-link.spec.ts` currently boots both users with a
  nickname already set (lines 65-66), so the nameless path has never been exercised. Add a
  nameless-invitee case covering: gate blocks → name entered → admin sees the name → admin
  approves → invitee lands in the group **without a second click**. Per CLAUDE.md, drive
  the peer through the app's own publish helpers — never a raw WebSocket to strfry.

## Stories (suggested split — planner finalizes)

- **S1 — Name gate on the join card.** `JoinRequestCard` + i18n. Independently verifiable:
  a nameless user cannot request; a named user's card is unchanged.
- **S2 — Nickname to the admin.** Rumor field, handler parse + receive-side cap, confirm
  the admin row co-renders name and npub once the field is populated (DD-6).
- **S3 — Authenticated unwrap + signed join-request seal.** Two coupled changes that MUST
  ship together: (a) sign the join-request seal in `joinRequestSender.ts` so requests survive
  enforcement; (b) enforce seal-signature + `rumor.pubkey === seal.pubkey` in the shared
  `unwrapGiftWrap` for both kinds, and correct the stale "signed" doc comment. Enforcing (b)
  without (a) drops every join request — the planner must not split them across stories in a
  way that lets (b) land alone. This is a standalone security fix (it hardens the existing
  pending-card display AND makes the admin's approved npub unforgeable, AC-SEC-3) and a hard
  prerequisite for S4 — sequence it first among the auto-accept work.
- **S4 — Outbound record + authenticated-admin auto-accept.** New store, shared join-core
  extraction, `welcomeSubscription` correlation on the authenticated pubkey. Depends on S3.
- **S5 — E2E + AC-8 amendment.** Nameless-path e2e; amend
  `specs/epic-group-invite-links/acceptance-criteria.md` AC-8 and record it in that epic's
  `## Amendments`.

## Non-Goals

- Superseding ADR-002 or reopening the Walled Garden v2 security argument. Authenticated-
  admin correlation (DD-3) plus the authenticated unwrap (change 3) keep ADR-002 intact, so
  neither is necessary.
- A general audit of every gift-wrap unwrap site in the codebase. This epic hardens the two
  kinds that flow through `unwrapGiftWrap` (Welcome and join request), because auto-accept
  and AC-SEC-3 depend on them. Other unwrap sites elsewhere in the app are out of scope
  (flag any found to the backlog).
- Weakening AC-INVITE-4 (DD-5).
- Resolving nicknames or avatars from kind-0, here or anywhere. The privacy invariant
  forecloses it.
- Retrofitting a name gate onto any other entry point.
- Changing what the admin can do with a request (approve/deny is untouched).

## Amendments

**Amendment 1 (2026-07-16) — group-matched auto-accept.** During S4 review it emerged that
the Welcome's group name is reliably readable pre-join (we built `readPreJoinGroupName` for
disambiguation and proved it against real marmot-ts; the read is verified side-effect-free).
This was not known to be available when DD-3 chose admin-level match over exact match. AC-AUTO-4a
is amended so auto-accept matches the **group** as well as the admin whenever the group name is
readable — a same-admin Welcome for an unrequested group now goes to the pending queue instead
of silently auto-joining and consuming the wrong outbound record. The pure admin-level match
survives only as a fallback when the group name cannot be read (single-candidate case). This
narrows the DD-3 residual; it does not widen any auto-accept path. Requester-approved.
