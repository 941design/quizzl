# Contact Pairing Code — Acceptance Criteria

## Terminology

- **A (issuer)** — the person showing/sharing the pairing code.
- **B (scanner)** — the person opening the code (scan or link).
- **active nonce** — the single, currently-live 16-byte pairing nonce A's
  device mints per RD-2; reused across repeated share-modal opens while
  unexpired; a new active nonce is minted on reload or on expiry.
- **grace window** — the 2-hour period after a nonce's `expires_at` during
  which A still admits a late echo for that nonce (RD-2/§5 of the source
  request).
- **pairing-ack** — the gift-wrapped (kind-1059) rumor B sends to A
  containing B's identity-only card and the echoed nonce (RD-6).
- **`PAIRING_ACK_KIND`** — the fixed, non-zero rumor kind for a pairing-ack
  (architecture.md recommends `21060`; exact value confirmed by the
  implementing story, MUST NOT collide with sentinels `444`/`21059`/`5`/`7`/`14`).
- **`CARD_SIG_KIND_V2`** — the fixed, non-zero synthetic-event kind the v2
  card signature is computed over (architecture.md recommends `20602`;
  MUST NOT be `0`).
- **pending pairing intent** — the scanner-side persisted record
  (`issuerPubkey`, `nonce`, card `expiresAt`) written when a nameless
  scanner opens a live code (RD-7).
- **admission** — A adding B to `knownPeers` + contacts as a result of a
  validated pairing-ack (as opposed to the pre-existing one-directional
  add that happens on every scan regardless of nonce).

## Known TAGs

- **CODEC** — v2 wire-format encode/decode/signature/backward-compat assertions.
- **NONCE** — issuer-side active-nonce lifecycle, persistence, grace, cache-key assertions.
- **SCAN** — scanner-side reciprocation, retry, and onboarding-deferred-echo assertions.
- **ACK** — pairing-ack rumor shape and no-ping-pong/idempotency assertions.
- **ADMIT** — issuer-side admission-decision and mutual-channel-outcome assertions.
- **SEC** — security-critical assertions (sender binding, kind isolation, chat-render exclusion).
- **PRIV** — privacy-invariant assertions (no public kind-0 / no broadcast).
- **UI** — user-visible copy and affordance assertions.
- **INTL** — translation-coverage assertions.

## Card format v2 (codec)

**AC-CODEC-1** — The v2 encoder MUST pack a header byte with version bits `01`
and MUST include a 4-byte big-endian `expires_at` field and a 16-byte `nonce`
field in the packed output; the decoder MUST round-trip `pubkeyHex`, `name`,
`nonce`, and `expiresAt` unchanged for a freshly encoded card.

**AC-CODEC-2** — Decoding a v2 card whose `nonce` bytes have been mutated
after signing, or whose `expires_at` bytes have been mutated after signing,
MUST fail signature verification; the decoder MUST NOT return the original
signed identity for either mutation.

**AC-CODEC-3** — The synthetic event constructed for the v2 signature (RD-4:
`kind = CARD_SIG_KIND_V2`, `content = JSON.stringify({v:2,h,exp,nonce,name})`)
MUST have `kind !== 0`, so that exact preimage submitted as a kind-0 publish
is not a well-formed profile-metadata event.

**AC-CODEC-4** — The decoder MUST reject a payload whose header encodes a
version other than `00` (v1) or `01` (v2), or whose `HAS_AVATAR` bit or any
reserved bit is non-zero, returning a parse failure rather than a
best-effort partial decode.

**AC-CODEC-5** — On the current build, `parseContactCard` MUST still accept
a v1-formatted card (header version `00`) and a bare `npub`/`nostr:` URI,
producing a one-directional add result (no `pairing` field) identical to
today's behavior.

**AC-CODEC-6** — For a name of `MAX_NAME_BYTES` (32), the v2 signed-card byte
length MUST equal the v1 signed-card length (`SIGNED_CARD_FIXED_OVERHEAD_BYTES`
+ name) plus exactly 20 bytes (4-byte `expires_at` + 16-byte `nonce`).

## Issuer-side nonce lifecycle

**AC-NONCE-1** — While the issuer's session remains live and the active
nonce is unexpired, repeated calls to `getOwnShareCard` MUST return a card
carrying the same nonce value (no rotation on repeat display).

