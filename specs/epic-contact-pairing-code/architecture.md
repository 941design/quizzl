# Architecture — Contact Pairing Code

Living operational document for the epic. All story agents read this. Paradigm and module
boundaries are derived from `exploration.json`; the two implementation decisions the spec
deferred (RD-4 signature preimage, RD-6 ack kind) are finalized here.

## Paradigm

Modular monolith, package-by-feature within `app/src/lib/`. Hexagonal seam at the two
external boundaries this feature crosses: the **wire format** (the pure codec) and the
**relay/gift-wrap transport** (reuse the existing NIP-59 layer). Pure computation
(codec, nonce validity math) stays free of React/storage/relay; stateful adapters
(idb-keyval stores, subscriptions) wrap it.

## Finalized decisions

### RD-4 — Signature preimage (domain-separated, not a publishable kind-0)

The v1 card signs `{kind:0, created_at, tags:[], content:'{"name":"…"}'}` — a **valid,
publishable profile-metadata event** any card holder could launder onto a public relay.
v2 closes this:

- The v2 signature is computed over a **synthetic nostr event with a fixed NON-ZERO kind**
  (`CARD_SIG_KIND_V2` — recommend `20602`, architect to confirm no in-repo collision) and a
  **domain-separated content** that embeds every v2 field the signature must cover:
  ```
  content = JSON.stringify({ v: 2, h: <headerByte>, exp: <expires_at>, nonce: <nonceHex>, name: <name> })
  ```
  Event `pubkey` = issuer x-only hex; event `created_at` = card `created_at`; `tags: []`.
- Because `kind !== 0` **and** the content is not a `{"name":…}` profile body, the preimage
  cannot be replayed as the user's kind-0 profile — the laundering vector is structurally
  closed, not merely unused.
- The signature therefore covers: header byte (via `h`), `created_at` (event field), pubkey
  (event field), `expires_at` (via `exp`), nonce (via `nonce`), and name (via `name`). No
  field can be resected across versions.
- Verify path reuses the existing primitives: reconstruct the identical synthetic event,
  `getEventHash`, `verifyEvent` (mirrors `decodeCard` today).

### RD-6 — Pairing-ack event kind + shape

- **Inner rumor kind = `PAIRING_ACK_KIND` (recommend `21060`)** — adjacent to the group
  join-request `21059`, verified **not** to collide with the sentinels the three kind-1059
  consumers already check (444, 21059, 5, 7, 14). Architect confirms no other in-repo use of
  `21060` before locking it.
- Rumor content shape: `{ type: 'pairing-ack', nonce: <echoedNonceHex>, card: <b64url v2-or-identity card> }`.
  The **enclosed card is identity-only (no nonce)** — reuse the codec to emit an identity card
  (or a v2 card whose nonce is ignored by the handler); the handler reads only pubkey+name+sig
  from it and binds to the gift-wrap sender.
- **No ack-of-ack.** Receiving a pairing-ack **never** triggers a further echo. Repeat acks
  from the same sender are idempotent (`knownPeers`/contacts are sets).
- Gift-wrapped (kind-1059) to the issuer's pubkey with an ephemeral sender key — reuse
  `directMessages.ts` `sealAndWrap`.

## Module map

| Module | Location | Purpose | Owned data |
|---|---|---|---|
| **codec** | `app/src/lib/contactCard.ts` (extend) | v2 wire format: header v2 code, nonce(16)/expiry(4) fields, RD-4 signature, strict parser, 4th nonce-bearing parse-result shape. **Stays pure.** | none (bytes in/out) |
| **issuer nonce store** | new `app/src/lib/pairing/nonceStore.ts` | Issued-nonce persistence (idb-keyval `few-pairing-nonces`), keyed by nonce → `{nonce, expiresAt}`. Mint/reuse active nonce (RD-2), retain through 2h grace, prune on issue + on ack-processing. Validity math (valid+grace) as a pure exported function. | issued nonces |
| **share lifecycle** | `app/src/lib/shareCard.ts` (extend) | Mint-on-reload/expiry active nonce (RD-2); add nonce as 4th `ShareCardCacheKey` dimension so QR refreshes on rotation. | active-nonce selection |
| **ack protocol** | new `app/src/lib/pairing/pairingAck.ts` | Build ack rumor (RD-6), send via gift wrap; handler: **strict** unwrap → validate echoed nonce vs issued+grace set → **sender-bind** → admit. Subscription registered in `welcomeSubscription.ts`. | none (stateless) |
| **pending intent** | new `app/src/lib/pairing/pendingIntent.ts` | Scanner-side persisted pending-pairing intent (idb-keyval `few-pairing-intents`): `{issuerPubkey, nonce, expiresAt}`. Retry queue drained on `window 'online'` + on app mount. Onboarding: fire echo when name becomes shareable, iff in window. | pending intents |
| **scanner import** | `app/pages/add.tsx`, `addDeepLink.ts`, `processContactInput.ts`, `contactCardImport.ts` (extend) | On v2 parse: named scanner → send echo now; nameless scanner → persist intent + **redirect to name setup** (RD-7). Graceful expiry fallback + AC-SCAN-2 copy suppression (the "they'll need to add you too" line is suppressed when the issuer already has the scanner). | none |
| **admission** | `app/src/lib/contacts.ts` / `knownPeers.ts` (reuse) | Ack handler admits B via `rememberKnownPeers([b])` **then** `rememberContact(b)` (ADR-005 ordering), **without** the `isAllowed` gate. | (existing) |
| **UI/i18n** | `NpubQrModal.tsx`, add/contacts views, `i18n.ts` (extend) | "works for 30 minutes" affordance; scanner honesty copy; admission digest ("N people paired"); friendly unknown-version copy (RD-5). en+de. | none |

