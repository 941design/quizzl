# Direct-Contact Profile Exchange (self-healing, pull-based)

> **Status:** Implementation spec. Complements `epic-contact-pairing-code`
> (mutual admission) and `epic-contact-card-exchange` (name-in-card).
> The four §9 open items and two validator gaps are resolved in
> `## Resolved Decisions` below; treat that section as authoritative where it
> refines the body.
>
> **Rev 3** — requester locked the three carried decisions: **archiving a
> contact revokes all profile exchange** with them (Q7 → the answer/accept gate
> now requires an *active, non-archived* contact, since `knownPeers` is
> append-only and cannot be un-set; §3.3, §3.5); **profile edits propagate** —
> announce-on-change and announce-on-pair are **in scope** (Q3; §3.6); and the
> never-responding schedule **gives up after a 30-day ceiling** (D5; §3.2).
>
> **Rev 2** — incorporates a cold-eyes design review (code-verified). Three
> blockers closed in the text: the announce **receive path is now gated** and
> its accidental contact-injection side effect neutralized (§3.5, §B1); the
> announce **`updatedAt` is pinned to answer-time** so LWW cannot reject the
> healing message (§4, §B2); and **strict sender-binding on unwrap** is promoted
> to a hard requirement, not an aside (§5, §4.2, §B3). Several Rev-1 claims were
> **false** and are corrected (avatar-null is not a "never-announced" signal;
> the disclosure boundary is broader and stickier than "accepted contacts"; the
> reinstall scenario as written cannot occur). Search "REVIEW:" for dispositions.

## 1. Intent

Direct (1:1) contacts today have **no channel to exchange profile metadata**.
Two people who are contacts but share no MLS group never learn each other's
**avatar** at all, and learn each other's **name** only from the one-time name
embedded in a contact card at pairing. Concretely, on the current build:

- A contact added from a card gets the issuer's **name** but never their
  **avatar** (the card format carries no avatar — `HAS_AVATAR` is reserved-0).
- The reverse direction is worse: when a scanner pairs with an issuer, the
  issuer decodes the scanner's name from the pairing-ack but **never persists
  it** (`pairingAck.ts#handlePairingAck` calls `rememberContact` but not
  `importCard`) — see §10.1, a related bug this feature's receive path subsumes.
- **Nothing self-heals.** An already-formed contact with a missing profile
  stays missing forever: a name/avatar only ever flows when the *owner* acts
  (shares a card, or — in a group — changes their profile), and an existing
  contact provides no such trigger. The installed base is full of
  npub-connected contacts whose profiles were never fully exchanged.

This feature adds a private, self-healing profile channel for direct contacts:
each client **requests** the profile of any contact it is missing, on a
**periodic exponential backoff starting at 1 hour**, and **answers** such
requests — but only for peers it has already accepted. Over time every
mutual relationship converges to a complete `{name, avatar}` with no manual
action by either party.

### 1.1 Outcome (behaviour)

- Open your contact list and any *mutual* contact showing a bare key / no avatar
  fills in — name and avatar — within the backoff window, without you or the
  other person doing anything.
- A contact who was offline when you first needed their profile heals when they
  next come online (the request keeps retrying on a decaying schedule).
- **Disclosure boundary (stated precisely — REVIEW B4, LOCKED Q7).** You answer
  a profile request (and accept an announce) only from a pubkey that **both**
  passes the app's allowed-sender gate (`isAllowedDmSender` = any current MLS
  group co-member ∪ `knownPeers`) **and** is an **active, non-archived contact**.
  The second clause is the locked Q7 decision: archiving/hiding a contact stops
  all profile exchange with them in every direction. It is a distinct check
  because `knownPeers` is **append-only** (`knownPeers.ts` has no removal API),
  so `isAllowedDmSender` alone would keep disclosing to an archived peer forever;
  archive is the per-contact suppression signal (§3.3, §8). There is no separate
  "block list" today — archive is the app's hide/remove action; any future block
  feature must feed the same exclusion.
- **Convergence holds for mutual adds.** A purely one-sided add (you added them
  by npub; they have no record of you) does **not** heal: they won't answer a
  requester who isn't in their allowed set, and that is the correct
  non-disclosure outcome — but §1's "installed base converges" promise is
  therefore about *mutual* relationships (REVIEW B4).

### 1.2 Non-goals (this iteration)

- **No profile exchange with strangers.** A profile request from — or an
  unsolicited announce sent by — a pubkey that is not an established contact is
  **ignored** (§3.3, §3.5). There is deliberately **no** "answer/accept anyone"
  mode.
- **No public discovery / no public kind-0.** This never publishes profile data
  to an unaddressed audience (§7). It is not a NIP-05 / relay-based lookup.
- **No new avatar hosting or image transfer.** An avatar is a short CDN URL
  string (`//few.chat/assets/<uuid>.png`), transmitted as text.
- **No change to group profile sync.** The MLS group profile protocol
  (`profileSync.ts`, `PROFILE_RUMOR_KIND = 0`) is untouched. This is a 1:1 analog
  on a different transport and must not be conflated with it (§4 namespace note).
