# Contact Card Exchange — Acceptance Criteria

## Terminology

- **contact card** — the byte sequence defined in `spec.md` "Contact Card Format
  v1", base64url-encoded.
- **signed card** — a card with the `SIGNED` flag set, carrying `created_at`,
  `name`, and a valid kind-0 event signature.
- **`CARD_CONTENT`** — the canonical signed content string `{"name":"<name>"}`
  (name JSON-escaped, no other keys, no whitespace).
- **card link** — a URL of the form `https://few.chat/add#c=<base64url card>` (hash
  fragment; the card is never sent to the server).

## Known TAGs

- **CARD** — card encode/decode and format assertions.
- **SIG** — signature construction / verification assertions.
- **PARSE** — `parseContactCard` input-discrimination assertions.
- **CACHE** — `contactCache` write / merge / idempotency assertions.
- **UX** — modal, share, and deep-link behavior assertions.
- **GRP** — group-invite-by-card assertions.
- **SEC** — privacy-invariant / anti-spoofing assertions.
- **INTL** — translation coverage assertions.

## Card format & round-trip

**AC-CARD-1** — Encoding a card for `{ pubkeyHex, name }` then decoding it MUST
yield the same `pubkeyHex` and `name`, and the decoded `version` MUST be 0 and the
`SIGNED` flag MUST be set.

**AC-CARD-2** — A decoded card's byte layout MUST match the spec table exactly:
header (1) · pubkey (32) · created_at (4, uint32 BE) · name_len (1) · name
(`name_len`) · sig (64). A payload whose length is inconsistent with `name_len`
MUST be rejected as malformed.

**AC-CARD-3** — The v1 parser MUST be strict: decoding a card whose header
`version` bits are > 0, OR whose `HAS_AVATAR` bit is set, OR whose reserved flag
bits are non-zero, MUST be rejected (not silently parsed as v1). This keeps a future
avatar/extended layout from being misparsed by a v1 reader.

**AC-CARD-5** — The card encoder MUST emit a `name` of at most **32 UTF-8 bytes**. A
longer input nickname (possible for legacy profiles created before the cap) MUST be
truncated on a **codepoint boundary** (never mid-character, never a broken multi-byte
sequence) before signing — so the signed card is always ≤ 32 name bytes and always
valid UTF-8. The budget is bytes, not characters (a German/emoji nickname reaches the
cap in fewer characters).

**AC-CARD-7** — Setting the profile nickname MUST enforce the 32-UTF-8-byte cap: a
save with a nickname exceeding 32 UTF-8 bytes MUST be prevented or truncated at the
input, with a translated indication of the limit. After the cap ships, newly-saved
nicknames MUST NOT exceed 32 bytes, so the encoder-side truncation (AC-CARD-5) is a
migration backstop, not the common path.

**AC-CARD-6** — Encoding with the `SIGNED` flag unset (pubkey-only card) then
decoding MUST yield `{ pubkeyHex }` with **no** profile, and MUST NOT require a
`created_at`, `name`, or `sig`. Sharing when the user has no nickname set MUST
produce such an unsigned card (equivalent to sharing a bare npub).

**AC-CARD-4** — A signed card at the name cap (32 UTF-8 bytes) MUST encode to a
base64url payload of ≤ 180 characters, and the resulting onboarding URL
(`https://few.chat/add#c=…`) MUST be ≤ 205 characters — bounding the QR to ≤ version
9 at ECC-L (guards the QR-scannability budget; fixed signed overhead is 102 bytes +
name).

## Signature

**AC-SIG-1** — For a signed card, the signature MUST verify as a NIP-01 kind-0
event `{ pubkey, created_at, kind:0, tags:[], content: CARD_CONTENT(name) }` via
`verifyEvent`. A freshly encoded card MUST verify.

**AC-SIG-2** — A card whose `name` bytes have been altered after signing MUST fail
verification and MUST be rejected on import (the altered name MUST NOT be written to
`contactCache`).