**AC-NONCE-2** — A page reload MUST mint a fresh active nonce with a new
`expires_at` (`now + 30min`); the previously-active nonce MUST remain
retrievable from the nonce store and MUST continue to admit echoes until its
own `expiresAt` + 2h grace elapses.

**AC-NONCE-3** — When the active nonce expires while the session remains
live (no reload), the next call to `getOwnShareCard` MUST mint a new active
nonce with a fresh 30-minute `expires_at`.

**AC-NONCE-4** — The nonce store MUST persist each issued nonce keyed by its
value together with its `expiresAt`; a nonce MUST remain queryable from the
store for at least `expiresAt` + 2 hours.

**AC-NONCE-5** — An echoed nonce whose current time is at or before its
stored `expiresAt` + 2h grace MUST be classified admissible by the store's
exported validity predicate; an echoed nonce whose current time is after
that boundary MUST be classified inadmissible.

**AC-NONCE-6** — A nonce past its `expiresAt` + 2h grace MUST be removed
from the nonce store no later than the next call that issues a new nonce or
the next ack-processing pass, whichever occurs first.

**AC-NONCE-7** — `shareCard.ts`'s cache-key comparator MUST treat a changed
active nonce as a cache-invalidating dimension: a nonce rotation with
`nickname`/`signerMode`/`pubkeyHex` unchanged MUST still cause the
QR-producing card to be rebuilt.

## Scanner-side reciprocation