- **Push companions are IN SCOPE (LOCKED Q3).** In addition to the pull/heal
  loop, the app pushes an announce to its **active contacts when the local
  profile changes** (so renames/avatar edits propagate to 1:1-only contacts,
  which pull-only would freeze at one snapshot forever) and to a **fresh contact
  at pairing** (so a new contact is instant, not "wait up to an hour"). Same
  message, same active-contact-gated audience (§3.6).

### 1.3 Why a gift-wrapped message, not an ad-hoc MLS group (rejected alternative)

An earlier proposal was to auto-create a hidden 2-member MLS group per contact
to piggyback on group profile-sync. Rejected, with mechanism:

- **It reintroduces the KeyPackage dependency the pairing flow exists to
  avoid.** Inviting a peer to an MLS group requires their published, unused
  KeyPackage on a relay (single-use, consumed on join). A gift wrap needs only
  the peer's pubkey, which you always have.
- **It imports the entire MLS lifecycle per contact** — commit + Welcome +
  mandatory post-join self-update, then perpetual epoch/key-rotation state — to
  move two text fields. A gift wrap is stateless addressed mail.
- **Both sides creating the group yields two un-mergeable groups** (no dedup in
  MLS); a gift wrap has no creation step, so symmetry is free.
- **The thing it would "reuse" does not exist to reuse.** Marmot's group profile
  is the *group's* admin-set identity, not a member describing themselves; there
  is no per-member personal-profile component. You would build this message type
  anyway, inside a far heavier container.

## 2. Behaviour changes & consequences (read first)

- **New background traffic.** Every client periodically sends small gift-wrapped
  requests for each contact whose profile it lacks, and small gift-wrapped
  answers in response. Volume is bounded by the incomplete-contact count and
  decays per contact via backoff (§3.2). Requests **must be jittered and, on a
  bulk sweep, staggered** so an app-start / post-upgrade / laptop-resume sweep
  does not stampede a relay (§5).
- **A stranger cannot inject a contact or poison a profile.** The receive path
  is gated (§3.5) and unwrapped strictly (§4.2); without both, the naive landing
  primitive would add attacker-chosen entries to your contact list (REVIEW B1).
- **Archiving a contact does not currently stop you answering them.** §3.2 stops
  *your outbound requests* on archive, but nothing stops *your answers* to a
  request from an archived/ever-known peer. If archive is meant to mean "stop
  disclosing to this person," that is a change to make deliberately (§9 Q7).
- **Old builds are inert, not broken.** A peer on a build without this feature
  never answers (its inbound dispatch fails closed on the unknown kind — no
  chat bubble, no bell; §4, §6). The requester keeps retrying on the decaying
  schedule and heals if/when that peer updates (§3.2 no-give-up).

## 3. How it works (end to end)

Actors: **R** = requester (missing a contact's profile), **O** = owner (the
contact whose profile R wants). Every message is a NIP-59 gift wrap (kind-1059)
addressed to one pubkey, sender hidden by an ephemeral key — `sealAndWrap` /
`unwrapAndOpen` in `directMessages.ts`, the same primitives the pairing-ack
reuses. **All unwrapping uses `unwrapAndOpen` ONLY** (§4.2).

1. **R detects an incomplete contact** (§3.1) and schedules a
   **profile-request** (§3.2 backoff).
2. **R sends a profile-request** gift-wrapped to O:
   `{ type: 'profile-request', since?: <iso> }`. No target field — the wrap is
   addressed to O, so "send me *your* profile" is implicit. (Not the group
   relay-on-behalf request, which carries a `targetPubkey`.)
3. **O receives + strictly unwraps** the request (`unwrapAndOpen` → authenticated
   `rumor.pubkey === seal.pubkey`), routes by inner kind (§4).
4. **O answers — only if R passes the allowed-sender gate** (§3.3). O first runs
   `ensureAvatar` on its own profile (so it can never answer `avatar: null` —
   REVIEW G3), then replies with a **profile-announce** gift-wrapped to R:
   `{ type: 'profile-announce', nickname, avatar: { imageUrl }, updatedAt }`
   with `updatedAt` = **answer time** (§4). If R is not allowed, O **ignores**
   the request silently. O rate-limits answers per requester (§3.3).
5. **R receives + strictly unwraps the announce, gates it, then stores it**
   (§3.5). On an accepted, completing write, R **clears that contact's backoff
   schedule**; the name+avatar render in the contact list with no UI change.

### 3.1 What "incomplete profile" means (the heal trigger)

- **DECIDE (D1): incomplete = no contactCache entry, OR an entry whose `avatar`
  is `null`.** Rationale: contact cards / pairing-acks never carry an avatar, so
  an `avatar: null` entry usually means no real announce has landed yet.
- **REVIEW G1 (correction): `avatar: null` is NOT a reliable "never announced"
  signal.** Group profile sync legitimately writes `avatar: null` for a peer
  whose own profile lacks one (`profileSync.ts#buildPayloadJson` /
  `payloadToMemberProfile`), and legacy/other-client peers may genuinely have no
  avatar. Left naive, such a contact is "incomplete" forever: requested forever,
  answered `null` forever, schedule never cleared.