**AC-SIG-3** — A card whose `pubkey` has been altered after signing MUST fail
verification and MUST be rejected on import.

**AC-SIG-4** — A card whose `sig` was produced by a key other than `pubkey` MUST
fail verification and MUST be rejected on import.

**AC-SIG-5** — Encode and decode MUST build `CARD_CONTENT` through one shared
helper; a card produced by the encoder MUST verify under the decoder with no
per-call canonicalization divergence. The round-trip MUST hold over names including
ones requiring JSON escaping (`"`, `\`), non-ASCII UTF-8 (German umlauts, emoji),
and an **unpaired surrogate** (which MUST be normalized or rejected at sign time so
the imported name is not silently mangled to U+FFFD, breaking verification).

**AC-SIG-6** — Verification MUST attach a computed `id = getEventHash(event)` to the
reconstructed kind-0 event before calling `verifyEvent`; a reconstruction that omits
`id` MUST NOT be treated as verifiable (guards against the always-false recipe where
`verifyEvent` rejects every `id`-less event).

## Parser (`parseContactCard`)

**AC-PARSE-1** — `parseContactCard` given a bare valid `npub…` MUST return
`{ pubkeyHex }` with the decoded hex pubkey and **no** `profile`.

**AC-PARSE-2** — `parseContactCard` given a card link (`…/add#c=<base64url>`) with a
valid signed card MUST return `{ pubkeyHex, profile: { nickname, updatedAt } }`
where `nickname` is the card name and `updatedAt` derives from the card
`created_at`.

**AC-PARSE-3** — `parseContactCard` given a raw base64url card payload (no URL
wrapper) with a valid signed card MUST return the same `{ pubkeyHex, profile }` as
AC-PARSE-2.

**AC-PARSE-4** — `parseContactCard` given a signed card whose signature does not
verify MUST return an error result and MUST NOT return a usable `pubkeyHex`+profile
pair (a card that fails integrity is not silently downgraded to a bare-pubkey add).

**AC-PARSE-5** — `parseContactCard` given input that is neither a valid npub nor a
decodable card MUST return an error result (not throw).

## Cache write & idempotency

**AC-CACHE-1** — Importing a valid signed card MUST upsert `contactCache` for the
card's pubkey with `nickname = card name` and `updatedAt = new Date(created_at *
1000).toISOString()` (an ISO-8601 string, matching the format all other writers use
so the lexical LWW comparison in `writeContactEntry` works), via `writeContactEntry`.

**AC-CACHE-2** — LWW MUST hold **across sources**, not just card-vs-card: importing a
card whose `created_at` predates an existing entry's ISO `updatedAt` (e.g. an entry
written by MLS profile sync) MUST NOT overwrite the newer cached nickname. (A test
that only compares two cards would pass even with a seconds-vs-ISO unit bug; this AC
requires a card-vs-ISO-entry case.)

**AC-CACHE-3** — Importing the same card twice MUST be idempotent — the second
import leaves `contactCache` unchanged.

**AC-CACHE-4** — Importing a name-only card for a pubkey whose cached entry already
has an avatar (populated by group profile sync) MUST preserve that avatar
(`avatar: readContactEntry(pubkey)?.avatar ?? null`), updating only the nickname —
a card import MUST NOT null out an existing avatar.

## Add-contact & deep-link UX

**AC-UX-1** — Pasting a card link (or raw card) into the Add Contact input and
submitting MUST add the contact (pubkey seeded into `knownPeers` and `contacts`,
per the existing `addContactByNpub` behavior) **and** populate the contact's
nickname from the card, so the new contact renders by name, not by shortened npub.

**AC-UX-2** — Scanning a card QR in the Add Contact scanner MUST behave identically
to AC-UX-1 (the scan path routes through `parseContactCard`).

**AC-UX-3** — Opening `/add#c=<valid card>` MUST parse the card (read from
`window.location.hash`) and drive the add-contact flow. The route MUST be a static
top-level page (`pages/add.tsx`) using a **hash fragment** (not a `?c=` query param,
so the card is not transmitted to the hosting infrastructure — DD 9) and MUST resolve
on direct load / reload.

