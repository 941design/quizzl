# Contact Pairing Code (reciprocal, time-boxed)

**Status**: Validated 2026-07-11 — decisions signed off, ready for planning.
**Supersedes**: `specs/epic-contact-card-exchange/` (identity-only Contact Card v1).
**Source request**: `specs/contact-pairing-code-spec-request.md` (Rev 2).

## Problem

Adding a contact is one-directional today. When A shows a QR/link and B opens it, B
adds A (B can receive from A), but A has not added B — so B's first message to A is
dropped by the inbound walled garden as a stranger (`app/src/lib/walledGarden.ts`,
`isAllowedDmSender`). A working two-way conversation therefore requires a **full mutual
exchange**: A scans B *and* B scans A — two physical scans.

This feature collapses that to **one scan**. A's shared code carries a short-lived
**nonce**; when B opens it, B's client privately echoes that nonce back to A; A
recognises its own nonce and **auto-admits B**. After a single scan, both directions
work — no second scan, no manual add on A's side.

### Locked product decisions

1. **Replace** the current contact card. Every generated card is now a pairing code.
   There is no separate "durable card" mode.
2. **Default validity: 30 minutes** from generation.
3. **Multi-use within the window.** The nonce is *not* burned on first use; any number
   of people who open the code before it expires are admitted. After expiry it admits
   no one.

### Outcome (behaviour)

- Two people meet, **one** shows their code, the other opens it, and both can
  immediately message each other. The "now show me yours" second step is gone.
- A meetup host can display one code for 30 minutes and everyone in the room pairs
  from it.
- A leaked code (screenshot, forwarded photo, shoulder-surf) is a liability for its
  30-minute window plus a short post-expiry grace (**2 hours**) during which a
  genuinely-late echo from a briefly-offline issuer can still land — then inert.

## Resolved Decisions (sign-off 2026-07-11)

These supersede §9 of the source request. The three product/privacy calls were signed
off by the requester; the three implementation calls are the lead's, documented here
and finalized in `architecture.md`.

- **RD-1 (was Q1) — No npub fallback.** There is **no** separate "copy npub" action.
  The existing QR **and** direct-link copy (`buildShareUrl` → `https://few.chat/add#c=…`)
  are retained exactly as now; both now carry the 30-minute v2 pairing code. The durable
  "permanent handle on a website" affordance is intentionally dropped. **No new share-UI
  path is added for npub.** (Import still accepts a bare `npub`/`nostr:` URI
  one-directional, unchanged — that is import-side only.)
- **RD-2 (was Q2) — Single rolling active nonce, minted on reload OR expiry.** While the
  page/session is live the active nonce is stable and reused every time the code is shown
  (the meetup-host scenario works). A **site reload mints a fresh active nonce** (new
  30-min window); the previously-active nonce is **not** invalidated — it remains in the
  issued set and keeps admitting until its own `expires_at` + 2h grace, so codes already
  shared before the reload still pair. Expiry of the active nonce also mints a new one on
  next open.