- **Resolution (REVIEW G2/G3):**
  - Because O runs `ensureAvatar` before answering (§3.step4), a *Few* peer can
    never answer `avatar: null`; so treat an announce with `avatar: null` (or
    missing) as **malformed** and ignore it (do not store, do not clear
    schedule).
  - Introduce an explicit **"answered-but-still-incomplete"** state for a
    contact from whom a *valid* answer arrived that nonetheless left the avatar
    empty (only reachable from a non-Few/legacy peer): move it to a **long
    terminal cadence** (or drop it from the periodic loop entirely) rather than
    re-requesting at the floor — otherwise D4 (§3.2) turns it into an hourly
    request/answer ping-pong with an active peer.
- Own pubkey, archived contacts, and any pubkey not in the contact list are
  excluded from the incomplete set.

### 3.2 Request schedule (per contact, persisted)

- **Exponential backoff starting at 1 hour** (locked parameter):
  `1h → 2h → 4h → 8h → 16h → 24h`, **capped at 24h**, then repeating at 24h,
  each fire time carrying **±jitter** (DECIDE D2: propose ±20%).
- **DECIDE (D3): first request fires after the initial 1h interval, not
  immediately** — faithful to "starting at one hour," and it spreads the
  installed-base backlog. (This is the correct call **only if announce-on-pair
  ships**, §9 Q3; otherwise a fresh pairing shows no avatar for up to an hour.)
- **Persist per-contact schedule** `{ pubkeyHex, attempts, nextAttemptAt, state }`
  in idb-keyval (like other pairing/DM state) so a restart resumes the backoff.
  On load, **clamp `nextAttemptAt` to `now + cap`** so a backwards wall-clock
  jump cannot freeze a schedule (REVIEW G5).
- **Reset on positive reachability (DECIDE D4, recommended, with exclusions):**
  reset a contact's backoff to the 1h floor when an inbound gift-wrapped event
  is observed from them — **except** a profile-announce receipt (REVIEW G2:
  otherwise answer→reset→re-request loops), and rate-limited to at most one
  reset/contact/day so a chatty active peer cannot pin the backoff at the floor.
- **30-day give-up ceiling (LOCKED D5):** stop the periodic loop for a contact
  once its total attempt span reaches **30 days** with no completing answer,
  rather than retrying at the 24h cap forever. This bounds the dead-end traffic
  whose main feeder is the one-sided-add population (REVIEW B4). A given-up
  contact is **re-armed** (schedule restarted at the 1h floor) if a D4
  positive-reachability signal later arrives from them (§3.2 reset rule) — so a
  peer who returns or upgrades after the ceiling still heals on next contact.
- **Clear the schedule** for a contact **only on an *accepted, completing*
  announce write** — i.e. the write passed LWW *and* the entry now has a
  non-null avatar (REVIEW B2). This reconciles the Rev-1 inconsistency (§3.2
  said "complete," AC said "any"). Because `writeContactEntry` returns `void`,
  the receive path must peek the LWW predicate (as `importCard` already does) or
  gain a return value to know the write landed. Also clear on archive/remove.

### 3.3 Answering a request (the one hard gate)

- **Answer a profile-request only if the authenticated requester passes
  `isAllowedDmSender` AND is an active, non-archived contact** (LOCKED Q7).
  Non-allowed **or** archived/hidden → **no answer, no error.**
- **REVIEW B4 — the gate's semantics:** `isAllowedDmSender` = (member of any
  currently-joined MLS group) ∪ (`knownPeers`, **append-only** — `knownPeers.ts`
  has no removal API). Group co-members you never individually accepted are still
  answered (defensible — they already get your profile via group sync and can DM
  you). The archived-contact exclusion is enforced by an explicit
  active-contact check *on top of* `isAllowedDmSender`, because archive cannot
  remove a pubkey from `knownPeers`. Archive is checked via the contact store
  (`archivedAt != null`, `contacts.ts`).
- This differs deliberately from the pairing-ack, which *bypasses* the gate
  because nonce possession is its authorization. A bare request carries no token;
  its authorization is the pre-existing accepted relationship = this gate.
- **Rate-limit answers per requester** (REVIEW G6): cooldown ≥ the 1h floor,
  in-memory is sufficient. Amplification is structurally bounded regardless —
  one request yields at most one answer, and an announce never triggers an
  announce (no loop topology).

### 3.4 The requester/owner with no name of their own

- **Requesting needs no local name** (reveals only R's pubkey, already known to
  O). **Answering requires a shareable name** (`hasShareableName`): a nameless
  (onboarding) O defers answering until named, mirroring the card-share gate.

### 3.5 Receiving an announce (gated — REVIEW B1, blocker)

The naive receive path is a **contact-injection / impersonation vector** and
must be closed:

- **Gate on the authenticated sender.** Accept and store an announce **only when
  the strict-unwrapped sender (`rumor.pubkey`, §4.2) passes `isAllowedDmSender`
  AND is an active, non-archived contact already in the stored contact list**
  (same gate as §3.3, LOCKED Q7). An announce from anyone else — stranger, or a
  contact you have archived/hidden — is dropped: not stored, no schedule touched.
  (Rev 1 gated only the *request* direction. Without this, any pubkey can
  gift-wrap you an announce; and without the archived clause, a hidden contact's
  push-on-change would still update your cache.)
- **Neutralize the landing side effect.** `writeContactEntry`
  (`contactCache.ts`) unconditionally calls `rememberContact(...)` with **no**
  allowed-sender gate — i.e. writing a cache entry silently *creates a contact*
  in `lp_contacts_v1`, which `listContacts` then renders. The receive path must
  **not** let an inbound announce create a new contact: either write the cache
  entry without the `rememberContact` side effect for this path, or require the
  contact to pre-exist (the gate above) and treat a not-yet-contact announce as
  drop. A janitor (`purgeStrangerContacts`) is not a security boundary.