**AC-UX-4** — The "Share contact card" action MUST produce a copy-able card link and
a scannable QR. The QR MUST encode the **full onboarding URL**
(`https://few.chat/add#c=<b64url>`), not the bare payload, so a native-camera scan
opens the app. Both carry the current user's signed card built with the active
signer. Card production MUST verify (AC-SIG-1) in local, NIP-07, and NIP-46 modes —
asserted via **adapter-level unit tests** (real `getEventHash`, stubbed remote
`sign`) since the Playwright rig has no bunker/extension, plus a local-mode e2e. The
signed card MUST be cached and rebuilt only when the nickname changes (no
remote-signer round trip on every share-modal open).

**AC-UX-7** — Opening `/add#c=<valid card>` as a visitor with **no local identity**
MUST route into onboarding (identity creation) rather than erroring, and after an
identity exists MUST complete the add of the card's contact. The card MUST survive
the onboarding step (the profile is not lost across identity creation) and MUST never
be transmitted to the server (fragment-only; AC-SEC-1 holds throughout).

**Superseded in part by `epic-first-visit-invite-welcome`** (AC-CONTACT-1,
AC-NAME-2): for a genuine first-time visitor (`isFreshIdentity`), "onboarding" now
means the blended first-visit welcome screen, not silent identity auto-generation —
the newcomer enters a name on that screen and completes the add from there. The
pre-existing behavior this AC originally exercised (auto-add completing silently,
then redirecting a nameless newcomer to `/profile?pairing=1`) no longer occurs for
this exact precondition; the name captured on the welcome screen satisfies the
pending-pairing-echo requirement inline instead. Full welcome-screen coverage lives
in `add-welcome.spec.ts`; `contact-card-deeplink.spec.ts`'s AC-UX-7 case was updated
in story S3 of that epic to drive the new entry point and now asserts only that the
one-directional add itself still completes.

**AC-UX-5** — Adding a contact via a bare npub (no card) MUST still succeed with no
nickname (the no-profile fallback is preserved).

**AC-UX-6** — The card's profile cache write is independent of the add result:
importing a card whose pubkey is **already an active contact** (so `addContactByNpub`
returns `already_exists`) MUST still refresh the cached nickname from the card when
the card's `updatedAt` is newer (LWW per AC-CACHE-2), even though no new contact entry
is created.

## Group invite by card

**AC-GRP-1** — Supplying a card (link, QR, or payload) to the group invite-by-npub
input MUST down-convert it to the card's `pubkeyHex` (via `parseContactCard`) and
invite through the existing `inviteByNpub` path. It MUST NOT write the card's name to
`contactCache` and MUST NOT create a `contacts`/`knownPeers` entry for the invitee
before the invite's MLS commit lands (the invited member's name arrives via the
group's MLS profile sync after joining, per DD 8).

**AC-GRP-2** — Group-invite-by-card MUST NOT change the KeyPackage dependency: if
the invitee has no published KeyPackage, the invite fails exactly as invite-by-npub
does today (the card does not substitute for a KeyPackage).

## Privacy invariant

**AC-SEC-1** — The card operations themselves — encoding/signing a card for sharing,
and parsing/verifying/caching an imported card — MUST NOT emit any relay event. (Card
exchange is entirely out-of-band.) This AC is scoped to those operations; it does
**not** cover a host operation the card feeds, such as group invite-by-card, whose
KeyPackage fetch and MLS commit legitimately use relays and carry no profile
metadata.

**AC-SEC-2** — The repository MUST contain no kind-0 metadata **publish** to public
relays after this epic (the prior `publishIdentityToRelays` broadcast is removed and
not reintroduced).

## Internationalization

**AC-INTL-1** — Every user-facing string added by this epic (share action, import
confirmation/errors, deep-link states) MUST have both `en` and `de` entries in
`app/src/lib/i18n.ts`, referenced via `useCopy()` — no hardcoded literals in
components.
