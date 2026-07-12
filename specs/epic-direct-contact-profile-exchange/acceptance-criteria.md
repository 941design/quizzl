# Direct-Contact Profile Exchange — Acceptance Criteria

## Known TAGs

- **PROF** — profile-exchange behavior, carried forward from `spec.md` §11.
- **STRUCT** — structural assertions about the new message kinds / codec module.
- **WATCH** — scheduler/watcher wiring and lifecycle assertions.
- **CARD** — the §10.1 issuer-name-drop fix, sharing the receive/cache-write surface.
- **E2E** — end-to-end test-harness prerequisites (the relay-bucket suite).

## Terminology

- **R** / **O** — requester / owner, per `spec.md` §3.
- **Gift wrap** — a kind-1059 NIP-59 event, sender hidden by an ephemeral key, addressed to one recipient pubkey.
- **Allowed sender** — a pubkey for which `isAllowedDmSender` (`app/src/lib/walledGarden.ts`) returns true: a current MLS group co-member or an entry in `knownPeers` (`app/src/lib/knownPeers.ts`).
- **Active, non-archived contact** — a contact record in `lp_contacts_v1` (`app/src/lib/contacts.ts`) whose `archivedAt` is `null`.
- **Disclosure gate** — the conjunction "allowed sender AND active, non-archived contact" enforced by both the answer path (§3.3) and the announce-accept path (§3.5).
- **Incomplete contact** — a contact with no `contactCache` entry, or an entry whose `avatar` is `null` (§3.1, D1).
- **Malformed announce** — a `profile-announce` payload whose `avatar.imageUrl` is `null` or absent.
- **Answered-but-incomplete** — a contact for whom a *valid*, gate-passing announce arrived but left `avatar` empty (only reachable from a non-Few/legacy peer).
- **D4 reachability signal** — any inbound gift-wrapped event from a contact, excluding a `profile-announce` receipt, that resets that contact's backoff to the 1h floor (rate-limited to once per contact per 24h).
- **LWW** — last-write-wins by `updatedAt` (ISO-8601 lexicographic compare) in `writeContactEntry` (`app/src/lib/contactCache.ts`).

## Codec (`app/src/lib/dmProfile/kinds.ts`)