- **Impersonation:** because the store is keyed by the **authenticated** sender
  (§4.2), a forged announce claiming to be from one of your contacts is rejected
  at unwrap — provided §4.2's strict primitive is used. This is why §4.2 is a
  hard AC, not a note.

### 3.6 Push triggers — propagate edits & make new contacts instant (LOCKED Q3)

The announce message is also emitted unprompted on two events, so complete
contacts stay current and fresh ones are immediate (pull alone would freeze a
1:1-only contact at one snapshot and delay a new one by up to the 1h floor):

- **On local profile change** (nickname or avatar edited): send an announce to
  **every active, non-archived contact**. This is the 1:1 analog of
  `MarmotContext#publishProfileUpdate`, which already fans a group profile rumor
  to all groups on edit; here it fans a gift-wrapped announce to all direct
  contacts. Audience is the same active-contact-gated set as §3.3 — archived/
  hidden contacts are **excluded** (they get nothing, consistent with Q7). Fan-out
  is N small gift wraps for N active contacts, **staggered/jittered** like the
  sweep (§5) to avoid a burst.
- **On pairing** (a new contact is admitted — scanner side after add, issuer side
  after `handlePairingAck` admission): send an announce to that one new contact
  so their avatar appears at once rather than after the first backoff interval.
  This is what makes D3's "first request after 1h" acceptable (§3.2).
- These are **the same message, receive path, and gate** as the pull response —
  no new kind, no new handler. A received push-announce is stored via §3.5
  exactly like a solicited one (gated, strict-unwrapped, LWW), and it clears/
  updates any pending schedule for that contact.
- **Privacy:** unchanged — each announce is gift-wrapped to one active contact;
  no broadcast, no disclosure to archived/hidden or non-contacts.

## 4. Message formats (two new inner rumor kinds)

Both are inner rumors inside a kind-1059 gift wrap.

```
profile-request  rumor kind = PROFILE_REQUEST_KIND   (propose 21061)
  content JSON: { type: 'profile-request', since?: <iso-8601 string> }
  tags: [['p', <owner pubkey>]]

profile-announce rumor kind = PROFILE_ANNOUNCE_KIND  (propose 21062)
  content JSON: { type: 'profile-announce',
                  nickname:  <string>,
                  avatar:    { imageUrl: <string> },   // null/absent ⇒ malformed, ignored (§3.1)
                  updatedAt: <iso-8601 string> }        // = ANSWER TIME (§B2)
```

- **`updatedAt` = answer-time (REVIEW B2, blocker).** It MUST be stamped at
  serialization (as `profileSync.ts#buildPayloadJson` does:
  `new Date().toISOString()`), **not** the profile's last-edit time. Reason:
  card imports write the cache entry with `updatedAt` = the card's `created_at`,
  which is often *later* than the owner's last edit; a last-edit `updatedAt`
  would lose LWW to the card and `writeContactEntry` would silently no-op — the
  healing announce would never land, and (Rev 1) the schedule would clear anyway.
  Answer-time also keeps this channel's LWW commensurable with group sync, which
  writes the same store.
- **Kind isolation (mandatory).** Before landing, grep `app/src app/tests` and
  confirm the numbers collide with none of the in-repo sentinels: 444, 21059
  (Welcome / join-request — **also `CALL_GIFT_WRAP_KIND`**), 5, 7, 14, 21060
  (pairing-ack), 20602 (card-sig v2), 9, 13 (seal), and the **call-signaling
  inner kinds 25050–25055** (`callSignaling.ts` / `IncomingCallWatcher.tsx`) —
  REVIEW added the last two groups; Rev 1's list was incomplete. Add a
  module-load assertion as `pairingAck.ts` does. (21061/21062 verified unused
  today.)
- **Namespace note — do NOT reuse `PROFILE_RUMOR_KIND = 0`.** That is the *MLS
  application-rumor* kind for group profile sync — a different transport;
  kind-0 inner gift-wrap rumors are ambiguous with NIP-24 metadata and would not
  fail closed cleanly in the existing consumers.
- **Exclude both kinds from chat rendering and the notification bell**, asserted
  with tests, in **both** 1:1 consumers: `ContactChat.tsx`'s live subscription
  and `directMessageNotifications.ts` (the bell). (REVIEW: Rev 1 mis-cited
  `architecture_marmot_dual_listener` — that memory is about the **MLS group**
  rumor stream, MarmotContext + ChatStoreContext, not the 1:1 gift-wrap stream.)

### 4.1 Authenticity: the announce is unsigned by design (privacy choice)

- The announce payload is **unsigned**; authenticity comes solely from the
  gift-wrap sender-binding (§4.2). The recipient keys the stored profile under
  that authenticated sender.
- **Deliberate divergence** from the group serializer (`serialiseProfileUpdate`,
  signed kind-0 envelope). The group needs the inner signature for
  *relay-on-behalf*; 1:1 has none (sender = subject), so the signature is
  unnecessary — and a signed kind-0 handed to a recipient is a *publishable*
  profile event a buggy/hostile recipient could launder onto a public relay as
  your kind-0, violating "no public kind-0" on your behalf. Unsigned-over-
  authenticated-wrap forecloses that. DECIDE (D6): confirm.

