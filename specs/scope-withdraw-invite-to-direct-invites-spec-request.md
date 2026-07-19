# Invite Rescind and Member Removal

> **Status:** request / pre-spec. Hand to `/base:feature` to produce the
> implementation spec + acceptance criteria.
>
> **Requester decisions are locked** (§1.1). Search "DECISION:" for the specific
> locked choices. This request was hardened by two review passes; §6 records the
> findings folded in.

## 1. Intent

The group invite/join lifecycle must present **exactly one confirmation per
side**, each placed at the moment that party expresses intent:

| Side | Single confirmation | When it appears |
|------|--------------------|-----------------|
| Scanning/clicking party (invitee) | **"Request to Join"** | On opening the invite link/QR — clicking implies interest |
| Inviting party (admin) | **"Approve"** | Once a join request is pending |

After the admin approves, the new member is admitted and the rest of the flow is
automatic. On the member list, an admin has two removal affordances that share
one MLS operation but differ in framing:

1. **Cancel Invite (rescind)** — withdraw a *direct* invitation the invitee has
   not yet accepted. The admin's mirror of the invitee's **Decline**. Shown only
   on a pending direct-invite row.
2. **Remove Member** — evict any other in-tree member. A deliberate, separately-
   confirmed action, always available to an admin. **This affordance does not
   exist today** and must be added; it is the universal eviction fallback.

