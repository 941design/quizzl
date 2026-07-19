# Feature Specification Request: Contact Pairing Code (reciprocal, time-boxed)

> **Status:** request / pre-spec. Supersedes the identity-only Contact Card v1
> (`epic-contact-card-exchange`). Hand to `/base:feature` to produce the
> implementation spec + acceptance criteria.
>
> **Rev 2** — incorporates a critical design review. Two blockers were closed in
> the text (sender-binding on admission, §3.step4 + §8; and a truthful validity
> window, §5 + §8). Post-expiry grace fixed at **2 hours** (requester decision).
> Added: onboarding-scanner path (§3.1), walled-garden/render exemptions (§5.1),
> silent-failure handling (§3.2), signature hardening (§9 Q4), multi-device
> non-goal (§1.2). Search "REVIEW:" for the specific dispositions.

## 1. Intent

Today, adding a contact is **one-directional**. When A shows a QR/link and B
opens it, B adds A (B can now receive from A), but A has not added B — so B's
first message to A is dropped by the inbound walled garden as a stranger
(`app/src/lib/walledGarden.ts`, `isAllowedDmSender`). A working two-way
conversation therefore requires a **full mutual exchange**: A scans B *and* B
scans A — two physical scans.

This feature collapses that to **one scan**. A's shared code carries a
short-lived **nonce**; when B opens it, B's client privately echoes that nonce
back to A; A recognises its own nonce and **auto-admits B**. After a single
scan, both directions work — no second scan, no manual add on A's side.

**Locked product decisions (from the requester):**

1. **Replace** the current contact card. Every generated card is now a pairing
   code. There is no separate "durable card" mode.
2. **Default validity: 30 minutes** from generation.
3. **Multi-use within the window.** The nonce is *not* burned on first use; any
   number of people who open the code before it expires are admitted. After
   expiry it admits no one.

### 1.1 Outcome (behaviour)

- Two people meet, **one** shows their code, the other opens it, and both can
  immediately message each other. The "now show me yours" second step is gone.
- A meetup host can display one code for 30 minutes and everyone in the room
  pairs from it.
- A code that leaks (screenshot, forwarded photo, shoulder-surf) is a liability
  for its 30-minute window plus a short post-expiry grace (**2 hours**, see §5)
  during which a genuinely-late echo from a briefly-offline issuer can still
  land — then inert. The "works for 30 minutes" affordance is what the *scanner*
  must act within; the grace is issuer-side tolerance for delivery lag, not an
  extension of the code's advertised life.

### 1.2 Non-goals (this iteration)

- No change to MLS group invites (those already have their own nonce handshake —
  `inviteLinkGeneration.ts` / kind-21059 join requests). This is DM/contact
  pairing only.
- No avatar in the card (the `HAS_AVATAR` header bit stays reserved).
- No server-side nonce registry — the app is a static export
  (`output: 'export'`, no backend). Nonce state lives on the issuer's device.
- No new identity tier, no key rotation.
- **Multi-device is out of scope.** The issued-nonce store and `knownPeers` are
  per-device (idb-keyval). A code issued on device 1 is only honoured by
  device 1; a second device that imported the same identity will not admit the
  scanner and its contact list may diverge. REVIEW (S7): stated as a non-goal so
  it is a known limitation, not a surprise.

## 2. Behaviour changes & consequences (read first)

Because we **replace** the card rather than add a mode, "replace" has a
first-order consequence the requester has accepted, and it must be visible in
the eventual UI:

- **A shared link/QR now expires in 30 minutes.** A code texted, emailed, put on
  a slide, or printed on a business card **stops working** after the window.
  This is intended, but it removes the "permanent identity link" affordance the
  v1 card implicitly had.
- **Mitigation / open decision:** keep a plain **npub copy** action for the
  durable "put my handle on a website" case (import already accepts a bare
  `npub` / `nostr:` URI, one-directional, in `parseContactCard`). The *pairing
  QR* becomes the live, in-person path; the *npub* remains the durable,
  manual-add path. Confirm this split (see §9, Q1).
- **Old app builds reject new codes.** v1 is a strict parser that rejects any
  unknown version. Users still on an old PWA build will fail to import a v2
  code until they update. New builds import both v1 and v2 (see §6).

## 3. How pairing works (end to end)

Actors: **A** = issuer (shows the code), **B** = scanner (opens it).