### 4.2 Strict unwrap only (REVIEW B3, blocker)

- Request and announce MUST be unwrapped via **`directMessages.ts#unwrapAndOpen`
  only** — never `welcomeSubscription.ts#unwrapGiftWrap`. Verified: `unwrapAndOpen`
  checks the seal's schnorr signature, decrypts under the authenticated
  `seal.pubkey`, asserts `rumor.pubkey === seal.pubkey`, and validates the
  canonical rumor id. `unwrapGiftWrap` does **none** of that and keys off an
  attacker-settable `rumor.pubkey`. Routing the announce arm through the lenient
  path (the path of least resistance, since §5 names that dispatch loop) lets any
  sender forge `rumor.pubkey` = one of your contacts and **poison that contact's
  cached name/avatar and schedule** — impersonation §3.5's gate does not catch.
- This is the `pairingAck.ts` AC-SEC-2 analog; promote to a numbered security AC
  (§11) with a forged-binding unit test.

## 5. Scheduler lifecycle (where it runs)

- A new **always-mounted watcher** (sibling of `PendingPairingIntentWatcher` /
  the DM-notification watcher) owns the loop: on mount, on `online`, and on an
  interval, it recomputes the incomplete set from the store (§3.1) and fires any
  due requests, advancing+persisting each schedule (§3.2). On a bulk sweep
  (mount/online after a long sleep) it **staggers** sends when >N are due
  (REVIEW G7), on top of per-fire jitter.
- A **pure, unit-testable scheduling module** owns the backoff math + due-check +
  incomplete-set computation (no React/storage/NDK — injected), mirroring
  `nonceStore.ts` / `pendingIntent.ts`.
- The inbound side registers two dispatch arms **on the strict primitive**
  (§4.2) — reusing the existing gift-wrap subscription plumbing but **not**
  `unwrapGiftWrap`: request → gated answer (§3.3); announce → gated store +
  schedule-clear (§3.5, §3.2).
- **Multi-tab (REVIEW G4):** two tabs both mount the watcher; the idb schedule
  store is read-modify-write with no lock → at worst duplicate small requests /
  double-advanced schedules. Acceptable; match whatever the existing watchers do
  (they have the same property).

## 6. Backward / forward compatibility

- **Peers without the feature** never answer; their inbound dispatch ignores the
  unknown kinds (verified fail-closed: bell reacts to kind-14 only; `ContactChat`
  dispatches an explicit kind set; `welcomeSubscription` requires 444/21059/
  21060). No bubble/bell. R keeps retrying and heals on their update.
- **No wire-format version bump** — new gift-wrap inner kinds only; the
  contact-card codec is untouched (`HAS_AVATAR` stays reserved-0; the avatar
  travels in the announce).
- **No migration.** The installed base heals emergently as clients update.

## 7. Privacy invariant compliance (mandatory)

- **No public kind-0, no broadcast.** Request and announce travel only as NIP-59
  gift wraps addressed to a single pubkey — the allowed targeted-encrypted
  channel. The announce is unsigned (§4.1) so it cannot be republished as your
  public kind-0.
- **Disclosure only to the allowed set, in both directions** — §3.3 gates
  answers, §3.5 gates accepted announces; neither an unaddressed audience nor a
  stranger obtains profile data.
- **Requesting induces no broadcast of our own data** (reveals only our pubkey,
  already known to the addressed contact).
- The spec MUST include explicit checks that no path publishes an unaddressed
  kind-0, that a stranger request yields no outbound profile data, and that a
  stranger announce yields no stored data and no new contact.

## 8. Security model (accepted tradeoffs)

- **Disclosure boundary = (allowed-sender set) ∩ (active, non-archived
  contact)** (LOCKED Q7). Group co-members and ever-known peers are in the
  allowed set (they can already DM you and, for group members, already get your
  profile via group sync), but an **archived/hidden** contact is excluded in
  every direction — no requests to them, no answers to them, no accepting their
  announces. Enforced by an explicit active-contact check layered on
  `isAllowedDmSender`, because `knownPeers` is append-only.
- **No stranger disclosure; no contact injection; no profile poisoning** — §3.3
  (answer gate), §3.5 (accept gate + neutralized `rememberContact`), §4.2 (strict
  unwrap). All three are required; any one missing reopens a hole.
- **Anti-amplification** — per-requester cooldown; structural 1:1 request→answer,
  no announce→announce loop.
- **Presence signal** — answering reveals you were online at reply time (same as
  any DM reply); minor, disclosed.
- **LWW** by answer-time `updatedAt`; a stale announce cannot overwrite newer.

## 9. Open decisions (need human sign-off before implementation)

1. **D1 — "incomplete" definition + the G1/G2 loop guards.** Confirm missing-or-
   avatar-less, *with* the answered-but-incomplete state and `avatar: null ⇒
   malformed` rules (§3.1). Confirming D1 without the guards institutionalizes a
   permanent request loop.
2. **D2/D3 — jitter (±20%) & first-fire-after-1h.** D3 is correct only if Q3
   announce-on-pair ships.
3. **Q3 — LOCKED: both push companions IN SCOPE** (announce-on-change +
   announce-on-pair, §3.6).