Both call the same MLS remove (`cancelPendingInvitationImpl`'s remove path). The
distinction is **labeling only** — which framing the admin sees — not capability.

### The defect being fixed

"Cancel Invite" (`MemberList.tsx:305`) is shown for any member who is *in the MLS
tree but has not broadcast their own signed profile yet* (`cancelInvitationImpl.ts:36`
`isPendingMemberImpl`; `groups.tsx:300-311`). That predicate is true for **two
different populations**:

1. **Approved join-requesters, catching up.** Approval admits them instantly;
   their real profile round-trips a few relay hops later. During that window the
   admin sees the *rescind*-framed "Cancel Invite" on someone already admitted.
   - For a requester **who set a nickname**, the approve path seeds a
     `provisional` profile (`MarmotContext.tsx:538`), so `isPendingMemberImpl`
     already returns false and clicking is a **silent no-op** — but the wrong
     label is still shown.
   - For a **nameless** requester, no provisional profile is seeded, so clicking
     performs a **real MLS eviction** under the *rescind* label
     (`cancelInvitationImpl.ts:79-95`). The mislabeled footgun.
2. **Directly-invited people who have not accepted yet.** Here the rescind
   framing is correct — the mirror of the invitee's Decline (`PendingInvitations.tsx`).

The code cannot tell these apart because it keys off "no profile yet," true for
both. It also has no concept of "remove a confirmed member" at all.

### 1.1 Locked decisions

- **DECISION (rescind scope):** the "Cancel Invite" (rescind) affordance appears
  **only** on a member who entered via a **pending outbound direct invite** that
  has not yet been accepted. Never on approved join-requesters; never on
  confirmed members.
- **DECISION (rescind mechanism):** the pending-direct-invite state is recorded
  by an **explicit positive marker** written at direct-invite time — *not*
  inferred from the presence/absence of a `provisional` profile (a nameless join
  request seeds no provisional profile, so inference would still show the rescind
  label on it).
- **DECISION (remove member — universal):** add a **Remove Member** affordance
  visible for **any in-tree member** (pending or confirmed), not-yourself,
  admin-only. It is the always-available eviction fallback and reuses the
  existing MLS remove operation. A row that qualifies for the rescind label shows
  "Cancel Invite" *instead of* "Remove Member" (mutually exclusive per row); every
  other in-tree member shows "Remove Member".
- **DECISION (marker is local-only, cosmetic):** because Remove Member is
  universal, eviction never depends on the marker reaching another admin. The
  marker therefore drives **label selection only** and is **local to the admin
  who sent the invite**. **No broadcast, no new MLS message type.** A co-admin who
  does not have the marker simply sees "Remove Member" on that pending row instead
  of "Cancel Invite" — fully functional, different wording. (This supersedes an
  earlier "broadcast to co-admins" decision, which universal Remove Member makes
  unnecessary.)

## 2. Behavior

### 2.1 Recording a pending direct invite (the marker)

The two direct-invite entry points both already call `inviteByNpub`:

- `InviteMemberModal` → `submitInvite` (`InviteMemberModal.tsx:192`).
- Profile page → `handleAddToGroup` (`profile.tsx:554`).

When either admits a pubkey:

1. **Write the marker (best-effort) before the invite**, then invite. The write
   is best-effort: if the local marker write throws (IDB quota/transient), **log
   and proceed with the invite anyway** — a local-storage failure must never
   block a real invitation (same precedent as `incrementInviteLinkUsage` in
   `approveJoinRequestImpl`, `MarmotContext.tsx:566`). A missing marker only
   costs the nicer "Cancel Invite" label; the row still shows "Remove Member".
2. **If `inviteByNpub` fails, clear the marker** (see §2.2). A marker for an
   invite that never went out must not linger.

The **approve-join-request path** (`approveJoinRequestImpl`,
`MarmotContext.tsx:492`) also calls `inviteByNpub` but **must not** write the
marker — approved requesters are members, not pending direct invites.

### 2.2 Marker persistence & lifecycle

- **Persisted** in a dedicated idb-keyval store (precedent: `memberProfileStore`
  `groupStorage.ts:30`; `joinRequestStorage.ts`), keyed `groupId:pubkey`, so the
  "Cancel Invite" label survives reload. Persistence is a nicety, not a
  correctness requirement (a lost marker degrades to the "Remove Member" label).
- **Cleared** when any of:
  - the direct **invite call fails** (§2.1 step 2).
  - the invitee's **own signed profile** arrives — a profile event whose author
    (`signedEvent.pubkey`) equals the marked pubkey — merged at `profileHandler.ts`
    `mergeMemberProfile`. Must be the invitee's *own* event, not a peer relaying a
    cached profile (see §6 F5).
  - the member is **removed** (Cancel Invite or Remove Member), or leaves the tree.
  - the group is left/deleted (`clearAllGroupData`, `groupStorage.ts:112`).
- Not included in relay backup — a marker lost on device restore only changes a
  label.

### 2.3 Label selection on the member list

For each in-tree member row that is **not yourself** and where the viewer is an
**admin**, show exactly one affordance:

- **"Cancel Invite"** iff a pending-invite marker exists for this `groupId:pubkey`
  **and** the member is still pending (in the MLS tree AND no confirmed/own
  profile). This is the rescind framing.
- **"Remove Member"** otherwise (confirmed members, and any in-tree member without
  a marker — including an approved join-requester still catching up).

The "still pending" leg wires into the existing `confirmedPubkeys`-style
derivation in `groups.tsx` (the `confirmed` Set at `groups.tsx:300-311`, consumed
by `MemberList.tsx:100`) — **not** a new per-row async call to `isPendingMemberImpl`
(§6 F5). Both labels invoke the same removal path; only the button text and
confirm-dialog copy differ.

### 2.4 Removal execution (shared path)

Both affordances execute the existing MLS remove via a **shared removal helper**
(strip the pubkey from `adminPubkeys` if present, propose Remove, commit, persist,
reload — `cancelPendingInvitationImpl`, `cancelInvitationImpl.ts:50-126`).

- **Confirm dialogs differ by framing:** "Cancel this pending invitation?" for
  rescind; "Remove this member from the group?" for Remove Member. Distinct i18n
  keys, en + de.
- **Per-member profile purge on removal.** On a removal that actually leaves the
  pubkey no longer a member, purge that pubkey's stored profile entry, so a later
  re-invite does not look confirmed (§3 re-invite edge). This requires a
  **per-member profile purge** (only a whole-group `clearMemberProfiles` exists
  today). **Gate the purge on "this pubkey is confirmed no longer in the tree,"
  not on "this client performed the commit"** — so it also runs on the
  `raceDetected` short-circuit path (`cancelInvitationImpl.ts:56-63`, `:80-83`)
  where a concurrent co-admin already removed them (§6 F3). The marker is cleared
  on the same condition.

### 2.5 Invitee side — unchanged

Request to Join / Accept / Decline are untouched.

## 3. Edge cases

- **Nameless approved join request:** no marker → shows "Remove Member" (correct,
  deliberate), never the rescind label. The case that rules out provisional-
  inference.
- **Named approved join request:** already a silent no-op today under the old
  button; now shows "Remove Member" instead of the mislabeled "Cancel Invite".
- **Approved requester still catching up:** in tree, no own profile yet, no marker
  → shows "Remove Member". An admin *can* remove them (deliberate), but there is
  no redundant rescind prompt — honoring "the rest of the flow is automatic."
- **Re-invite of a former full member:** a removed member's non-provisional
  profile would otherwise persist and make them look confirmed on re-invite.
  Resolved by §2.4's per-member profile purge on removal (including the race
  path), so a re-invited former member is pending again and shows "Cancel Invite".
- **Direct invitee who never accepts:** marker persists; the inviting admin sees
  "Cancel Invite"; any co-admin sees "Remove Member". Either way the row is
  manageable — no stuck-unremovable state.
- **Direct invite where the marker write fails:** invite proceeds; the row shows
  "Remove Member" instead of "Cancel Invite". Functional, degraded label only.
- **Decline is not observable to the admin** (`declinePendingInvitation`,
  `welcomeSubscription.ts` only deletes locally). A declining invitee stays in the
  MLS tree until an admin removes them (via either affordance). Stated as fact.

## 4. Out of scope

- The contact-picker UX for `InviteMemberModal` — already shipped
  (`epic-invite-group-member-from-contacts`, `epic-invite-contact-picker-redesign`).