**AC-STRUCT-1** — `kinds.ts` MUST define `DM_PROFILE_REQUEST_KIND = 21061` and `DM_PROFILE_ANNOUNCE_KIND = 21062` and, at module load, MUST throw if either value collides with any sentinel in the mandatory pre-land list: `444, 5, 7, 9, 13, 14, 21059, 21060, 20602, 25050–25055, POLL_OPEN_KIND=10, POLL_VOTE_KIND=11, POLL_CLOSE_KIND=12, BACKUP_EVENT_KIND=30078, RELAY_LIST_KIND=30051, PROFILE_REQUEST_KIND=30, PROFILE_RUMOR_KIND=0` (mirrors `pairingAck.ts`'s `PAIRING_ACK_SENTINEL_KINDS` assertion).

**AC-STRUCT-2** — The new constants MUST be named `DM_PROFILE_REQUEST_KIND` / `DM_PROFILE_ANNOUNCE_KIND`, not `PROFILE_REQUEST_KIND` (already exported by `app/src/lib/marmot/profileRequestSync.ts` with value `30`, a different transport); a build importing both modules MUST NOT produce a duplicate-identifier error.

**AC-PROF-6a (malformed announce, codec half)** — `kinds.ts`'s announce parser MUST classify a payload whose `avatar` is `null` or absent as invalid/malformed, and MUST NOT produce a value the receive path can hand to `contactCache.ts`'s write function for that payload; `avatar: null` (or a missing `avatar` key) MUST NOT be treated as a "never announced" signal (§3.1 REVIEW G1/G2).

## Scheduler & Watcher (`app/src/lib/dmProfile/scheduler.ts`, `app/src/components/ProfileHealWatcher.tsx`)

**AC-PROF-1 (backoff schedule + persistence)** — For an incomplete contact, the scheduler MUST fire the first profile-request after the initial 1h interval (not immediately) and MUST advance subsequent fires along `1h → 2h → 4h → 8h → 16h → 24h`, capped at 24h thereafter, each fire time jittered by ±20%; the per-contact schedule `{pubkeyHex, attempts, nextAttemptAt, state}` MUST persist in the `few-dm-profile-schedule` idb-keyval store so a page reload resumes the existing backoff without resetting to the 1h floor; on load, `nextAttemptAt` MUST be clamped to `now + 24h` when it exceeds that bound (backwards clock-jump guard).

**AC-PROF-11 (backoff advance + D4 reset)** — A repeated unanswered profile-request MUST advance that contact's schedule per AC-PROF-1's ladder; an inbound gift-wrapped event from that contact other than a `profile-announce` receipt MUST reset its schedule to the 1h floor, and that reset MUST NOT fire more than once per contact per 24h period.

**AC-PROF-11a (answered-but-incomplete terminal state)** — When a gate-passing, non-malformed `profile-announce` (AC-PROF-6a) nonetheless leaves that contact's `avatar` empty, the scheduler MUST drop that contact from the periodic due-check entirely (no reduced/long cadence) and MUST re-arm it (schedule restarted at the 1h floor) only when a later D4 reachability signal (non-announce) arrives from that contact.

> **Reachability note (Amendment 2026-07-12, AC-6a interaction).** This AC is satisfied and verified at the **scheduler layer** (story S02: `markAnsweredIncomplete` + the terminal `answered-incomplete` state + D4 re-arm, unit-tested). It is **unreachable via the announce receive path by design**: AC-PROF-6a classifies every null/absent/empty-`imageUrl` avatar as *malformed* (dropped before the accept gate), and because this is a brand-new 1:1 protocol that only Few clients speak — and every Few client runs `ensureAvatar` before answering (AC-PROF-2) — no "valid announce that leaves `avatar` empty" can actually arrive over this channel. The receive arm (story S04) still wires the `mark-incomplete` branch as correct defensive code (it would activate if the codec ever loosened), but it is dead code with respect to the current announce path. The observable consequence of the drop-as-malformed path for the hypothetical non-Few name-only answer (retry-until-30-day-give-up per AC-PROF-11c rather than immediate park) is an accepted degradation of a scenario that cannot occur with the current protocol; there is no product-behavior difference for real (Few↔Few) exchange. No code change; the scheduler-layer machinery is the AC's home.

**AC-PROF-11c (30-day give-up ceiling)** — A contact whose total attempt span reaches 30 days with no completing announce (per AC-PROF-6's LWW-won, non-null-avatar definition) MUST be dropped from the periodic due-check, and MUST be re-armed (schedule restarted at the 1h floor) only when a later D4 reachability signal arrives from that contact.

**AC-WATCH-1 (bulk-sweep stagger)** — When a due-check (mount, `online` event, or interval) finds more than N contacts due, `ProfileHealWatcher.tsx` MUST stagger the outbound sends in addition to each fire's ±20% jitter, so a mount/online/resume sweep does not emit all due requests in one burst.

**AC-WATCH-2 (dedicated subscription)** — `ProfileHealWatcher.tsx` MUST open its own `ndk.subscribe({kinds:[GIFT_WRAP_KIND], '#p':[ownPubkeyHex]})` subscription to drive the two new dispatch arms, and landing it MUST NOT modify `app/src/lib/marmot/welcomeSubscription.ts` or either pre-existing kind-1059 consumer's subscription.

## Send (`app/src/lib/dmProfile/send.ts`)

**AC-PROF-2 (answer content)** — On a gate-passing profile-request (AC-PROF-3's gate satisfied), the answer path MUST run `ensureAvatar` (`app/src/lib/avatar.ts`) on the local profile before replying, then MUST send a `profile-announce` gift-wrapped to the requester with `{nickname, avatar: {imageUrl}, updatedAt}`, where `updatedAt` is stamped at serialization time (answer-time), never the profile's last-edit time.

**AC-PROF-12 (nameless owner defers)** — When `hasShareableName` (`app/src/lib/shareCard.ts`) is false for the local profile, the answer path MUST NOT send a `profile-announce` in response to any profile-request (deferred, not dropped — answerable once a name is set); sending a profile-request MUST NOT itself require a local name.

## Receive + Gates (`app/src/lib/dmProfile/receive.ts`)

**AC-PROF-3 (stranger request gate)** — A profile-request whose authenticated sender (`rumor.pubkey` from `unwrapAndOpen`) fails `isAllowedDmSender` OR is not an active, non-archived contact MUST produce no `profile-announce` reply and no other outbound profile data.

**AC-PROF-4 (stranger announce gate)** — A profile-announce whose authenticated sender fails `isAllowedDmSender` OR is not an active, non-archived contact already present in `lp_contacts_v1` MUST NOT be written to `contactCache.ts`, MUST NOT add a new entry to `lp_contacts_v1` (no `rememberContact` side effect), and MUST NOT start or touch that pubkey's schedule.

**AC-PROF-5 (strict unwrap only)** — `receive.ts` MUST dispatch both new kinds exclusively through `directMessages.ts#unwrapAndOpen`, never `welcomeSubscription.ts#unwrapGiftWrap`; a gift wrap whose inner `rumor.pubkey` does not equal the seal's authenticated `seal.pubkey` MUST be dropped before reaching either gate. A unit test MUST construct a forged wrap (`rumor.pubkey` set to an existing contact's pubkey, sealed by a different key) and assert it is dropped without mutating that contact's cache entry or schedule.

**AC-PROF-13 (rate-limit)** — Repeated profile-requests from one authenticated sender within a cooldown of at least the 1h floor MUST produce at most one `profile-announce` reply.

## Cache-Write Seam (`app/src/lib/contactCache.ts`)

**AC-PROF-6 (store + clear on completing write)** — When a gate-passing (AC-PROF-4), non-malformed (AC-PROF-6a) announce's write wins LWW and leaves `avatar` non-null, the profile MUST be stored under the authenticated sender in the same `contactCache` the 1:1 contact list reads, and that contact's `few-dm-profile-schedule` entry MUST be cleared in the same operation.

**AC-PROF-10 (LWW/idempotency)** — A `profile-announce` whose `updatedAt` is lexicographically greater than the stored entry's `updatedAt` MUST update the cache; one whose `updatedAt` is less than or equal to the stored value MUST NOT change the stored fields; applying the same announce twice MUST leave the cache in the same state as applying it once.

## Push Triggers (`app/pages/profile.tsx`, pairing admission points)

**AC-PROF-11b (edit propagation + pairing-instant)** — Saving a nickname or avatar edit (`profile.tsx`'s `broadcastProfile` chokepoint) MUST send a `profile-announce` to every active, non-archived contact and MUST NOT send one to an archived contact; each recipient's cache entry MUST update via the AC-PROF-6/AC-PROF-4 receive path with no request having been sent by that recipient. Admission of a new contact (scanner side after add, issuer side after `handlePairingAck`) MUST send that one new contact a `profile-announce` immediately, so its avatar is visible without waiting for the first backoff interval.

## §10.1 — Issuer Name-Drop Fix (`app/src/lib/pairing/pairingAck.ts`)

**AC-CARD-1** — `handlePairingAck`'s admission path MUST persist the scanner's name from the pairing-ack (in addition to `rememberKnownPeers`/`rememberContact`), so the issuer no longer discards `decoded.profile`; a pairing-ack round-trip test MUST assert the issuer's `contactCache` entry for the scanner carries the scanner's submitted name after admission.

> **Implementation note (Amendment 2026-07-12).** The AC originally named the call `importCard(senderHex, decoded.profile)`. The implemented (and correct) seam is the shared **`writeContactEntryNeutralized`** primitive landed by story S04 — reused verbatim, converting the card's `createdAt` (unix) to a strict-ISO `updatedAt` byte-identically to `parseContactCard` (§B2-safe). `writeContactEntryNeutralized` is preferred over the pre-existing `contactCardImport.ts#importCard` because it avoids a redundant `rememberContact` (the contact is already legitimately admitted one step earlier via nonce authorization) while persisting the name into the same `contactCache` store the 1:1 list reads. The behavioral requirement of this AC is unchanged; only the named mechanism is corrected.

## Cross-Cutting Invariants

**AC-PROF-4b (archive revokes, all directions)** — After a contact's `archivedAt` is set (non-null): the scheduler MUST send that contact no further profile-requests; the receive path MUST NOT answer a profile-request whose authenticated sender is that contact; the push-trigger path MUST NOT include that contact in an edit-propagation fan-out; and the receive path MUST drop (not store) any profile-announce whose authenticated sender is that contact. Clearing `archivedAt` (unarchive) MUST restore all four behaviors for that contact.

**AC-PROF-7 (self-heal convergence)** — Given two contacts A and B who are each other's active, non-archived, *mutual* contact and both start with the other's `avatar` absent, running the periodic loop alone (no manual re-add, no re-scan) MUST bring both A's cache entry for B and B's cache entry for A to a complete `{name, avatar}` state.

**AC-PROF-8 (privacy)** — No code path introduced by this feature MUST publish a kind-0 event to any relay; every `profile-request`/`profile-announce` MUST be sent only as a NIP-59 gift wrap addressed to exactly one recipient pubkey via `sealAndWrap`; the `profile-announce` payload MUST be unsigned, so there is no signed inner event a recipient could republish as the sender's public kind-0.

**AC-PROF-9 (no chat/bell surface)** — A delivered `profile-request` or `profile-announce` MUST NOT render a message bubble in `ContactChat.tsx`'s live subscription and MUST NOT raise a notification in `directMessageNotifications.ts`, for both kinds and both inbound directions. Per `architecture.md`, existing fail-closed dispatch already satisfies this; verification is by adding foreign-kind proof tests to `contactChat.test.ts` (closing the pre-existing gap noted in `exploration.json`) and extending the existing proof test in `directMessageNotifications.test.ts` — no source change to either file.

**AC-PROF-14 (i18n)** — Any new user-facing string introduced by this epic MUST have both an `en` and a `de` entry in `app/src/lib/i18n.ts`. Baseline confirmation: this epic's behavior is background/non-visual (existing contact-list name/avatar rendering is reused unchanged), so no new UI copy is expected; if implementation introduces any (e.g., an error toast), this AC applies and blocks completion until both locales are populated.

## End-to-End & Test Harness

**AC-E2E-1 (backoff test hook)** — A test-only helper `seedDueProfileSchedule(page, {pubkeyHex, nextAttemptAt, attempts, state})` MUST write a due-now entry directly into the `few-dm-profile-schedule` idb-keyval store (mirroring `helpers/pairing.ts#seedPendingIntent`), and the app's next due-check MUST fire a request for that entry without the test waiting on real elapsed time. This mechanism MUST NOT ship as a `NEXT_PUBLIC_*` build-time override (no test-only timing constant in the production bundle).

## Manual Validation

None. Every criterion above is checkable via unit test (Vitest, `app/tests/unit/`), a relay-bucket e2e spec (`dm-*.spec.ts` under Docker), or a static grep/compile check (kind-isolation, duplicate-export) — this feature has no visual-only or third-party-UI surface that would require a human-only check.