4. **D4 — reset-on-activity**, with the announce-exclusion + ≤1/day guard (§3.2).
5. **D5 — LOCKED: 30-day give-up ceiling** (§3.2), with re-arm on a later D4
   signal.
6. **D6 — unsigned announce** (recommended) vs reuse the signed kind-0 envelope.
7. **Q7 — LOCKED: archiving/hiding a contact revokes all profile exchange** in
   every direction (§3.3, §3.5, §8). Enforced by an explicit active-contact check
   (`archivedAt == null`) layered on `isAllowedDmSender`, since `knownPeers` is
   append-only. No separate block list exists today; archive is the hide action,
   and any future block feature feeds the same exclusion.
8. **Kind numbers** — confirm 21061/21062 after the pre-land grep (now including
   25050–25055).

Remaining genuinely-open items for the implementation spec: **D2** (jitter %),
**D4** (reset-on-activity tuning), **D6** (announce signing shape), and the
**kind numbers** (§8 above). D1/D3 are settled given Q3/§3.1's loop guards.

## 10. Related bug (fix alongside, not part of this spec's core)

### 10.1 Issuer drops the scanner's name on pairing

`pairingAck.ts#handlePairingAck` (verified) admits via `rememberKnownPeers` +
`rememberContact` and **discards `decoded.profile`** — `importCard` is never
called, so the issuer never persists the scanner's name. One-line-class fix:
`importCard(senderHex, decoded.profile)` at admission. It is **immune to the §B2
trap** (card `updatedAt` derives from card `created_at`). Land separately; it and
the §3.5 receive path share the same landing store.

## 11. Acceptance criteria (draft)

- **AC-PROF-1** An incomplete contact (§3.1) is periodically sent a gift-wrapped
  profile-request on exponential backoff from 1h, capped 24h, jittered; the
  schedule persists across restart (no reset-to-1h storm), and `nextAttemptAt`
  is clamped against backwards clock jumps.
- **AC-PROF-2** On a profile-request from an **allowed sender**, the app runs
  `ensureAvatar` and replies with a profile-announce carrying `{nickname,
  avatar:{imageUrl}, updatedAt=answer-time}`.
- **AC-PROF-3 (stranger request gate)** A profile-request from a pubkey that is
  not both allowed-sender and an active, non-archived contact produces no answer
  and no outbound profile data.
- **AC-PROF-4 (stranger announce gate — REVIEW B1)** A profile-announce whose
  authenticated sender is not both allowed-sender and an active, non-archived
  contact stores nothing, adds **no** entry to the contact list, and starts no
  schedule.
- **AC-PROF-4b (archive revokes — LOCKED Q7)** After a contact is archived/
  hidden, the app sends them no requests, sends no announce to them on a profile
  change, answers none of their requests, and stores none of their announces —
  in all directions. Unarchiving restores exchange.