- The invitee-side flow (Request to Join / Accept / Decline) — unchanged.

### Adjacent open finding (keep consistent, do not fix here)

`BACKLOG.json` finding `invite-modal-picker-cannot-re-invite` — the invite picker
shows an already-invited-not-accepted contact as a disabled "already in group"
with no resend path. That is the *same population* this feature marks. The marker
introduced here is the natural state a future resend path would key off; keeping
the marker cleared on invite failure (§2.2) ensures a resend feature would never
see a marker for an invite that never went out. Fixing the picker's resend
affordance is **not** in scope for this epic.

## 4a. ADR alignment

- **ADR-006** (group-member-attested authorization for MLS application-message
  mutations) and **ADR-003** (LWW for MLS metadata mutations) govern the MLS Remove
  used by both affordances. This feature conforms by **reusing the existing remove
  path** in `cancelPendingInvitationImpl` and introduces **no new MLS message type
  and no new authorization or metadata-mutation model** (the co-admin broadcast
  that would have added one was dropped by §1.1's local-only decision).

## 5. Testing

E2E lives in the **groups/relay bucket** (`app/tests/e2e/groups-*.spec.ts`,
Docker relay). Publishes go **through the app**, never raw WebSocket. The
definitive gate is the full `make test-e2e-all` suite. Required scenarios:

1. **Approved join-requester shows "Remove Member", never "Cancel Invite".** Admin
   approves a join request; the new member row shows the Remove-Member affordance
   (not the rescind one) at all points, including before their profile round-trips.
   **Close the invitee's browser context before approving** — an open invitee
   context auto-accepts the Welcome and fast-propagates the real profile, masking
   the window (documented trap).
2. **Nameless join request → "Remove Member", never "Cancel Invite"** (the
   provisional-inference regression guard). A join request with no nickname is
   producible (`joinRequestStorage.ts:28`, `nickname?` optional).
3. **Direct invite → "Cancel Invite" shows → flips to "Remove Member" on accept.**
   Admin directly invites a contact (both via `InviteMemberModal` and via the
   profile page). The row shows "Cancel Invite" while pending; after the invitee
   accepts and their own profile arrives, the row shows "Remove Member". (Direct
   invite is picker-only over existing contacts — `InviteMemberModal.tsx:178-182` —
   so first establish the contact through the app's pairing flow, as `dm-*` specs
   do.)
4. **Cancel Invite works end-to-end.** Click "Cancel Invite" → confirm → the
   pending invitee is evicted. Proves the refactor preserved eviction.
5. **Remove Member works end-to-end.** A confirmed member is removed via the new
   affordance and disappears from both admins' member lists.
6. **Marker survives reload.** After a direct invite, reload the admin — the row
   still shows "Cancel Invite" for the pending invitee.
7. **Co-admin sees a usable affordance.** Admin A directly invites; admin B
   (co-admin, no marker) sees "Remove Member" on that pending row and can remove
   the invitee. (Proves universal Remove closes the stuck-unremovable hole without
   a broadcast.)
8. **Re-invite of a removed member shows "Cancel Invite" again** (proves the
   per-member profile purge). Remove a confirmed member, re-invite them directly;
   the row is pending again, not confirmed.

## 6. Review findings folded in

- **F1** (blocker, review 1): "Remove Member" did not exist; Cancel Invite was the
  sole eviction control. → §1.1 DECISION (remove member — universal), §2.3, §2.4.
- **F2** (review 1): marker was local-only and co-admins blind. → resolved
  structurally by universal Remove (§1.1 marker local-only); the broadcast is
  dropped, not patched.
- **F3** (review 1): persistence location unspecified. → §2.2 dedicated store +
  cleanup.
- **F4** (review 1): visibility must be a conjunction; write ordering. → §2.3
  conjunction; §2.1 best-effort write-before-invite.
- **F5** (review 1): clear-on-profile keys on the invitee's *own* authored event.
  → §2.2.
- **F6** (review 1): original defect text overstated eviction risk for named
  requesters. → §1 corrected (silent no-op today).
- **F7** (review 1): re-invite of a former member looked confirmed. → §2.4
  per-member profile purge (race path included).
- **F8** (review 1): decline is never observable. → §3 stated as fact.
- **F9** (review 1): e2e masking trap + missing scenarios. → §5.
- **V1** (review 2, HIGH): confirmed-only Remove contradicted the co-admin-sync
  fallback. → resolved by §1.1 universal Remove + local-only marker.
- **V2** (review 2): marker orphaned on failed invite. → §2.1 step 2 / §2.2
  clearing trigger.
- **V3** (review 2): profile purge unspecified on the race-detected removal path.
  → §2.4 purge gated on "no longer in tree," runs on the race path.
- **V4** (review 2): marker-write-failure behavior. → §2.1 best-effort (log +
  proceed).
- **V5** (review 2): §2.3 wired into the existing `confirmedPubkeys` derivation,
  not a new per-row async call.