1. **A generates a code.** A's client mints/reuses an active pairing nonce
   (16 random bytes) with `expires_at = now + 30min`, persists it locally, and
   builds a signed v2 card: identity (x-only pubkey + signed name, as v1) **+
   nonce + expiry**. Rendered as the existing `https://few.chat/add#c=<b64url>`
   link/QR (`buildShareUrl`, `NpubQrModal`).
2. **B opens the code** (scan or link → `/add` → `addDeepLink.ts` →
   `processContactInput.ts`). B parses A's card, adds A to contacts +
   `knownPeers` (unchanged today's behaviour), lands on the A contact with the
   existing green confirmation.
3. **B echoes the nonce.** If the card carries a nonce that is **not expired**
   (B's clock vs card `expires_at`), B's client sends A a **gift-wrapped**
   ("pairing acknowledgement") rumor containing **B's own signed card**
   (identity + name) and the **echoed nonce**. Gift-wrapped to A's pubkey with
   an ephemeral sender key — a private, addressed message, never a broadcast.
4. **A admits B.** A subscribes for pairing-ack gift wraps. On receipt, A admits
   **only** if all of the following hold:
   - the echoed nonce is one A issued and still within validity + the 2h grace;
   - the enclosed card's signature is valid; **and**
   - **REVIEW (B1 — sender binding, mandatory):** the enclosed card's pubkey
     equals the *authenticated sender* of the gift wrap. The app's NIP-59 unwrap
     already recovers and asserts the true sender
     (`directMessages.ts` enforces `rumor.pubkey === seal.pubkey`); admission
     MUST bind to that pubkey and admit *that* pubkey only. Without this, a
     signed card is a transferable artifact — anyone who ever saw B's card holds
     a valid copy and could echo A's captured nonce with *harvested third-party
     cards*, injecting pubkeys that never saw the code into A's contacts. The
     card's signature proves only "this name belongs to this key"; the sender
     binding proves "this key is the one pairing with you now." Both are
     required.

   On success A adds B to contacts + `knownPeers`; A now accepts B's DMs.
   Optionally notify "X added you" (see §5.1 on de-duplicating a flood).
5. **Both directions now open.** B was already admitted-for-inbound at step 2;
   A is admitted-for-inbound at step 4. One scan, mutual channel.

If the nonce is **absent, expired (past grace), or unrecognised by A**, the flow
degrades to today's one-directional add (step 2 only) — no error, just the old
"they'll need to add you too" outcome (copy caveat: if A already had B, say
nothing about A needing to add back).

### 3.1 Scanner has no identity/name yet (the onboarding case)

REVIEW (S1): `/add` is the onboarding deep link, so the **common** case is B
opening the code **before** having an identity or a nickname. B cannot sign a
card without a name (`hasShareableName`; `getOwnShareCard` throws otherwise), so
B has nothing to echo. Required behaviour: **defer the echo** until B has
completed identity + name setup, then send it **iff the code is still within its
window** (persist the pending pairing intent — pubkey + nonce + the card's
`expires_at` — across onboarding). If the window has closed by the time B is
ready, degrade to one-directional add. This path must be specified, not left to
the implementer.

### 3.2 Silent one-directional failure (scanner-side honesty)

REVIEW (S5): three paths leave B believing pairing succeeded while A never
admits — (a) B's echo publish fails (B went offline right after scanning);
(b) A was offline past the grace and pruned the nonce; (c) B's clock rejected a
live code. There is deliberately **no** ack-of-ack, so B cannot know A admitted
it. Therefore:

- **Persist and retry** the scanner-side echo (queue it; resend on next
  connectivity) rather than firing once and forgetting.
- **Do not overclaim in B's UI.** The success copy is "You've added X — they
  should see you shortly," not "You're connected." The honest state is
  "added, reciprocation in flight."
- Note the heal path: if reciprocation never lands, A can still add B manually
  later, and a subsequent DM from either side that reaches an admitted inbox
  repairs the channel.

## 4. Card format v2 (recommended wire shape)

Extends `contactCard.ts` "Contact Card Format v1". A v2 code is **always signed**
(a name is already required to share — `hasShareableName`) and **always carries
nonce + expiry**.

```
header (1 byte)      bits 7–6 = version (v2 = 01), bit 5 = SIGNED (always 1),
                     bit 4 = HAS_AVATAR (reserved 0), bits 3–0 reserved (0).
pubkey (32 bytes)    raw x-only secp256k1 public key.
created_at (4 bytes) uint32 BE, Unix seconds (as v1; anchors the signature).
expires_at (4 bytes) uint32 BE, Unix seconds — hard validity edge.   ← new
nonce (16 bytes)     random pairing nonce.                            ← new
name_len (1 byte)    UTF-8 byte length of name (0–32).
name (name_len)      UTF-8 display name.
sig (64 bytes)       NIP-01 kind-0 signature. The signature MUST cover the
                     nonce and expires_at (bind them to the identity) — decide
                     the exact preimage (see §9, Q4).
```

- Keep the codec **pure/side-effect-free** (bytes in/out, sign/verify) as v1 is.
- Keep the v1 **strict-parser discipline**: a v2 reader rejects unknown
  versions/reserved bits rather than tolerating them.
- Payload grows ~20 bytes (~27 b64url chars). Re-check QR density at the current
  ECC level in `NpubQrModal` (v1 uses ECC-L for links).

## 5. Issuer-side nonce lifecycle (A's device)

- **Single rolling active nonce.** While a nonce is unexpired, reuse it every
  time the code is shown (stable QR, multi-use). When none exists or it has
  expired, mint a new one on next open. (Recommended over "new nonce per share";
  confirm in §9, Q2.)
- **Do not burn on use** — multi-use within the window is required.
- **Persist issued nonces locally** (idb-keyval, like other client state) with
  their `expires_at`. Retain each nonce for a **2-hour grace past expiry**
  (REVIEW B2 — requester decision) so A can still honour a legitimately-issued
  echo that arrives late (B messaged while A was offline; gift wrap waited on the
  relay). Validate echoes against this retained set; **prune on the next issue or
  ack-processing pass** (define the moment — do not leave "prune afterwards"
  vague). A leaked code is therefore a liability for ~2.5h total, not 24h — this
  is what keeps the "short-lived" promise roughly honest (see §8).
- **Rebuild cache** (`shareCard.ts getOwnShareCard`, keyed today on
  `{nickname, signerMode, pubkeyHex}`) must also key on the **active nonce** so
  the QR refreshes when the nonce rotates.

### 5.1 Admission-path requirements (easy to get wrong)

REVIEW (S3): the pairing-ack sender is, by definition, a **stranger** to A. Two
requirements the impl will silently break if unstated:

- **Exempt the pairing-ack kind from the inbound walled garden.** If the new
  subscription is routed through `isAllowedDmSender` like every other rumor
  consumer, the feature never works — the ack is dropped before it can admit
  anyone. The ack handler is the *one* sanctioned stranger-inbound path, gated
  instead by the nonce + sender-binding checks in §3.step4.
- **Exclude the pairing-ack kind from chat rendering.** The project runs two
  independent listeners on the same rumor stream (`MarmotContext` and
  `ChatStoreContext` — see `architecture_marmot_dual_listener`). The new kind
  must be affirmatively excluded from *both* message-rendering paths so an ack
  never surfaces as a chat bubble.

REVIEW (S2 — accepted consequence of multi-use): multi-use + no-burn +
auto-admit means a code posted to a hostile audience yields **unbounded
automatic admissions within the window** — bounded in time, unbounded in count.
This follows from the locked multi-use decision and is not reopened here, but the
UI SHOULD blunt it: replace per-admission "X added you" toasts with a **digest**
("3 people paired with your code") and consider an optional per-nonce admission
cap. State the accepted risk in the eventual spec's security section.

## 6. Backward compatibility & migration

- **Generation:** always v2 going forward.
- **Import:** `parseContactCard` accepts **v1** (legacy → one-directional add,
  no ack) and **v2** (pairing). Bare `npub` / `nostr:` URIs still accepted,
  one-directional.
- **Old links in the wild:** still importable by new builds (as one-directional
  v1). No data loss.
- **Old builds + new links:** old strict v1 parser rejects v2. Acceptable given
  auto-updating PWA, but surface a friendly "update your app" path if feasible
  (see §9, Q5).

## 7. Privacy invariant compliance (mandatory)

This feature must satisfy the project's hard privacy invariant (CLAUDE.md):

- **No public kind-0, no broadcast of profile data.** A's name lives only in the
  locally-shown QR; B's card + the nonce echo travel **only** as a NIP-59
  gift wrap addressed to A, sender hidden by an ephemeral key. Both are
  targeted-encrypted channels, explicitly allowed.
- The **nonce itself is not identity** and reveals nothing on its own.
- Reading/importing A's card induces **no** public broadcast of B's data.
- The spec MUST include an explicit check that no code path publishes an
  unaddressed kind-0 as part of pairing.

## 8. Security model (accepted tradeoffs)

- **Bearer capability, by design.** Anyone who captures the code and echoes the
  nonce **from their own key** is admitted (multi-use). Blast radius is bounded
  to the 30-minute window + the 2h issuer-side grace (§5); after that the nonce
  admits no one. This is the accepted price of one-scan convenience — the UI
  should make the "this code works for 30 minutes" nature legible so users don't
  treat it as private. (Count is unbounded within the window — see §5.1 S2.)
- **Replay after grace:** rejected — A only admits nonces in its valid+grace set.
- **Third-party card injection:** prevented **only by the §3.step4 sender
  binding** — admission binds to the authenticated gift-wrap sender, so echoing
  a harvested card for someone else's pubkey does not admit that pubkey. This
  bullet is false without that check; it is a hard requirement, not an
  optimisation.
- **Name spoofing:** prevented — both cards are signed (name bound to pubkey);
  the nonce/expiry are signed into A's card (see §9 Q4 for what the signature
  must cover).
- **Junk acks / DoS:** A cheaply rejects unknown nonces via a local set lookup;
  no amplification.
- **Clock skew:** treat expiry as soft on the issuer side (the grace period);
  use a generous comparison on B's side.

## 9. Open decisions (need human sign-off before implementation)

1. **Durable fallback.** Keep a plain **npub copy** action for the
   "permanent handle / website / business card" case now that the QR is
   ephemeral? (Recommended: yes.)
2. **Nonce rotation policy.** Single rolling active nonce (recommended, stable
   QR) vs a fresh nonce per share action?
3. **B's consent to reciprocate.** Auto-send B's card back on a successful add
   (implied by scanning a live code), or confirm first? Recommended: auto-send —
   it is gift-wrapped/private and the flow already lands on the contact with
   confirmation. **REVIEW caveat:** this is a *direction-of-disclosure reversal*
   — under v1, scanning disclosed nothing to the issuer; v2 now transmits the
   scanner's name to the issuer. The first-time notice must therefore **not be
   subtle** — it should clearly state "X will see that you added them, and your
   name" before the first echo. Subsequent pairings can be silent.
4. **Signature preimage (with security requirements, not fully open).** Decide
   the exact preimage, subject to two REVIEW (S6) constraints: (a) the signature
   MUST cover the **header/version byte** and the **nonce + expiry**, so no field
   can be resected across versions; and (b) prefer a preimage that is **not a
   well-formed, publishable kind-0 event**. Today's v1 card signs a valid kind-0
   (`{name}`, kind 0, empty tags) — any card holder could launder it onto a
   public relay as the user's profile event. The app never broadcasts it, so the
   invariant holds today, but v2 should close this by domain-separating the
   content or signing a non-0 kind.
5. **Old-build UX (mostly moot — REVIEW N2).** A fresh visit to `few.chat/add`
   always gets the current deploy; only a stale service-worker-cached bundle
   would reject v2. So this reduces to: ensure the *current* release's
   unknown-version parse error shows friendly copy. Not a v2-generation concern.
6. **Ack rumor kind + shape.** Choose a distinct event kind for the pairing
   acknowledgement (analogous to the kind-21059 group join-request). REVIEW (N1):
   specify that the ack's enclosed card is **identity-only (no nonce)** and that
   **receiving an ack never triggers a further echo** — forecloses any ping-pong.
   Repeat acks from the same sender are idempotent (`knownPeers` is a set).

## 10. Acceptance criteria (draft)

- **AC-PAIR-1** A code generated by the app carries identity + a 16-byte nonce +
  an `expires_at` 30 minutes out, signed such that nonce and expiry are
  tamper-evident.
- **AC-PAIR-2** Opening an unexpired code adds the issuer (as today) **and**
  results in the issuer auto-admitting the scanner **without the issuer
  scanning back** — verified by the issuer subsequently receiving a DM from the
  scanner that would previously have been dropped.
- **AC-PAIR-3** After a single scan, **both** parties can send and receive DMs
  to each other.
- **AC-PAIR-4** **Multiple** scanners opening the same code within the window
  are all admitted; the nonce is not consumed by the first use.
- **AC-PAIR-5** Once a nonce is past its 30-min window **and** the 2h issuer-side
  grace, opening the code still imports the issuer's identity (one-directional)
  but produces **no** auto-admission; the scanner sees the graceful outcome
  (and the "they'll need to add you too" line is suppressed when the issuer
  already has the scanner), not an error. A late echo delivered *within* the 2h
  grace is still admitted.
- **AC-PAIR-6** An echo of a nonce the issuer never issued (or one outside the
  valid+grace set) is ignored — no admission.
- **AC-PAIR-6b (sender binding)** An echo whose enclosed card names a pubkey
  different from the authenticated gift-wrap sender is rejected — the enclosed
  (third-party) pubkey is **not** admitted. Only the authenticated sender's
  pubkey is ever admitted.
- **AC-PAIR-7** No pairing code path broadcasts profile data or publishes a
  public kind-0; all reciprocal traffic is gift-wrapped and addressed.
- **AC-PAIR-8** A legacy v1 card / bare npub still imports (one-directional) on a
  current build.
- **AC-PAIR-9** All new user-facing strings exist in both `en` and `de`
  (`i18n.ts`).
- **AC-PAIR-10 (onboarding scanner)** A user with no identity/name who opens a
  live code completes onboarding and *then* reciprocates within the window;
  mutual admission results. If onboarding finishes after the window, it degrades
  to one-directional with no error.
- **AC-PAIR-11 (no chat bubble)** A received pairing-ack never renders as a chat
  message in any conversation view.
- **AC-PAIR-12 (echo honesty)** Before a mutual channel is confirmed, the
  scanner's UI does not claim "connected"; a failed echo is retried on
  reconnect.

## 11. Impact surface (files likely touched)

- `app/src/lib/contactCard.ts` — v2 codec (nonce/expiry fields, signature).
- `app/src/lib/shareCard.ts` — nonce lifecycle + rebuild-cache key.
- New: issuer nonce store (idb-keyval) + pairing-ack subscription/handler
  (alongside DM/join-request subscriptions in `MarmotContext` / DM layer).
- `app/pages/add.tsx`, `app/src/lib/addDeepLink.ts`,
  `app/src/lib/processContactInput.ts`, `app/src/lib/contactCardImport.ts` —
  scanner-side reciprocation + graceful expiry fallback.
- `app/src/lib/knownPeers.ts` / `walledGarden.ts` — admission on valid echo.
- `app/src/components/groups/NpubQrModal.tsx` / `NpubQrScanner.tsx` — QR density,
  "works for 30 minutes" affordance, npub-copy fallback.
- `app/src/lib/i18n.ts` — new copy (en + de).

## 12. E2E tests (relay bucket — publish through the app)

Per project rule, peers must publish via the app, never raw WebSocket. New specs
land in the **groups/relay** bucket (Docker: strfry + blossom).

- **Single-scan mutual channel:** context A shares a v2 code; context B opens
  `/add#c=…` via the app; assert B lands on the A contact **and** A receives a
  DM from B without A ever scanning B (AC-PAIR-2/3).
- **Multi-use:** a third context also opens the same code within the window and
  pairs (AC-PAIR-4).
- **Expired code:** fast-expire (inject/override the window in test), assert
  one-directional import + no auto-admit + graceful message (AC-PAIR-5).
- **Unknown-nonce echo ignored** (AC-PAIR-6).
- **Sender-binding:** an ack carrying a *third-party* signed card must not admit
  that third party — only the authenticated sender (AC-PAIR-6b). This is the
  security-critical test; it needs a peer context that echoes a harvested card.
- **Onboarding scanner:** a context with no prior identity opens the code, sets
  up identity+name, and still pairs within the window (AC-PAIR-10).
- Note: this grows the relay bucket count; update the CLAUDE.md e2e tally and
  `make test-e2e-all` expectations.

## 13. Suggested implementation order

1. v2 codec in `contactCard.ts` (+ unit tests: encode/decode/round-trip,
   strict-parser rejection, signature-covers-nonce/expiry).
2. Issuer nonce store + `shareCard.ts` lifecycle & cache key.
3. Scanner-side reciprocation (send pairing ack on unexpired scan) + graceful
   expiry fallback.
4. Issuer-side pairing-ack subscription → validate nonce → auto-admit
   (`knownPeers`/walled garden).
5. UI: "works for 30 minutes" affordance, npub-copy fallback, i18n en/de.
6. E2E specs (relay bucket).