- **AC-PROF-5 (strict unwrap — REVIEW B3)** Request and announce are unwrapped
  via `unwrapAndOpen` only; a wrap whose rumor pubkey ≠ seal pubkey is dropped
  (never poisons a contact's cache or schedule). Unit test with a forged binding.
- **AC-PROF-6 (store + clear)** On an accepted, *completing* announce (LWW-won
  and avatar now non-null) from an allowed contact, the profile is stored under
  the authenticated sender in the same contactCache the 1:1 list reads and the
  schedule is cleared; a `null`/absent-avatar announce is treated as malformed
  (not stored, schedule not cleared).
- **AC-PROF-7 (self-heal)** Two *mutual* contacts starting with each other's
  avatar absent both converge to complete `{name, avatar}` via the periodic loop
  alone — no manual add, no re-scan.
- **AC-PROF-8 (privacy)** No request/announce path publishes an unaddressed
  kind-0 or broadcasts profile data; the announce is not a publishable signed
  kind-0.
- **AC-PROF-9 (no chat/bell surface)** A received request or announce never
  renders as a chat bubble in `ContactChat.tsx` and never raises a
  `directMessageNotifications.ts` notification — both directions.
- **AC-PROF-10 (LWW/idempotency)** Answer-time LWW: a newer announce updates the
  cache, an older one does not; repeated announces are idempotent.
- **AC-PROF-11 (backoff/answered-incomplete/give-up)** Repeated requests advance
  the backoff (except the D4 reset); a valid-but-avatar-less answer moves the
  contact to the long/terminal cadence rather than an hourly ping-pong; a contact
  with no completing answer within the 30-day ceiling is dropped from the loop
  and re-armed only on a later D4 signal.
- **AC-PROF-11b (edit propagation — LOCKED Q3)** Editing the local nickname or
  avatar sends an announce to every active, non-archived contact (not to archived
  ones); each such contact's cache updates via §3.5. Pairing a new contact sends
  them an announce so their avatar appears without waiting for the first backoff
  interval.
- **AC-PROF-12 (nameless owner)** A nameless user defers answering until named;
  may still send requests.
- **AC-PROF-13 (rate-limit — unit scope)** Repeated requests from one contact
  within the cooldown induce at most one answer.
- **AC-PROF-14 (i18n)** Any new user-facing string exists in `en` and `de`
  (largely non-visual; confirm whether any copy is introduced).

## 12. E2E tests (relay bucket — publish through the app)

Peers publish via the app, never raw WebSocket. New specs land in the
**groups/relay** bucket (Docker: strfry + blossom); update the CLAUDE.md e2e
tally + `make test-e2e-all`.

- **Test-harness backoff override (prerequisite).** The self-heal anchor cannot
  wait real hours. Specify the mechanism now: a `NEXT_PUBLIC_*` backoff-floor
  override (seconds in test) **or** a test hook that seeds the persisted schedule
  store with due-now entries. Without this the anchor is unimplementable or a
  multi-minute flake; given the gate is already chronically red, these specs must
  be self-sufficiently green.
- **Self-heal (anchor):** A and B are *mutual* contacts (pair via the real card
  flow) but start avatar-absent; run; assert **both** lists show the other's
  name+avatar, driven only by the loop. (AC-PROF-1/2/6/7)
- **Stranger request gate:** a non-contact context sends a request via the app;
  A discloses nothing. (AC-PROF-3)
- **Stranger announce gate:** a non-contact context sends an announce via the
  app; A stores nothing, gains no contact-list entry, starts no request.
  (AC-PROF-4) — security-critical.
- **Archive revokes (both directions):** A and B are healed mutual contacts; A
  archives B; assert A sends B no request, A does not answer a request from B, A
  does not push B an announce on a profile edit, and A drops an announce B sends;
  unarchive restores. (AC-PROF-4b)
- **Edit propagation:** A and B are complete contacts; A changes its nickname/
  avatar; assert B's cached profile for A updates via the pushed announce with no
  request from B. (AC-PROF-11b)
- **Pairing instant profile:** immediately after a real pairing, each side has the
  other's avatar without waiting a backoff interval. (AC-PROF-11b)
- **Strict unwrap (unit):** forged `rumor.pubkey ≠ seal.pubkey` → dropped.
  (AC-PROF-5)
- **No chat/bell surface:** a delivered request/announce produces no bubble in
  `ContactChat` and no bell notification, both directions. (AC-PROF-9)
- **Persistence/backoff + clock clamp:** schedule survives reload without a
  re-fire storm and advances. (AC-PROF-1/11)
- **LWW:** newer announce updates, older does not (needs answer-time `updatedAt`).
  (AC-PROF-10)

## 13. Suggested implementation order

1. Message kinds + payloads in a pure module (encode/parse/validate; reject
   `avatar:null`) with the kind-isolation grep (incl. 25050–25055) + module-load
   assertion (unit tests).
2. Pure scheduling module: incomplete-set + backoff + due-check + clock clamp
   (unit tests; storage/NDK injected).
3. Send path `sendProfileRequest` / `sendProfileAnnounce` over `sealAndWrap`
   (mirrors `sendPairingAck`); answer path runs `ensureAvatar` + answer-time
   `updatedAt`.
4. Inbound dispatch arms **on `unwrapAndOpen`**: request → §3.3 gated answer;
   announce → §3.5 gated store (no `rememberContact` injection) + §3.2 clear.
5. Always-mounted watcher: mount/online/interval, jitter + sweep stagger,
   persisted schedule, D4 reset with exclusions, 30-day give-up ceiling.
6. Push triggers (LOCKED Q3): announce-on-pair (scanner + issuer admission
   points) and announce-on-change (fan to active contacts on profile edit,
   staggered) — reusing the §3.6 send + §3.5 receive path.
7. Land the §10.1 name-drop fix.
8. E2E: harness backoff override first, then the self-heal anchor + both stranger
   gates + strict-unwrap unit.

## Resolved Decisions (pre-implementation, lead-ratified 2026-07-12)

The §9 "open decisions" and the two validator-surfaced gaps are settled below.
These are implementation-detail rulings, not product-behavior changes; the
locked product decisions (Q3 push companions, Q7 archive-revokes, D5 30-day
ceiling) are unchanged.

- **D2 — jitter:** ±20% on every scheduled fire (request sweep and push stagger).
- **D4 — reset-on-activity:** reset a contact's backoff to the 1h floor on an
  inbound gift-wrapped event from them, **excluding** a profile-announce receipt,
  rate-limited to at most one reset/contact/day.
- **D6 — announce is unsigned.** The privacy invariant in `CLAUDE.md` requires
  this: a signed kind-0 handed to a recipient is a publishable kind-0 that a
  hostile/buggy recipient could launder onto a public relay. Authenticity comes
  solely from the gift-wrap sender-binding (§4.2). The signed-kind-0 alternative
  is rejected.
- **Kind numbers:** `DM_PROFILE_REQUEST_KIND = 21061`, `DM_PROFILE_ANNOUNCE_KIND
  = 21062`, contingent on the mandatory pre-land kind-isolation grep (§4)
  confirming no collision with any in-repo sentinel — the grep MUST include
  444, 5, 7, 9, 13, 14, 21059, 21060, 20602, 25050–25055, **and** the bespoke
  constants `POLL_OPEN_KIND=10 / POLL_VOTE_KIND=11 / POLL_CLOSE_KIND=12`
  (`pollSync.ts`), `BACKUP_EVENT_KIND=30078`, `RELAY_LIST_KIND=30051`
  (`relayBackup.ts`), and the existing group `PROFILE_REQUEST_KIND=30`
  (`profileRequestSync.ts`). A module-load assertion pins the numbers as
  `pairingAck.ts` does.
- **Naming (avoid identifier footgun):** the new constants are named
  `DM_PROFILE_REQUEST_KIND` / `DM_PROFILE_ANNOUNCE_KIND` — NOT `PROFILE_REQUEST_KIND`,
  which the existing MLS group relay-on-behalf mechanism already owns
  (`profileRequestSync.ts`, value 30, a different transport). No numeric or
  namespace collision exists (MLS inner-rumor vs NIP-59 gift-wrap inner-rumor
  are disjoint dispatch tables), but reusing the constant name across modules
  is a duplicate-export hazard and muddies the pre-land grep.

### Validator gaps resolved

- **Answered-but-incomplete terminal state (refines §3.1 / §3.2 / AC-PROF-11).**
  When a *valid* announce from a non-Few/legacy peer arrives that nonetheless
  leaves the avatar empty, **drop that contact from the periodic loop entirely**
  (do not keep it on a "long cadence"). Re-arm it — schedule restarted at the 1h
  floor — only when a later **non-announce** D4 reachability signal arrives from
  them. This reuses the D5 give-up/re-arm machinery rather than introducing a new
  tunable interval, keeping the state machine to two terminal conditions
  (30-day give-up; answered-but-incomplete). AC-PROF-11's "long/terminal cadence"
  is read as this drop-and-re-arm behavior.
- **E2E test-harness backoff override (refines §12 / §13 step 8).** Use a
  **test hook that seeds the persisted schedule store with due-now entries** in
  idb-keyval (matching this repo's existing DM/pairing e2e seeding conventions).
  Do NOT ship a `NEXT_PUBLIC_*` backoff-floor override — that risks a test-only
  timing constant leaking into the production bundle. The self-heal anchor drives
  the loop by seeding a due-now schedule, not by waiting real time.

### Documentation clarifications (no behavior change)

- **§3.3 group-co-member answering is consistent with AC-PROF-3.** The apparent
  tension ("group co-members you never individually accepted are still answered"
  vs. AC-PROF-3's "AND is an active, non-archived contact") is resolved by
  `rememberContactsFromGroups` (`app/src/lib/contacts.ts`), auto-invoked on every
  group-list change (`Layout.tsx`), which materializes every group co-member as a
  live `archivedAt: null` contact record before this feature runs. Implementers
  MUST NOT add a redundant explicit contact-existence carve-out to "fix" the
  apparent contradiction — the active-contact check (`archivedAt == null`) layered
  on `isAllowedDmSender` is the whole gate.

## Amendments

- **2026-07-12 (AC-PROF-11a / AC-6a reconciliation, lead decision — Option A).**
  Stage-1 review of story S04 surfaced that AC-PROF-11a's "answered-but-incomplete"
  trigger is unreachable via the announce receive path: AC-PROF-6a (story S01 codec)
  classifies every null/absent-avatar announce as *malformed* and drops it before the
  §3.5 accept gate, and — this being a brand-new 1:1 protocol only Few clients speak,
  with every Few client running `ensureAvatar` before answering (AC-PROF-2) — no
  "valid announce with an empty avatar" can arrive over this channel. Decision: keep
  the code as-is (the `markAnsweredIncomplete` branch in `receive.ts` stays as correct
  defensive wiring; the state machine itself is verified at the scheduler layer, story
  S02). AC-PROF-11a is documented as satisfied-at-the-scheduler-layer and
  unreachable-by-design via the announce path (see the reachability note under
  AC-PROF-11a in `acceptance-criteria.md`). No behavioral change; the divergence only
  affects a hypothetical non-Few name-only answer that cannot occur with the current
  protocol. Captured as the cross-project learning
  `hardened-producer-parser-can-silently-strand`.

- **2026-07-12 (S06 announce-on-change LWW-ordering edge, accepted).** Stage-1 review
  of story S06 surfaced a transient, self-healing LWW-ordering edge: because
  `sendProfileAnnounce` stamps `updatedAt` at send-time (S03 answer-time stamping) and the
  announce-on-change fan-out staggers sends over ~30s (§3.6/§5, to avoid a relay burst), a
  pathological sequence — TWO profile edits within the same 30s stagger window AND a >5
  audience AND a between-edit change in a recipient's stagger index (e.g. several contacts
  archived between the edits) — could let an older edit's staggered send fire after the
  newer edit's send and briefly land older content at that one recipient under LWW.
  Decision: ACCEPTED, no code change. The effect is transient and self-correcting — the
  next heal-loop request/answer (or the next edit) re-stamps the current profile at answer
  time, so AC-PROF-7 convergence holds. The §3.6 stagger is spec-required, so the
  "skip-stagger-for-edits" alternative is rejected; an edit-time monotonic counter was
  judged not worth the complexity for a transient, self-healing, pathologically-triggered edge.

## Constrained by ADRs

- **ADR-008** — Block is a deny layer AND-ed at every peer-signal channel, keyed on
  `archivedAt`. This epic's heal channel (`ProfileHealWatcher` / `dmProfile/receive.ts`)
  already gates on `archivedAt` via `passesDisclosureGate` / `isActiveNonArchivedContact`
  — `epic-block-contact` verified this channel needed no code change to satisfy the
  block-contact composite gate, and cites it as the ADR-worthy pattern instance.
