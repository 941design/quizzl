# Contact Card Exchange (signed, out-of-band)

## Problem

Two gaps, both rooted in the same privacy invariant.

1. **A directly-added contact never gets a name or avatar.** Adding a contact by
   npub (`addContactByNpub`) stores only a pubkey. The contact renders as a
   shortened npub until — and unless — the two of you happen to share an MLS
   group, because the app's *entire* profile-exchange system is group-scoped
   (MLS application rumors). A pure direct contact, sharing no group, is
   structurally unreachable by that machinery. This was deliberately deferred in
   `epic-add-contact-by-npub` (Design Decision 2); this epic reverses that
   deferral.

2. **The naive way to close gap 1 would violate a hard privacy rule.** The
   obvious fix — fetch/publish public kind-0 metadata on relays — is forbidden:
   **profile information must never be broadcast to public relays, under any
   circumstances** (see `CLAUDE.md` "Privacy invariant"). Any solution must
   exchange profile data only over addressed, encrypted, or out-of-band channels.

## Solution

Make the shareable identity artifact a **contact card** — a compact, signed
encoding of `{ pubkey, display name }` — instead of a bare npub. The card travels
strictly **out-of-band**: as a link (`few.chat/add#c=…`) or a QR code the user
hands to a specific person over whatever channel they choose. Importing the card
adds the contact with the name already populated. **No relay is involved; nothing
is broadcast.**

Because the card is a *superset of an npub* (a pubkey plus optional signed
profile), the same artifact works everywhere an npub works today — Add Contact,
QR scan, and **group invite-by-npub** — via a single shared parser. On the
group-invite path the card contributes only its pubkey (the invite is unchanged,
and the member's name arrives via the group's MLS profile sync as today); the
name-population benefit applies to the **direct-contact** path.

The display name embedded in the card is **signed by the identity key**, so a
recipient can verify the name was self-asserted by that pubkey (an unsigned card
could pair a real pubkey with a fake name). Verification is fully offline.

## Scope

### In Scope

- A binary **contact-card format v1** (defined below): `{ version, pubkey, signed
  display name (≤32 UTF-8 bytes) }`, base64url-encoded, carried in a URL fragment
  and a QR code.
- A single canonical parser `parseContactCard(input)` that accepts a bare npub, a
  card URL (fragment form), or a raw card payload, and returns `{ pubkeyHex,
  profile? }` — wired into **every** npub entry point (Add Contact modal, QR
  scanner, group invite-by-npub input, and the `/add` deep-link page).
- Signature **verification on import**; a signed card whose signature does not
  verify is rejected as malformed.
- **Caching** the imported name via the existing `writeContactEntry`
  (last-writer-wins by timestamp), so a stale card never clobbers a fresher
  cached profile, and re-importing is idempotent.
- A **32-UTF-8-byte cap on the profile nickname**, enforced at profile save (new
  validation + i18n), with codepoint-boundary truncation at card encode as a
  migration/defense-in-depth backstop.
- A **"Share contact card"** action producing a copy-able link and a QR code, both
  carrying the current user's signed card (built with the active signer, so it
  works in local, NIP-07, and NIP-46 modes).
- The `/add#c=…` **static onboarding/deep-link page** (`pages/add.tsx`, fragment
  routing, static-export safe) that parses the card and drives the add-contact flow —
  including an **onboarding mode** for a visitor with no local identity yet (create
  identity, then complete the add from the held card).
- English and German i18n for all new UI text.
- Unit tests for encode/decode round-trip, signature verification (valid, tampered
  name, tampered pubkey, wrong-key signature), parser input discrimination, and the
  LWW cache-merge / already-present skip.

### Out of Scope

- **Avatars.** v1 cards carry the display name only. The format reserves a flag bit
  and version headroom so an avatar section can be added later without a breaking
  change. Contacts show name + generated fallback avatar as they do today.