- **RD-3 (was Q3) — Silent auto-send.** On opening a live code, B's client auto-sends the
  pairing acknowledgement (B's identity-only card + echoed nonce) to A with **no**
  first-time consent notice and **no** per-pairing confirmation. The direction-of-disclosure
  reversal (A learns B's name + that B added them) is accepted silently. **This removes the
  consent-notice UI and its i18n copy entirely.** (Scanner-side *honesty* copy — RD/AC-PAIR-12,
  "they should see you shortly", never "connected" — is a separate requirement and stays.)
- **RD-4 (was Q4) — Signature preimage, domain-separated.** The card signature MUST cover
  the header/version byte **and** the nonce **and** `expires_at` (so no field can be resected
  across versions). The preimage MUST NOT be a well-formed, publishable kind-0 event (v1's
  weakness), to foreclose laundering a card onto a public relay as the user's profile. Exact
  preimage finalized in `architecture.md`.
- **RD-5 (was Q5) — Old-build UX.** Scope reduces to: the *current* release's
  unknown-version parse error shows friendly "update your app" copy. Not a v2-generation
  concern.
- **RD-6 (was Q6) — Ack rumor kind + shape.** A distinct Nostr event kind for the pairing
  acknowledgement (analogous to the kind-21059 group join-request); exact kind finalized in
  `architecture.md` and MUST NOT collide with sentinels 444/21059/5/7/14. The enclosed card is
  **identity-only (no nonce)**. Receiving an ack **never** triggers a further echo (forecloses
  ping-pong). Repeat acks from the same sender are idempotent (`knownPeers` is a set).
- **RD-7 (onboarding routing; surfaced during exploration) — Redirect to name setup.** Today
  the app has **no** onboarding→name-setup routing; a fresh `/add` visitor lands on the contact
  list with an empty name and is never prompted. For AC-PAIR-10 to be reliable, a nameless
  scanner who opens a live code is **routed to the name-setup screen before landing on the
  contact**. The held pending-pairing intent (issuer pubkey + nonce + card `expires_at`) fires
  the echo **automatically** once a name is set, **iff still within the window**; if the window
  closed first, it degrades to one-directional with no error. A scanner who already has a name
  is unaffected (no redirect).

## How pairing works (end to end)

Actors: **A** = issuer (shows the code), **B** = scanner (opens it).

1. **A generates a code.** A's client mints/reuses an active pairing nonce (16 random
   bytes) with `expires_at = now + 30min` per RD-2, persists it locally, and builds a
   signed v2 card: identity (x-only pubkey + signed name, as v1) **+ nonce + expiry**.
   Rendered as the existing `https://few.chat/add#c=<b64url>` link/QR (`buildShareUrl`,
   `NpubQrModal`).
2. **B opens the code** (scan or link → `/add` → `addDeepLink.ts` →
   `processContactInput.ts`). B parses A's card, adds A to contacts + `knownPeers`
   (unchanged behaviour), lands on the A contact with the existing green confirmation.
3. **B echoes the nonce.** If the card carries a nonce that is **not expired** (B's clock
   vs card `expires_at`), B's client sends A a **gift-wrapped** pairing-acknowledgement
   rumor containing **B's own signed identity-only card** and the **echoed nonce**.
   Gift-wrapped to A's pubkey with an ephemeral sender key — a private, addressed message,
   never a broadcast. Per RD-3 this is silent (no consent prompt).
4. **A admits B.** A subscribes for pairing-ack gift wraps. On receipt, A admits **only**
   if ALL hold:
   - the echoed nonce is one A issued and still within validity + the 2h grace;
   - the enclosed card's signature is valid; **and**
   - **sender binding (mandatory):** the enclosed card's pubkey equals the *authenticated
     sender* of the gift wrap. NIP-59 unwrap already recovers and asserts the true sender
     (`directMessages.ts` enforces `rumor.pubkey === seal.pubkey`); admission MUST bind to
     that pubkey and admit *that* pubkey only. Without this, a harvested third-party card
     could inject a pubkey that never saw the code.

   On success A adds B to contacts + `knownPeers`; A now accepts B's DMs.
5. **Both directions now open.** B was admitted-for-inbound at step 2; A is
   admitted-for-inbound at step 4. One scan, mutual channel.

If the nonce is **absent, expired (past grace), or unrecognised by A**, the flow degrades
to today's one-directional add (step 2 only) — no error. If A already had B, say nothing
about A needing to add back.

### Scanner has no identity/name yet (onboarding case)

`/add` is the onboarding deep link, so the common case is B opening the code **before**
having an identity or nickname. B cannot sign a card without a name (`hasShareableName`;
`getOwnShareCard` throws otherwise). Required behaviour (per **RD-7**): persist the pending
pairing intent (issuer pubkey + nonce + card `expires_at`) and **route B to the name-setup
screen before landing on the contact**. Identity itself is auto-generated on first mount
(`NostrIdentityContext.init`), so the missing piece is only the name. Once B sets a name, the
held intent fires the echo **automatically, iff still within the window**; if the window
closed first, degrade to one-directional add with no error. A scanner who already has a name
takes the existing path (no redirect, echo fires immediately).

### Silent one-directional failure (scanner-side honesty)

Three paths leave B believing pairing succeeded while A never admits: (a) B's echo publish
fails; (b) A was offline past grace and pruned the nonce; (c) B's clock rejected a live
code. There is deliberately no ack-of-ack. Therefore:

- **Persist and retry** the scanner-side echo (queue it; resend on next connectivity)
  rather than firing once and forgetting.
- **Do not overclaim in B's UI.** Success copy is "You've added X — they should see you
  shortly," not "You're connected."
- Heal path: A can add B manually later; a subsequent DM that reaches an admitted inbox
  repairs the channel.

## Card format v2 (wire shape)

Extends `contactCard.ts` "Contact Card Format v1". A v2 code is **always signed** (a name
is required to share) and **always carries nonce + expiry**.

```
header (1 byte)      bits 7–6 = version (v2 = 01), bit 5 = SIGNED (always 1),
                     bit 4 = HAS_AVATAR (reserved 0), bits 3–0 reserved (0).
pubkey (32 bytes)    raw x-only secp256k1 public key.
created_at (4 bytes) uint32 BE, Unix seconds (as v1; anchors the signature).
expires_at (4 bytes) uint32 BE, Unix seconds — hard validity edge.   ← new
nonce (16 bytes)     random pairing nonce.                            ← new
name_len (1 byte)    UTF-8 byte length of name (0–32).
name (name_len)      UTF-8 display name.
sig (64 bytes)       signature per RD-4 (covers header + nonce + expires_at; not a
                     publishable kind-0 preimage).
```

- Keep the codec **pure/side-effect-free** (bytes in/out, sign/verify) as v1 is.
- Keep the v1 **strict-parser discipline**: a v2 reader rejects unknown versions/reserved
  bits.
- Payload grows ~20 bytes (~27 b64url chars). Re-check QR density at the current ECC level
  in `NpubQrModal` (v1 uses ECC-L).

## Issuer-side nonce lifecycle (A's device)

- **Single rolling active nonce**, minted on reload or expiry per RD-2; reused while
  unexpired and the session is live.
- **Do not burn on use** — multi-use within the window is required.
- **Persist issued nonces locally** (idb-keyval) with their `expires_at`. Retain each for
  a **2-hour grace past expiry** so a legitimately-late echo still admits. Validate echoes
  against this retained set; **prune on the next issue or ack-processing pass** (define the
  exact moment — do not leave "prune afterwards" vague). A leaked code is a liability for
  ~2.5h total.
- **Rebuild cache** (`shareCard.ts getOwnShareCard`, keyed today on
  `{nickname, signerMode, pubkeyHex}`) must also key on the **active nonce** so the QR
  refreshes when the nonce rotates.

### Admission-path requirements (easy to get wrong)

- **Exempt the pairing-ack kind from the inbound walled garden.** The ack sender is by
  definition a stranger; if routed through `isAllowedDmSender` the feature never works. The
  ack handler is the *one* sanctioned stranger-inbound path, gated instead by the nonce +
  sender-binding checks above.
- **Exclude the pairing-ack kind from chat rendering.** *(Corrected during exploration —
  the source request's "MarmotContext + ChatStoreContext" framing is stale: `ChatStoreContext`
  no longer consumes gift-wraps at all.)* The real kind-1059 gift-wrap consumers are **three**
  files — `welcomeSubscription.ts`, `ContactChat.tsx`, and `directMessageNotifications.ts` —
  and **all three already fail-closed on an unrecognized `rumor.kind`**. Therefore ack-exclusion
  from chat bubbles and the notification bell is **automatic**, *provided the chosen ack kind
  number does not collide with existing sentinels* (444 Welcome, 21059 join-request, 5
  delete/edit, 7 reaction, 14 chat message). No affirmative "exclude" code is required in
  `ContactChat.tsx` or `directMessageNotifications.ts`; only positive-handling code is added in
  `welcomeSubscription.ts` (the ack subscription's home).
- **Sender-binding hazard (mandatory).** `welcomeSubscription.ts`'s local `unwrapGiftWrap`
  does **not** assert `rumor.pubkey === seal.pubkey`. The pairing-ack handler MUST NOT reuse it
  for the security check — it must use `directMessages.ts` `unwrapAndOpen` (which enforces the
  binding at line 262) or replicate its seal-verify + `rumor.pubkey === seal.pubkey` +
  event-hash checks. Picking the wrong unwrap silently drops the sender binding.
- **Admission-flood UX.** Multi-use + no-burn + auto-admit means a code posted to a hostile
  audience yields unbounded automatic admissions **within the window** (bounded in time,
  unbounded in count — accepted). The UI SHOULD blunt it: replace per-admission "X added
  you" toasts with a **digest** ("3 people paired with your code").

## Privacy invariant compliance (mandatory)

- **No public kind-0, no broadcast of profile data.** A's name lives only in the
  locally-shown QR; B's card + nonce echo travel **only** as a NIP-59 gift wrap addressed
  to A, sender hidden by an ephemeral key.
- The **nonce is not identity** and reveals nothing on its own.
- Reading/importing A's card induces **no** public broadcast of B's data.
- The implementation MUST include an explicit check that no code path publishes an
  unaddressed kind-0 as part of pairing.

## Security model (accepted tradeoffs)

- **Bearer capability, by design.** Anyone who captures the code and echoes the nonce from
  their own key is admitted (multi-use). Blast radius bounded to 30-min window + 2h grace.
- **Replay after grace:** rejected — A only admits nonces in its valid+grace set.
- **Third-party card injection:** prevented **only** by the step-4 sender binding.
- **Name spoofing:** prevented — both cards signed; nonce/expiry signed into A's card
  (RD-4).
- **Junk acks / DoS:** A cheaply rejects unknown nonces via a local set lookup.
- **Clock skew:** expiry soft on issuer side (grace); generous comparison on B's side.

## Scope

### In scope

- v2 codec in `contactCard.ts` (nonce/expiry fields, RD-4 signature) + strict parser.
- Issuer nonce store (idb-keyval) + `shareCard.ts` lifecycle & rebuild-cache key.
- Scanner-side reciprocation: send pairing ack on unexpired scan; persist+retry queue;
  onboarding-deferred echo.
- Issuer-side pairing-ack subscription → validate nonce → sender-bind → auto-admit
  (`knownPeers`/walled garden), with kind excluded from both chat-render listeners.
- UI: "works for 30 minutes" affordance on the share modal; scanner honesty copy;
  admission digest; friendly unknown-version import copy (RD-5). i18n en+de for all new
  strings.
- Unit tests (codec round-trip, strict rejection, signature-covers-nonce/expiry, nonce
  lifecycle, admission validation incl. sender-binding) + e2e specs (relay bucket).

### Out of scope

- MLS group invites (own nonce handshake already exists).
- Avatar in the card (`HAS_AVATAR` stays reserved 0).
- Server-side nonce registry (static export; no backend).
- **Multi-device** — issued-nonce store and `knownPeers` are per-device; a code issued on
  device 1 is honoured only by device 1. Stated as a known limitation.
- New identity tier / key rotation.
- **No npub-copy UI** (RD-1). **No reciprocation consent notice** (RD-3).

## Constrained by ADRs

- **ADR-008** — Block is a deny layer AND-ed at every peer-signal channel, keyed on
  `archivedAt`. The pairing-ack issuer push (Step 10/11 of the pairing-ack subscription
  below) and the pending pairing-echo drain (`pendingIntent.ts`) both emit an outbound
  signal to the pairing peer and were found to leak that signal to a blocked peer
  post-epic (`epic-block-contact` amendments, AC-PRIV-4/AC-PRIV-5); any future change to
  those paths must keep composing the block deny-gate, not just the walled-garden allow
  check.
- **ADR-009** — Require issuer confirmation before admitting a scanned contact.
  `epic-pending-contact-confirmation` (2026-07-15) deliberately supersedes this epic's
  `AC-ADMIT-6` and `AC-PAIR-4` on their "both directions work *immediately*" clause only
  — the "no second scan" guarantee still holds in full. See ADR-009 for the
  bearer-credential rationale.

## Technical Approach (affected files)

- `app/src/lib/contactCard.ts` — v2 codec (nonce/expiry, RD-4 signature), strict parser.
- `app/src/lib/shareCard.ts` — nonce lifecycle + rebuild-cache key.
- New: issuer nonce store (idb-keyval) + pairing-ack subscription/handler (alongside DM /
  join-request subscriptions in `MarmotContext` / DM layer).
- `app/pages/add.tsx`, `app/src/lib/addDeepLink.ts`, `app/src/lib/processContactInput.ts`,
  `app/src/lib/contactCardImport.ts` — scanner-side reciprocation + graceful expiry
  fallback + onboarding-deferred echo.
- `app/src/lib/knownPeers.ts` / `walledGarden.ts` — admission on valid echo (ADR-005
  ever-known-peers trust extends cleanly; ADR-002 mutual-graph direction consistent).
- `app/src/components/groups/NpubQrModal.tsx` / `NpubQrScanner.tsx` — QR density check,
  "works for 30 minutes" affordance.
- `app/src/lib/i18n.ts` — new copy (en + de).

## Non-Goals

See "Out of scope" above. Additionally: no change to the one-directional import path for
legacy v1 cards / bare npub (must keep working on current builds — AC-PAIR-8).

## Acceptance criteria

See `acceptance-criteria.md` (planner-authored from §10 of the source request, adjusted for
RD-1/RD-3 which remove the npub-copy and consent-notice ACs).

## Suggested implementation order

1. v2 codec in `contactCard.ts` (+ unit tests).
2. Issuer nonce store + `shareCard.ts` lifecycle & cache key.
3. Scanner-side reciprocation + graceful expiry fallback + onboarding deferral.
4. Issuer-side pairing-ack subscription → validate → sender-bind → auto-admit.
5. UI affordances + i18n en/de.
6. E2E specs (relay bucket).

## Amendments

- **2026-07-12 (S4 review, lead decision) — returning scanner reciprocates.** When a scanner
  opens a live v2 code for an issuer they *already* have as a contact (`addContactByNpub` →
  `already_exists`), the scanner still sends the pairing echo in the background (gated on the
  card's unexpired `pairing` field), so the mutual channel completes even when the scanner had
  previously added the issuer one-directionally. This applies the locked "one scan → mutual,
  silent auto-send" behavior (RD-3, §1) to the already-known-contact branch; it introduces no
  new UI (the existing already-exists confirmation is unchanged) and no new product decision.
  Closes the sev-5 gap the S4 review surfaced.