**AC-SCAN-1** — A scanner (B) with a shareable name who opens a v2 code
whose `expiresAt` has not yet passed (per B's own clock) MUST cause exactly
one gift-wrapped pairing-ack rumor to be sent, addressed to the issuer's
pubkey.

**AC-SCAN-2** — A scanner who opens a v2 code whose `expiresAt` has already
passed, or a v1/npub input carrying no `pairing` field, MUST complete the
one-directional add with the existing green confirmation and MUST NOT send
any pairing-ack rumor.

**AC-SCAN-3** — If the pairing-ack publish attempt fails (e.g., offline),
the pending echo MUST be persisted rather than dropped, and MUST be retried
when a subsequent `online` event fires.

**AC-SCAN-4** — The copy shown to the scanner immediately after a
successful add-with-pairing MUST communicate that reciprocation is in
flight (e.g., "they should see you shortly") and MUST NOT claim a
mutual/"connected" state, since no ack-of-ack exists to confirm A's
admission.

**AC-SCAN-5** — A scanner for whom `hasShareableName` is false at the
moment of opening a live v2 code MUST be routed to the name-setup screen
before landing on the issuer's contact, and MUST have a pending pairing
intent (`issuerPubkey`, `nonce`, card `expiresAt`) persisted.

**AC-SCAN-6** — When a scanner with a persisted pending pairing intent sets
a name and `hasShareableName` becomes true while the current time is still
at or before the intent's `expiresAt`, the pairing-ack echo MUST fire
automatically with no further user action.

**AC-SCAN-7** — When a scanner with a persisted pending pairing intent sets
a name after the intent's `expiresAt` has already passed, no pairing-ack
MUST be sent and no error MUST be surfaced; the add remains
one-directional.

**AC-SCAN-8** — A scanner for whom `hasShareableName` is already true at the
moment of opening a live v2 code MUST NOT be redirected to name setup; the
echo fires per AC-SCAN-1 with no name-setup detour.

## Pairing-ack protocol

**AC-ACK-1** — The pairing-ack rumor built for sending MUST have
`kind = PAIRING_ACK_KIND` and content `{type:'pairing-ack', nonce:<echoedNonceHex>, card:<b64url>}`
where `card`, decoded via the codec, yields an identity-only card (no
`pairing`/nonce field) whose `pubkeyHex` equals the sender's own pubkey.

**AC-ACK-2** — Processing a received pairing-ack rumor MUST NOT itself
construct or send a further pairing-ack rumor: the ack handler's only side
effects are `knownPeers`/contact admission, never an outbound ack.

**AC-ACK-3** — A second pairing-ack received from a sender pubkey already
present in `knownPeers` from a prior admitted ack MUST be processed
idempotently: no duplicate contact entry is created and the
admission-digest count is not incremented a second time for that sender.

## Issuer-side admission

**AC-ADMIT-1** — On receipt of a pairing-ack whose echoed nonce is
admissible and whose enclosed card signature verifies, the issuer's handler
MUST call `rememberKnownPeers` for the authenticated sender's pubkey before
calling `rememberContact` for that pubkey (ADR-005 ordering).

**AC-ADMIT-2** — A pairing-ack whose echoed nonce is not present in the
issuer's issued-nonce set, or is present but inadmissible per grace, MUST
produce no admission (`knownPeers`/contacts unchanged) and MUST NOT surface
an error to the issuer.

**AC-ADMIT-3** — Two distinct authenticated senders each echoing the same
still-admissible nonce MUST both be independently admitted; admitting the
first sender MUST NOT remove the nonce from the admissible set for the
second.

**AC-ADMIT-4** — The pairing-ack handler MUST NOT call `isAllowedDmSender`
when deciding admission; every other rumor-consumption call site's existing
`isAllowedDmSender` gating MUST remain unchanged.

**AC-ADMIT-5** — After A admits B via a valid pairing-ack, a DM
subsequently sent by B to A MUST be accepted by A's walled garden
(`isAllowedDmSender` returns true for B), where the identical DM would have
been rejected before admission.

**AC-ADMIT-6** — After a single scan (B opens A's code) with successful
mutual admission, A MUST be able to send a DM to B and B MUST be able to
send a DM to A, both without either party performing a second scan.

## Security (sender binding & kind isolation)

**AC-SEC-1** — A pairing-ack gift wrap whose enclosed card names a pubkey
different from the gift wrap's authenticated NIP-59 sender
(`rumor.pubkey !== seal.pubkey`) MUST result in NO admission of the
enclosed card's named pubkey; only the authenticated sender's pubkey may
ever be admitted from that gift wrap.

**AC-SEC-2** — The pairing-ack handler MUST derive the authenticated sender
via a primitive that asserts `rumor.pubkey === seal.pubkey`
(`directMessages.ts`'s `unwrapAndOpen`, or an equivalent replicating that
check) and MUST NOT use `welcomeSubscription.ts`'s local `unwrapGiftWrap`,
which does not assert that equality.

**AC-SEC-3** — `PAIRING_ACK_KIND` MUST NOT equal any of the existing
sentinel kinds `444`, `21059`, `5`, `7`, or `14`.

**AC-SEC-4** — A received pairing-ack rumor (kind `PAIRING_ACK_KIND`) MUST
NOT render as a chat message in `ContactChat.tsx` and MUST NOT trigger
`directMessageNotifications.ts`'s notification bell; only
`welcomeSubscription.ts`'s pairing-ack branch performs positive handling of
that kind.

## Cross-Cutting Invariants

**AC-PRIV-1** — No function reachable from the pairing flow (code
generation, share-modal render, scan/import, echo send, ack
receipt/admission) MUST call any relay-publish primitive with an
unaddressed kind-0 event; the only outbound pairing traffic is the
gift-wrapped (kind-1059) pairing-ack addressed to a single recipient
pubkey.

## UI & i18n

**AC-UI-1** — The share modal (`NpubQrModal.tsx` / the profile share
affordance) MUST display copy communicating the code's ~30-minute validity
window whenever a share card is shown.

**AC-UI-2** — When 2 or more distinct senders are admitted for the
currently-active nonce, the issuer's UI MUST show a single digest
notification (e.g., "N people paired with your code") rather than one
toast per admission.

**AC-UI-3** — Importing a card whose header version byte the current codec
does not recognize (neither `00` nor `01`) MUST show friendly "update your
app" copy rather than a raw error/exception surface.

**AC-INTL-1** — Every new user-facing string introduced by this epic
(30-minute affordance, scanner honesty copy, admission digest,
unknown-version copy, name-setup redirect prompt) MUST have both an `en`
and a `de` entry in `i18n.ts`'s `Copy` type and in both the `en` and `de`
`Copy` objects.

## Manual Validation

| MV id | Behavioral intent | Owner | Blocked on |
|-------|-------------------|-------|------------|
| MV-1  | A v2 code (payload ~20 bytes larger than v1, per AC-CODEC-6) rendered at the current ECC level in `NpubQrModal.tsx` remains reliably scannable by a phone camera at typical viewing distance. | implementer / QA | AC-CODEC-6 |