- **Any relay-based profile fetch or publish**, public or otherwise — forbidden by
  the privacy invariant. The removed public kind-0 broadcast (see "Related
  changes") is not replaced by a relay mechanism.
- **Live profile updates.** The card is a snapshot at share time. If the sharer
  later changes their name, existing holders keep the old one until a fresh card is
  shared (or until a shared MLS group's sync updates them). A gift-wrapped refresh
  layer is a possible future epic, explicitly deferred here.
- **Remote automatic reciprocity.** Mutual profiles come from *exchanging* cards
  (both parties share/scan). A gift-wrapped "reply with my card" auto-response is
  deferred (would reintroduce a relay round-trip and an answer-policy decision).
- **Changes to MLS in-group profile sync** — untouched. The card only helps at the
  invite moment and for direct contacts.
- **Removing bare-npub add.** A bare npub someone hands you still works as the
  no-profile fallback; the card is the richer, recommended path.

## Contact Card Format v1

The card is a byte sequence, base64url-encoded (RFC 4648 §5, no padding).

| Field        | Size            | Notes |
|--------------|-----------------|-------|
| `header`     | 1 byte          | Bits 7–6: **version** (2 bits; v1 = `0`). Bits 5–0: **flags**. Bit 5 = `SIGNED`. Bit 4 = `HAS_AVATAR` (reserved, MUST be 0 in v1). Bits 3–0 reserved (MUST be 0). |
| `pubkey`     | 32 bytes        | Raw x-only secp256k1 public key (not bech32 npub). |
| `created_at` | 4 bytes         | uint32 big-endian, Unix seconds. Present iff `SIGNED`. Doubles as the profile's `updatedAt` for cache LWW. |
| `name_len`   | 1 byte          | UTF-8 byte length of the name (0–**32**; see name cap). Present iff `SIGNED`. |
| `name`       | `name_len` bytes| UTF-8 display name, capped at 32 bytes. Present iff `SIGNED`. |
| `sig`        | 64 bytes        | Present iff `SIGNED`. See below. |

**Fixed overhead when signed:** 1 + 32 + 4 + 1 + 64 = **102 bytes + name**.

**Name cap — 32 UTF-8 bytes (DD 11).** The display name is capped at 32 UTF-8 bytes
(~32 Latin / ~16 umlaut / ~8 emoji characters). The cap is enforced in **two**
places: (a) at profile save — the nickname field itself is limited to 32 UTF-8 bytes
so new names never exceed it; (b) at card encode — any pre-existing longer nickname
is truncated on a codepoint boundary (never mid-character) before signing, so legacy
profiles never produce an oversized card. `name_len`'s 1-byte width still permits
0–255 structurally, but v1 encoders MUST NOT emit > 32 and MAY reject a decoded card
whose `name_len` > 32.

**Size at the cap:** 102 + 32 = 134 bytes → ~179 base64url chars. As an onboarding
**URL** QR (`https://few.chat/add#c=…`, ~23-char prefix → ~202 chars) at ECC-L, this
is **QR version 9** (53×53) — reliably scannable off a phone screen. An empty-name
card is version 8.

**Signature.** The `sig` is a standard **NIP-01 kind-0 event signature** — *not* a
raw-byte signature — so that remote signers (NIP-07 / NIP-46), which only sign
Nostr events, can produce a card. It signs the event:

```
{ pubkey, created_at, kind: 0, tags: [], content: CARD_CONTENT }
```

where `CARD_CONTENT` is the **fixed canonical string** `{"name":"<name>"}` with
`<name>` JSON-string-escaped (via `JSON.stringify`) and no other keys or
whitespace. Both encode and decode MUST build `CARD_CONTENT` through one shared
helper — the signature is over this reconstructed content, so any serialization
drift breaks verification. To keep encode/decode byte-identical, the encoder MUST
sign over the name **as it survives a UTF-8 encode→decode round trip** (so a name
containing an unpaired surrogate is normalized — or rejected — at sign time, not
silently mangled to U+FFFD on import).

**Verification on import** (the recipe `verifyEvent` actually requires):

1. base64url-decode → parse the header. Reject if the `version` bits are ≠ 0, or if
   any reserved flag bit (including `HAS_AVATAR`) is set — v1 is a **strict** parser;
   forward-compat comes from the reserved bits/versions, not from v1 tolerating
   unknown layouts.
2. Read `pubkey` (always present). If `SIGNED` is unset the card is pubkey-only —
   treat exactly like a bare npub (no profile).
3. If `SIGNED`: reconstruct `event = { pubkey, created_at, kind: 0, tags: [],
   content: CARD_CONTENT(name) }`, then compute `event.id =
   getEventHash(event)` and attach it **before** calling `verifyEvent` —
   `verifyEvent` (imported from `nostr-tools/pure`; used in `profileSync.ts:17`)
   returns `false` unless `getEventHash(event) === event.id`, so an `id`-less
   reconstructed event fails for valid and invalid cards alike. This mirrors the
   existing adapter pattern (`signerAdapter.ts:98`).
4. On verify success, map `name → nickname` and derive `updatedAt =
   new Date(created_at * 1000).toISOString()` — an **ISO-8601 string**, because
   `writeContactEntry` compares `updatedAt` **lexically** (`contactCache.ts:38`) and
   all existing writers store ISO strings; a raw `String(seconds)` would always lose
   the LWW comparison to any MLS-synced entry. Then upsert through
   `writeContactEntry`, **preserving any existing avatar**
   (`avatar: readContactEntry(pubkey)?.avatar ?? null`) so a name-only card never
   erases an avatar populated by group profile sync.
5. On verify failure, reject the card as malformed (do **not** downgrade to a
   bare-pubkey add — a card that fails integrity is untrusted, AC-PARSE-4).

## Technical approach — the actual seams

The "one parser, every entry path" rule (DD 1) fails silently if it names UI
components instead of the real decode sites. The conversion points are:

- **`parseContactCard(input) → { pubkeyHex, profile? } | { error }`** — the single
  decoder. Accepts a bare npub, a card **URL** (`https://few.chat/add#c=<b64url>` —
  extract the fragment after `#c=`), or a raw base64url payload. Discriminates:
  `npub1…` → decode via `npubToPubkeyHex`, no profile; a URL → pull the `#c=`
  fragment then decode; else treat as a raw base64url payload and parse per the
  format above.
- **QR scan path.** The scanner validates *inside* `NpubQrScanner` via
  `normaliseNpubPayload` (`app/src/lib/qr.ts`), which rejects a non-npub before any
  modal `onScan` callback runs. This is the natural single seam for both the
  add-contact scan and the group-invite scan: `normaliseNpubPayload` (or a
  card-aware sibling) must accept a card payload, and the `onScan` contract carries
  the scanned value through to the call site as a plain string (`onScan: (value:
  string) => void`), re-parsed once there via `parseContactCard` — see
  `## Amendments`.
- **`inviteByNpub` stays npub/pubkey-only.** It re-normalises its input internally
  (`MarmotContext.tsx:1229-1235`), so passing a raw card string yields
  `invalid_npub`. Callers MUST down-convert a card to its `pubkeyHex` (via
  `parseContactCard`) **before** calling `inviteByNpub`. The group-invite path does
  **not** write to `contactCache` (see DD 8) — it only extracts the pubkey.
- **Deep link / onboarding page.** A new static `pages/add.tsx` reads the card from
  `window.location.hash` (fragment `#c=`, not `?c=` — see DD 9), runs it through
  `parseContactCard`, and has **two modes**: (a) a visitor who already has a local
  identity → the existing add-contact flow, pre-filled from the card; (b) a visitor
  with **no** identity yet (scanned the onboarding QR / opened the link cold) →
  onboarding (identity creation) with the card held in page state, then complete the
  add once an identity exists. The card must survive the onboarding step (kept in
  memory or the retained hash), and must never be sent to the server (fragment only).

The group-**join** deep link (`pages/groups.tsx` `admin` param → `JoinRequestCard`)
is **exempt** from the one-parser rule: it carries an app-generated npub for a join
handshake, not a user-shared contact card, so cards never appear there. "Every npub
entry point" above means every path where a *user supplies* an identity to add or
invite.

**Signer acquisition (share side).** Building a card requires signing a kind-0
event with the active signer in any mode. Use
`activeEventSignerOverride.current ?? createPrivateKeySigner(privateKeyHex)`
(`signerAdapter.ts:19-21`; `privateKeyHex` from `NostrIdentityContext`) — do not
reach for `MarmotContext`'s unexported `signerRef`. In NIP-46 mode signing is a
remote round trip, so the built signed card MUST be cached and only rebuilt when the
user's nickname changes (do not re-sign on every open of the share modal).

**QR content.** The QR encodes the **full onboarding URL**
`https://few.chat/add#c=<b64url>` (not the bare payload), so a native-camera scan
opens few.chat directly and can onboard a brand-new user whose first contact is the
sharer. The domain costs ~2 QR versions versus a bare payload, but at the 32-byte
name cap and ECC-L the QR is version 9 — reliably scannable. The `#c=` fragment
keeps the card off Cloudflare's request path (DD 9) while still reaching the loaded
page, so onboarding and privacy coexist. Encode at **ECC-L** (on-screen display
favors capacity; the existing bare-npub QR uses ECC-M — either the card QR uses L or
both move to L). The "Share contact card" action augments the existing bare-npub QR
surface (`settings.tsx:567`) rather than introducing a separate screen.

## Design Decisions

1. **A card is a superset of an npub, parsed once.** Rather than a parallel
   "card" concept, the card is an npub plus optional signed profile. Every existing
   npub-input site routes through one `parseContactCard`; the pubkey drives the
   existing operation and the profile is an opportunistic cache write. This is why
   group-invite-by-card is free: it is invite-by-npub with a name pre-cache. **One
   parser, every entry path** is a correctness requirement — an inline parse at any
   site silently breaks cards there (this repo has been bitten before by reusing a
   component without covering every entry path; see the walled-garden channel-gating
   history).
2. **Out-of-band card, not a relay protocol.** The profile rides the shared
   artifact, never a relay. This is the strongest possible reading of the privacy
   invariant (broadcast is impossible — there is no publish step) and the least new
   surface (no gift-wrap request/answer protocol, no ad-hoc MLS group, no
   answer-policy decision, no online-liveness dependency).
3. **Signed display name.** Binding name↔pubkey with a signature stops a crafted
   card from putting a fake name on a real key. Trust in *which* card you received
   still comes from the out-of-band channel; the signature only prevents
   name-swapping on a real pubkey.
4. **Signature is a kind-0 event signature, not raw bytes.** NIP-07/46 signers sign
   events, not arbitrary bytes. Signing a canonical kind-0 event lets "share my
   card" work in all three signer modes and reuses `verifyEvent`. The cost is a
   single shared canonical-content builder used on both sides.
5. **Card content is minimal and card-specific (`{"name":…}`), not the MLS
   `ProfilePayload`.** Reusing `ProfilePayload` would re-introduce the ISO
   `updatedAt` string the format deliberately replaced with a 4-byte `created_at`,
   and pull in avatar fields out of scope for v1. Small link size is a hard goal;
   the card owns its own compact content shape and maps into `contactCache` on
   import.
6. **Avatars deferred behind a flag + version bits.** Name-only keeps v1 links
   ~165 chars. The `HAS_AVATAR` flag and the 2 version bits reserve a
   non-breaking path to add an avatar (as a blossom hash, per the earlier sizing
   analysis) later.
7. **Snapshots, not live updates.** A card captures the name at share time. Contact
   cards rarely need live updates, and shared-group members still refresh via MLS.
   Live propagation is a separate, deferred concern.
8. **Group-invite by card extracts the pubkey only — no profile pre-cache.** The
   card carries pubkey + name, not the invitee's MLS KeyPackage, so inviting by card
   is inviting by npub (KeyPackage fetch from relays, unchanged) and does **not**
   make group-add work for someone who has never run the app. It also does **not**
   write the name to `contactCache`: `writeContactEntry` calls `rememberContact`,
   which would add the invitee to your contacts *before they accept* and expose them
   to a `purgeStrangerContacts` race (they are in neither `knownPeers` nor any
   group's `memberPubkeys` until the MLS commit lands). The invited member's name
   arrives via the group's existing MLS profile sync within seconds of joining, as
   today. Avoiding the pre-cache keeps this epic out of ADR-002/005 trust-model
   territory for a marginal "named a few seconds sooner" benefit.
9. **Share link uses a hash fragment (`#c=`), not a query param.** A `?c=` query
   string is transmitted to Cloudflare Pages in the GET request (request logs,
   analytics); a `#c=` fragment never leaves the browser. Both are equally
   static-export-safe (the routing constraint in `CLAUDE.md` is about path segments;
   a fragment does not participate in routing at all). Given the profile data in the
   card, the fragment is the correct default — read via `window.location.hash`. This
   is not a relay broadcast either way, so it does not touch the invariant's letter,
   but it keeps profile data off the hosting infrastructure's request path.
10. **No nickname → share an unsigned (pubkey-only) card.** When the user has not set
    a nickname, there is nothing to sign; the shared card has `SIGNED` unset and is
    exactly equivalent to sharing a bare npub. An unsigned card decodes to
    `{ pubkeyHex }` with no profile. Signed cards are produced only when a nickname
    exists.
11. **Display name capped at 32 UTF-8 bytes, enforced at the source.** The cap is
    enforced both at profile save (the nickname field is limited to 32 UTF-8 bytes,
    so the app is the source of truth for its own names) and, defensively, at card
    encode (codepoint-boundary truncation of any legacy longer nickname). Enforcing
    at profile save — not only at encode — keeps the card's name identical to the
    displayed nickname in the common case (no surprise truncation), and bounds the
    onboarding QR to version 9. The byte-based limit (not character count) is what
    actually bounds the payload; the UI communicates it as an approximate character
    budget.
12. **Onboarding URL, not a bare-payload QR.** The QR carries the full
    `https://few.chat/add#c=…` URL so a native-camera scan can turn a non-user into an
    onboarded user with a first contact. This reverses the earlier lean toward a
    bare-payload (in-app-scan-only) QR: the onboarding funnel is worth the ~2 extra QR
    versions, and the fragment preserves the privacy property regardless.

## Related changes (shipped separately)

- **Public kind-0 broadcast removed.** `publishIdentityToRelays` in
  `NostrIdentityContext.tsx` published the user's kind-0 (name) to public relays on
  every load in local mode and on identity restore — a live violation of the
  privacy invariant with no reader anywhere. Removed as an independent bug fix; this
  epic is the sanctioned, private replacement for making profiles reach a contact.

## Supersedes

- `epic-add-contact-by-npub` **Design Decision 2** ("No new profile-lookup
  mechanism"). That deferral is reversed here — but *not* by the mechanism it ruled
  out (relay kind-0 fetch); by out-of-band signed cards, which honor the privacy
  invariant.

## Amendments

- **2026-07-09 — `onScan` contract corrected to a plain string, not the parsed
  struct.** "Technical approach — the actual seams" originally read: "the `onScan`
  contract must carry through the parsed `{ pubkeyHex, profile? }` rather than a raw
  npub string." As sanctioned by `stories.json` S4 scope, S4 and S5 instead kept
  `onScan: (value: string) => void` — the scanner still validates/normalises via
  `normaliseNpubPayload`/`parseContactCard`, but hands the *string* value to the
  callback, which calls `parseContactCard` again at the call site
  (`AddContactModal.tsx`, `InviteMemberModal.tsx`). Behavior is identical to the
  originally-specified struct-passing variant — every scan still routes through
  `parseContactCard` exactly once per add/invite attempt, satisfying AC-UX-2 and
  AC-GRP-1 — only the *shape* of the callback contract differs. S5 reused this
  raw-string seam without objection. The spec prose is corrected to match the
  shipped seam rather than the implementation being changed to match the prose,
  since no acceptance criterion names the `onScan` payload shape and re-plumbing a
  typed struct through both call sites would be a pure refactor with no observable
  behavior change.