## Boundary rules

1. **No direct imports across module boundaries except through declared seams.** The codec
   imports nothing stateful. `pairing/*` modules may import the codec and `directMessages`
   transport but not React.
2. **Sender binding is non-negotiable (security).** The ack handler MUST obtain sender
   identity via `directMessages.ts` `unwrapAndOpen` (asserts `rumor.pubkey === seal.pubkey`,
   line 262) — **NOT** `welcomeSubscription.ts`'s weak `unwrapGiftWrap`. Admit only the
   authenticated gift-wrap sender's pubkey, and only when the enclosed card's pubkey equals it.
3. **Walled-garden bypass is the ONE sanctioned stranger path.** The ack handler never calls
   `isAllowedDmSender`; it is gated solely by nonce-validity + sender-binding. No other new
   stranger-inbound path is introduced.
4. **Admission ordering (ADR-005).** `rememberKnownPeers` before `rememberContact`, always.
5. **Kind exclusion is automatic, not affirmative.** The three kind-1059 consumers fail-closed
   on unknown kinds; correctness depends only on `PAIRING_ACK_KIND` not colliding with
   444/21059/5/7/14. No exclusion code is added to `ContactChat.tsx`/`directMessageNotifications.ts`.
6. **Privacy invariant.** No code path publishes an unaddressed kind-0. B's card + nonce echo
   travel only as a gift wrap addressed to A. A story must include an explicit test asserting
   no public kind-0 publish occurs in the pairing flow.
7. **Store convention.** New idb-keyval stores use the `few-*` DB naming (not frozen `lp_*`),
   following `profileRequestStorage.ts`. `knownPeers` stays pure localStorage (unchanged).

## Seams (cross-story contracts)

- **S-codec→share/scanner:** `parseContactCard` gains a nonce-bearing result shape
  `{ pubkeyHex, profile?, pairing?: { nonce, expiresAt } }`. Share/scanner code reads `pairing`
  to decide whether to echo. Encode side adds `encodeCardV2(params incl. nonce, expiresAt)`.
- **S-nonceStore→ack-handler:** issued-nonce validity is a pure exported predicate
  `isNonceAdmissible(nonce, nowSec)` over the store's retained set (valid+2h grace). The ack
  handler calls it; the store owns pruning.
- **S-ack-subscription:** `welcomeSubscription.ts` dispatches `PAIRING_ACK_KIND` to
  `pairingAck.handlePairingAck(...)`, wired from `MarmotContext` like `onJoinRequestReceived`.
- **S-pendingIntent→onboarding:** scanner import writes a pending intent; a name-transition
  watcher (or the intent module's drain) fires the echo when `hasShareableName` flips true and
  the intent is still in-window.

## Implementation constraints

- Codec byte offsets computed from named length constants (as v1 does), not magic numbers.
- Nonce = 16 random bytes (`crypto.getRandomValues`). Expiry = `created_at + 30min` (issuer);
  grace = expiry + 2h (issuer validation only).
- Clock skew: expiry soft on issuer (grace); generous comparison on scanner side.
- Testing (per exploration): boundary math (expiry/grace) → `fake-indexeddb/auto`
  unit/integration test of `nonceStore` (mirror `profileRequestStorage.integration.test.ts`);
  codec → pure unit tests with real `nostr-tools`; e2e → drive real UI, inject a short
  `expires_at` via `page.evaluate` direct-IDB-write for the expired-code case (never hand-sign).
- E2E specs land in the relay bucket; update the Makefile + CLAUDE.md test tally.
