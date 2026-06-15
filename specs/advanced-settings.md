# Feature Request: Advanced Settings (Relays + Remote Signer)

**Status:** Proposed — all decisions (D1–D6) resolved (2026-06-15); ready for planning
**Date:** 2026-06-15
**Type:** New surface (progressive-disclosure section) + signer abstraction + relay configuration
**Affected context:** `app/pages/settings.tsx`, `app/src/lib/ndkClient.ts`, `app/src/lib/marmot/signerAdapter.ts`, `app/src/context/NostrIdentityContext.tsx`, `app/src/context/MarmotContext.tsx`, `app/src/types/index.ts` (`DEFAULT_RELAYS`, `STORAGE_KEYS`), `app/src/lib/marmot/NdkNetworkAdapter.ts`, `app/src/lib/backup/relayBackup.ts`, `app/src/lib/i18n.ts`

---

## 1. Summary

The gear page (`/settings`) today holds **only** Nostr identity controls (npub, QR,
seed backup, seed restore) after the recent Profile/Settings split. There is **no way
for a user to change which relays the app talks to** (they are hardcoded to
`wss://relay.damus.io` + `wss://nos.lol`, overridable only at build time via
`NEXT_PUBLIC_RELAYS`), and **no way to sign with an external key** — the app always
generates and stores a raw private key in `localStorage`.

This feature adds a collapsed **"Advanced"** section to `/settings`, hidden by default,
that exposes:

1. **Relay configuration** — view, add, remove, and reset the relays the app uses for
   general Nostr traffic (profiles, DMs, gift wraps, key-package discovery, backup).
2. **Remote signer (nsec bunker)** — connect a NIP-46 remote signer so the user's
   identity private key never lives in this browser. Local-key mode remains the default.
3. A small set of **adjacent technical controls** that only belong behind "Advanced"
   (relay connection status, raw pubkey, danger-zone identity wipe). See §6.

The defining constraint, discovered in code, shapes the whole design: **all signing and
encryption already flow through one async signer abstraction** — `EventSigner`
(applesauce-core) for Marmot/MLS via `createPrivateKeySigner`, and `NDKPrivateKeySigner`
for NDK. A remote signer is therefore a *swap of the signer implementation*, not a
rewrite. But the same abstraction puts the signer on the **hot path of every group
message**, which is where the cost of "remote" lands.

### What changes for the user

| Actor | Before | After |
|---|---|---|
| User wanting a different/private relay | Impossible (hardcoded at build) | Opens Advanced → edits relay list → app reconnects |
| User who self-custodies keys in a signer app (Amber, nsec.app) | Impossible — app forces a browser-stored key | Opens Advanced → scans a QR / pastes a bunker URL → app signs remotely, no nsec in browser |
| Typical user who touches nothing | Sees identity controls only | **Unchanged** — Advanced is collapsed and out of the way |
| User on a flaky/offline relay set | Silent failure (errors are swallowed today) | Advanced shows per-relay connection status; can fix it |
| User wanting to fully wipe this device | No UI (`resetAllData` exists but is unexposed) | Danger zone behind Advanced with explicit confirmation |

---

## 2. Assessment (why this is feasible, and where it bites)

This section is the heart of the proposal. Read it before the acceptance criteria — it
names the one decision (§5, D1) that determines whether the bunker pillar is worth
building for *this* app.

### 2.1 The signer is already a swappable async interface — remote signing is a swap, not a rewrite

**Resolved direction (D1):** the bunker is **optional** and, when active, **replaces
storing the private key in `localStorage`** (it is not stored alongside a local key). The
default remains exactly as today — a locally-generated, locally-stored key. This resolution
implies a clean separation the current code does not yet have, between **two distinct
concerns that are conflated today** (the private key *is* the identity *and* the signer):

- An **identity** abstraction — *who am I*: the pubkey/npub, how an identity is established,
  switched, and (for local identities) backed up/restored. Identity is always known, even
  in bunker mode (the bunker tells us the pubkey).
- A **signing** abstraction — *perform a cryptographic operation*: `getPublicKey`,
  `signEvent`, `nip44.encrypt/decrypt`, backed by **either** a local key **or** a remote
  bunker. Backup/restore is meaningful only for the *local-key* signer; a bunker-backed
  signer has no local secret to back up.

The rest of §2.1 explains why the *signing* swap is mechanically cheap; §5 and §10 define
the identity/signing split this resolution requires.

Two signer seams exist today, both already asynchronous:

- **Marmot / MLS** uses `EventSigner` from `applesauce-core`, built by
  `createPrivateKeySigner(privateKeyHex)` (`app/src/lib/marmot/signerAdapter.ts`). Every
  method — `getPublicKey`, `signEvent`, `nip44.encrypt`, `nip44.decrypt` — already
  returns a `Promise`, and every marmot-ts call site `await`s it. A signer that performs
  a network round-trip (a NIP-46 bunker) is **structurally compatible with no change to
  marmot-ts**.
- **NDK** uses `NDKPrivateKeySigner`, bound in `ndkClient.ts:applySigner()`. NDK ships
  `NDKNip46Signer` implementing the same `ndk.signer` contract, so this is a drop-in
  replacement.

So "support a bunker" reduces to: provide a second `EventSigner`/`ndk.signer` pair
backed by NIP-46 instead of a raw key, and let the user pick which is active.

### 2.2 MLS group secrets stay in this browser regardless of the bunker

This is the security-scope truth that must be stated to the product owner, because it
bounds what a bunker actually protects.

The MLS key schedule (leaf keys, epoch secrets, ratchet tree, exporter secrets) is
generated and stored **locally** by ts-mls in this app's own IndexedDB
(`groupStateStore`, `keyPackageStore` passed to `MarmotClient`). **None of it is derived
from the Nostr identity key.** Confirmed precisely in the hardening pass: KeyPackage
private material (init key, leaf key) is X25519 keypairs generated by the MLS crypto
provider (WebCrypto), and the MLS *credential* embedded in the KeyPackage is just
`hexToBytes(nostrPubkey)` — the **public** key only (MIP-00). The Nostr private key is
never passed to or read by ts-mls. On the Welcome path the Nostr key contributes **exactly
two `nip44.decrypt` calls** (unwrapping the gift-wrap and seal layers); everything after
that — Welcome decryption, group join, ratchet-tree computation — is pure ts-mls against
locally-stored KeyPackage material. So the Nostr key only (a) forms the credential (public
key) and (b) signs/encrypts the Nostr-layer wrapper events.

**Consequence:** a bunker removes the *Nostr identity key* (the high-value credential —
it controls the social graph, follows, who-you-are across all of Nostr) from this
browser. It does **not** remove the MLS group-content secrets, which remain in IndexedDB.
A device compromise can still read decrypted group history. The bunker protects identity,
not message-confidentiality-at-rest. This is the right tradeoff for most threat models
(identity theft is unrecoverable; MLS keys are group-scoped and rotate by epoch) — but it
must not be sold as "your messages are now safe if your device is stolen."

### 2.3 The latency cost is narrower than it first appears — it lands on invites and DM history, NOT group sends

This was corrected during a protocol-hardening pass against marmot-ts/ts-mls. The earlier
assumption that "every group message hits the bunker" is **wrong** and the corrected map
materially strengthens the case for the bunker in group chat.

**Group application messages (kind 445) do not touch the identity signer at all.** Their
content is encrypted with the **MLS exporter secret** (a ts-mls–derived key, MIP-03), and
the kind-445 wrapper event is signed with a **freshly generated ephemeral keypair**, not
the user's identity key. `sendChatMessage` calls only `getPublicKey()` on the identity
signer (to stamp the inner rumor's author) — and a NIP-46/NIP-07 signer **caches the
pubkey after connect**, so that call resolves locally with no round-trip. **Sending a group
message therefore incurs no bunker latency.**

Corrected signer-call map (verified against marmot-ts `@0.5.x` / ts-mls `2.0.0-rc.10`):

| Operation | Identity-signer calls | Round-trips to bunker | Frequency |
|---|---|---|---|
| **Send a group message** (`sendChatMessage`) | `getPublicKey()` only (cached) | **0** | Every message |
| `sendApplicationRumor` (direct) | none | 0 | — |
| `selfUpdate()`, `ingest()` (commit processing) | none | 0 | Frequent (background) |
| `leave()` | `getPublicKey()` (cached) | 0 | Once |
| **Invite N members** (`commit` + Add) | `getPublicKey()` + `signEvent()` ×N (seals) + `nip44.encrypt()` ×N | **O(N)** | Per invite batch |
| **Receive a Welcome** (`unlockGiftWrap`) | `nip44.decrypt()` ×2 (gift-wrap + seal) | **2** | Once per join |
| Key-package publish/rotate | `getPublicKey()` + `signEvent()` (kind 30443); `signEvent()` (kind 5) | small | Rare (startup, rotation) |
| Publish kind:0 / relay lists | `signEvent()` | small | Rare |
| **Send a NIP-17 DM** | `signEvent()` (seal) + `nip44.encrypt()` | **~2** | Per DM sent |
| **Load DM history** | `nip44.decrypt()` per gift wrap | **O(n)** | Opening a conversation |

Where remote latency actually lands:

- **Inviting members** is **O(N)** in recipient count (one seal signed + one `nip44.encrypt`
  per recipient). Tolerable for typical group sizes; worth a progress indicator for large
  invites.
- **The NIP-17 direct-message path** is the real cost. Sending a DM is ~2 bunker calls;
  **loading a conversation decrypts each gift wrap with its own remote `nip44.decrypt`**, so
  an N-message history is N sequential round-trips — tens of seconds for a long history.
- **Welcome receipt** is exactly **2** `nip44.decrypt` calls — a one-time per-join cost,
  not per-message. Acceptable.

So the bunker's UX cost is concentrated on **DM history load** (and to a lesser degree
invites), **not** on group messaging. The data-key-wrapping mitigation does **not** rescue
the DM-history case in general (see §9.1) — fresh per-event ephemeral keys defeat it.

### 2.4 Relay reality: one default pool, five consumers

Relays are hardcoded in `app/src/types/index.ts` (`DEFAULT_RELAYS`) and flow to five
consumers:

| Consumer | Relays used today | Where |
|---|---|---|
| General pub/sub, kind:0, gift-wrap DMs | `DEFAULT_RELAYS` (NDK pool) | `ndkClient.ts`, `directMessageNotifications.ts` |
| Key-package publish + discovery | kind 10051 list, else `DEFAULT_RELAYS` | `NdkNetworkAdapter.ts:164` |
| Encrypted relay backup | kind 30051 list, else `DEFAULT_RELAYS` | `relayBackup.ts:285` |
| **MLS group messages (kind 445)** | **per-group `group.relays`, frozen at group creation** | `MarmotContext.tsx`, `welcomeSubscription.ts` |
| New group creation | `DEFAULT_RELAYS` snapshot | `MarmotContext.tsx:~1093` |

The **user-editable relay list in this feature replaces `DEFAULT_RELAYS` as the base
pool** — it governs the first three rows and the relay set baked into *future* groups.
**Per-group relays of existing groups are explicitly out of scope** (§9): changing them
is an MLS-coordination problem (all members must agree on the transport set), not a local
preference, and warrants its own spec.

---

## 3. Gating: how "Advanced" is hidden

A single collapsible **"Advanced"** section at the bottom of `/settings`, **collapsed by
default** on every load (the open/closed state is *not* persisted — it always starts
closed so the surface stays out of the way). A clear disclosure control
(`data-testid="advanced-settings-toggle"`) expands it. No password, no easter-egg
tap-count — "hidden by default" means "not in your face," not "access-controlled."
(AC-GATE-1.)

Rejected alternative — a separate `/advanced` route: adds a static-export page and a nav
entry for a surface most users never open; a disclosure on the page they already have is
lower-churn and keeps identity + advanced-identity controls co-located.

---

## 4. Behavior specification — Relays

### 4.1 Viewing

The Advanced section lists the **current effective relay list** (the user's saved list,
or `DEFAULT_RELAYS` if the user has never customized it). Each row shows the relay URL and
a **connection-status indicator** derived from NDK's pool state (connected / connecting /
disconnected). (AC-RELAY-1, AC-RELAY-6.)

### 4.2 Editing

- **Add a relay:** an input accepts a relay URL; it is validated (`wss://` or `ws://`
  scheme, well-formed, not a duplicate) before being added. Invalid input shows an inline
  error and is not added. (AC-RELAY-2, AC-RELAY-3.)
- **Remove a relay:** each row has a remove control. The list **must not be reducible to
  empty** — removing the last relay is blocked with an explanatory message, because an
  empty pool silently breaks all networking. (AC-RELAY-4.)
- **Reset to defaults:** a control restores the list to `DEFAULT_RELAYS`. (AC-RELAY-5.)

### 4.3 Persistence and application

- The list persists to a new key `lp_relays_v1` (added to `STORAGE_KEYS`). Absence of the
  key means "use `DEFAULT_RELAYS`" — existing users are unaffected until they opt in.
- On save, the change **applies to the live NDK pool without a full reload**: relays
  removed are disconnected from the pool; relays added are connected. The app must reach a
  consistent state where subsequent publishes/subscriptions use exactly the saved set.
  (AC-RELAY-7.)
- The saved list becomes the base for **key-package discovery/publish** and **backup**
  (replacing the `DEFAULT_RELAYS` fallback in `NdkNetworkAdapter.ts` and `relayBackup.ts`)
  and the snapshot copied into **newly created groups**. It does **not** retroactively
  change existing groups' relays. (AC-RELAY-8.)

### 4.4 Caveat — relay changes can strand discoverability

If a user removes a relay on which their key package (kind 443/30443) or relay-list
(kind 10051) was published, peers may no longer find them to send invites. The feature
must, on relay-list save, **re-publish the user's kind 10051 relay list and ensure a key
package exists on the new set** (the app already publishes these — it must re-run that
path against the new list, not silently leave stale advertisements). (AC-RELAY-9.)

---

## 5. Behavior specification — Remote signer (nsec bunker)

### 5.1 Signer modes

The app gains an explicit **signer mode**, persisted in `lp_signerMode_v1`:

- **`local`** (default, current behavior): a raw private key in `localStorage`, signing
  via `NDKPrivateKeySigner` + `createPrivateKeySigner`.
- **`nip46`**: a NIP-46 remote signer (nsec bunker). The raw private key is **not** stored
  by this app at all — switching into `nip46` mode **removes** any locally-stored key
  (`lp_nostrIdentity_v1`), it does not keep a copy. Signing/encryption is delegated over a
  relay round-trip. (D1.)

The default for every existing and new user is **`local`**. Switching to `nip46` is an
explicit opt-in inside Advanced. Because entering `nip46` mode **deletes the local key**,
the switch is irreversible for that key unless the user has backed it up first — this is
enforced as part of the switch warning (§5.3). (AC-SIGNER-1.)

### 5.2 Connecting a bunker

Primary flow — **`nostrconnect://` (app-initiated, QR)**, recommended for a PWA:

1. The app generates a `nostrconnect://` URI (ephemeral local keypair + one-time secret +
   requested permissions) and renders it as a **QR code** plus a copy button. On Android,
   also offer a deep-link button (Amber handles the scheme).
2. The user scans it with their signer (Amber, nsec.app, …) and approves.
3. The signer connects to the rendezvous relay and returns the secret; the app validates
   it, learns the user's pubkey, and the session becomes ready.

Fallback flow — **`bunker://` (signer-initiated, paste)**: the user pastes a
`bunker://<pubkey>?relay=…&secret=…` URI copied from their signer. If the signer responds
with an `auth_url` challenge, the app opens it in a new tab. (AC-SIGNER-2.)

The permission request enumerated to the bunker **must** include `sign_event` for every
kind the app produces (0, 5, 443, 444, 445, 1059, 10051, 30051, 30078, 30443) **and**
`nip44_encrypt` + `nip44_decrypt` — strict bunkers reject unlisted methods, and missing
`nip44_*` silently breaks gift-wrap/Welcome decryption (the marmot path requires the
`nip44` sub-object on the signer). (AC-SIGNER-3.)

### 5.3 Pubkey continuity (the identity question)

A bunker connection establishes *whatever identity the bunker holds*. This may differ from
the app's current local identity.

**Resolved direction (D2):** the same-key path is blessed, and a **differing pubkey is
treated as an identity switch that demands an explicit, multi-point warning before it is
allowed to proceed.** The warning is not a generic "are you sure" — it must state, in
plain language, all of the following, and the user must confirm having read them
(AC-SIGNER-4):

1. **Back up the *current* identity first.** Switching deletes the local key for the
   current identity (§5.1). If it has not been backed up (seed phrase saved), it is **lost
   irrecoverably**. The warning must surface the current backup state and, if the key is
   not backed up, **block the switch behind a backup step** (or an explicit
   "I understand I am abandoning this key" acknowledgement) rather than silently destroy it.
2. **The new identity is entirely unconnected from the former one.** Different pubkey,
   different npub — to everyone else on Nostr it is a different person. Nothing carries over.
3. **No group memberships carry over.** Existing MLS groups, contacts, chat history, and
   pending invitations belong to the *old* pubkey and will **not** be accessible under the
   new identity. The new identity starts with no groups and must be re-invited.

The clean, recommended path remains the **same-key** case (the user exported their seed
into nsec.app/Amber, then connects it here): identity is continuous, existing groups keep
working, and the warning above does not apply because the pubkey matches. The app detects
same-vs-different by comparing the bunker's reported pubkey to the current identity's
pubkey. (AC-SIGNER-4, AC-SIGNER-4b.)

### 5.4 Session persistence and reconnection

- The NIP-46 session payload (`signer.toPayload()` — contains the bunker pubkey, user
  pubkey, relay; **no private key**) persists to `lp_nip46Session_v1`. It is safe to store:
  reading it lets nobody sign. (AC-SIGNER-5.)
- On reload in `nip46` mode, the app restores the session (`NDKNip46Signer.fromPayload`)
  and re-establishes the relay connection before signing is possible. A
  "reconnecting to signer…" state is shown while this is pending. (AC-SIGNER-6.)
- **Offline bunker:** if the bunker is unreachable, reconnection must **time out**
  (~15 s) rather than hang forever, and the app must degrade to a clear **read-only /
  signer-unavailable** state (events can still be fetched and displayed; sending and
  gift-wrap decryption are disabled with an explanatory message and a retry/re-pair
  affordance). The bunker connection must never wedge the app. (AC-SIGNER-7.)

### 5.5 Disconnecting

Disconnecting the bunker returns the app to `local` mode. Because the app may **not hold a
local key** while in `nip46` mode (that is the whole point), disconnecting must clearly
state what identity the app falls back to, and must not leave the user with no usable
signer. The simplest correct behavior: disconnecting is only offered alongside an explicit
"create/restore a local key" step, or it returns to the previously-stored local identity
if one still exists. (AC-SIGNER-8.)

### 5.6 What the user must be told (honest scope)

The bunker UI must state, in plain language, the assessment from §2.2 and §2.3:

- Identity key leaves the browser; **group message keys remain on this device.**
- **Group messaging is unaffected** (no per-send slowdown), but **loading direct-message
  history and inviting many members are slower** while using a remote signer.

(AC-SIGNER-9.) This is a behavior-affecting honesty requirement, not decoration. Do not
claim "everything is slower" — that is both wrong (group sends are unaffected) and would
discourage adoption needlessly.

---

## 6. Behavior specification — Other advanced controls

These belong behind Advanced because they are technical and/or destructive.

1. **Relay connection status / manual reconnect** — surfaces NDK pool health (today errors
   are swallowed, `MarmotContext.tsx`). Pairs naturally with §4. **Ships in v1 (D3).**
2. **Danger zone — wipe this device** — exposes the existing but currently-unreachable
   `resetAllData()` (`storage.ts`) behind a typed/explicit confirmation. Clears identity +
   all MLS/group/chat IndexedDB. **Ships in v1 (D3)** — it already exists, only the guarded
   UI is missing.
3. **NIP-07 browser-extension signer** — a third signer mode (`nip07`) using a desktop
   extension (Alby, nos2x-fox). Same abstraction as the bunker but **local and low-latency**
   (no network round-trip at all), so it sidesteps §2.3 entirely for desktop users.
   **Ships in v1 (D4).** Governed by the same signer-mode machinery (§5.1) and identity/
   signing split (§10); like the bunker it carries no local key.

   **Hard constraint — `nip44` is optional in NIP-07 and its absence crashes marmot.** The
   NIP-07 spec requires only `getPublicKey()` and `signEvent()`; `window.nostr.nip44` is
   **optional**. But marmot-ts's gift-wrap path throws synchronously
   (`Signer does not support nip44 encryption`) when `signer.nip44` is missing — so an
   extension without `nip44` would **hard-crash on every Welcome receipt and every invite
   send**, with no graceful degradation. Therefore the app **must detect
   `window.nostr.nip44` at connect time and refuse `nip07` mode with a clear error if it is
   absent**, rather than letting the user enter a mode that will crash on first group action.
   Extensions with full `nip44`: Alby, nos2x-fox, Amber (Android). Extensions without it:
   the original nos2x, some older builds. (AC-NIP07-1.)

**Rejected (D3, D5):**

- **Raw public-key (hex) display.** Not added. The product **only ever displays the npub
  form**, never hex — see the npub-only invariant in §6.1. Power users who need hex can
  convert an npub themselves.
- **Raw `nsec` export.** Not added. The seed-phrase backup already covers backup and
  portability; raw `nsec` export widens the key-exfiltration surface for little gain.

### 6.1 Invariant — npub-only display (D3)

The application **must never surface a public key in hex form** in any user-facing
surface — not in Advanced, not in debugging affordances, not in copy buttons. Public keys
are shown and copied **only** as `npub…` (NIP-19). This is an existing convention
(`identity-npub-display`, `truncateNpub`) that this feature must preserve and must not
regress by introducing a hex display "for convenience." (AC-NPUB-1.)

---

## 7. Decisions required

Lead each with behavior. Recommendations are first; "Other" is always available.

| ID | Decision | Options & recommendation |
|---|---|---|
| **D1** | **RESOLVED.** Bunker is **optional**; when active it **replaces** local key storage (no local copy retained). Default stays as today (local key). Requires splitting **identity** management from **signing** (§2.1, §10). | ✅ Build it as opt-in, default unchanged. |
| **D2** | **RESOLVED.** Same-key path is blessed; a **differing** pubkey is an identity switch gated by a multi-point warning that must (1) require/confirm backup of the current key before deleting it, (2) state the new identity is wholly unconnected, (3) state no group memberships carry over (§5.3). | ✅ Warn-and-confirm on differing pubkey. |
| **D3** | **RESOLVED.** Ship **relay connection status** + **danger-zone wipe** in v1. **No hex pubkey** — and stronger: the app must **only ever display npub, never hex**, anywhere (npub-only invariant, §6.1). | ✅ Relay status + wipe; npub-only enforced. |
| **D4** | **RESOLVED.** Include the **NIP-07** extension signer (`nip07`) — near-free given the signer abstraction and lower-latency than the bunker on desktop. | ✅ Ship NIP-07 mode. |
| **D5** | **RESOLVED.** **No** raw `nsec` export — seed phrase covers backup; export only widens exfiltration surface. | ✅ Not added. |
| **D6** | **RESOLVED.** **One unified** relay list drives general traffic, key-package discovery, and backup. | ✅ Single list. |

---

## 8. Acceptance criteria

### Gating
- **AC-GATE-1** `/settings` renders a collapsible "Advanced" section, **collapsed on every
  load**; its controls are not visible until the user expands it. The identity controls
  that exist today are unchanged and remain outside Advanced.

### Relays
- **AC-RELAY-1** Advanced shows the current effective relay list (saved list, or
  `DEFAULT_RELAYS` when none saved).
- **AC-RELAY-2** A valid `wss://`/`ws://` URL can be added; the new relay appears in the list.
- **AC-RELAY-3** An invalid or duplicate URL is rejected with an inline error and not added.
- **AC-RELAY-4** A relay can be removed, except the **last** one — removing it is blocked
  with an explanatory message.
- **AC-RELAY-5** A reset control restores the list to `DEFAULT_RELAYS`.
- **AC-RELAY-6** Each relay row shows a live connection-status indicator from the NDK pool.
- **AC-RELAY-7** Saving the list applies to the live NDK pool **without a full page reload**;
  subsequent publishes/subscriptions use exactly the saved set.
- **AC-RELAY-8** The saved list is used for key-package discovery/publish, relay backup, and
  the relay snapshot of **newly created** groups; **existing** groups' relays are unchanged.
- **AC-RELAY-9** Saving a new relay list re-publishes the user's kind 10051 relay list and
  ensures a key package exists on the new set (no stranded discoverability).

### Remote signer
- **AC-SIGNER-1** Signer mode defaults to `local` for existing and new users; `nip46` is an
  explicit opt-in. Entering `nip46` mode **removes** the locally-stored private key (no copy
  retained); the raw private key is **not** stored while in `nip46` mode.
- **AC-SIGNER-2** A bunker can be connected via `nostrconnect://` (QR/deep-link) and via a
  pasted `bunker://` URI; an `auth_url` challenge opens in a new tab.
- **AC-SIGNER-3** The permission request enumerates `sign_event` for all kinds the app
  emits plus `nip44_encrypt`/`nip44_decrypt`; gift-wrap/Welcome decryption works in `nip46`
  mode (the signer exposes a working `nip44` sub-object).
- **AC-SIGNER-4** Connecting a bunker whose pubkey differs from the current identity is
  treated as an identity switch: the user is warned, in plain language, that (1) the current
  key will be deleted and must be backed up first, (2) the new identity is entirely
  unconnected from the former, and (3) no group memberships / contacts / history carry over;
  the switch proceeds only after explicit confirmation.
- **AC-SIGNER-4b** If the current identity's key is **not** backed up, the differing-pubkey
  switch is blocked behind a backup step (or an explicit "I am abandoning this key"
  acknowledgement) — the switch must never silently destroy an un-backed-up key. A bunker
  whose pubkey **matches** the current identity connects without the switch warning.
- **AC-SIGNER-5** The NIP-46 session payload persists to `lp_nip46Session_v1` and contains
  no private key.
- **AC-SIGNER-6** On reload in `nip46` mode, the session restores and reconnects; a
  reconnecting state is shown until signing is available.
- **AC-SIGNER-7** An unreachable bunker times out (does not hang) and the app enters a clear
  read-only/signer-unavailable state with a retry affordance; the app remains usable.
- **AC-SIGNER-8** Disconnecting the bunker never leaves the user without a usable signer; it
  returns to a local identity (existing or freshly created/restored) with the consequence
  stated.
- **AC-SIGNER-9** Bunker UI plainly states that on-device group-message keys remain local
  and that, while group messaging is unaffected, **DM-history load and large invites** are
  slower with a remote signer (it must not claim group sends are slower — they are not).

### Other controls
- **AC-OTHER-1** Relay connection status and a confirmation-gated device-wipe
  (`resetAllData`) are present behind Advanced; wipe requires explicit confirmation before
  clearing identity + IndexedDB.
- **AC-OTHER-2** A `nip07` mode connects to a browser extension and routes signing through
  it (same signer abstraction and identity/signing split as `nip46`); absence of an
  extension is reported clearly. Like `nip46`, `nip07` mode holds no local key.
- **AC-NIP07-1** Entering `nip07` mode is **refused with a clear error** when the extension
  does not expose `window.nostr.nip44` — the app must not enter a mode that would hard-crash
  on the first Welcome receipt or invite send. When `nip44` is present, group join and invite
  work end to end.
- **AC-NPUB-1** No user-facing surface displays or copies a public key in hex form; public
  keys are shown and copied only as `npub…`. The feature introduces no hex-pubkey affordance
  and does not regress the existing npub-only display.

### i18n
- **AC-I18N-1** All new user-visible strings (section/control labels, statuses, warnings,
  errors, the §5.6 disclosures) are added to the `Copy` type and both `en` and `de` objects
  in `app/src/lib/i18n.ts`; nothing is hardcoded.

---

## 9. Conflicts and caveats

- **9.1 Remote-signer latency, correctly scoped (§2.3).** Group sends are **not** affected
  (kind-445 uses an MLS-derived key + ephemeral keypair; the identity signer is not called).
  The cost lands on **DM-history load** (one remote `nip44.decrypt` per gift wrap → O(n)) and
  on **invites** (O(N) in recipients). The "data-key wrapping" optimization **does not apply**
  to the gift-wrap/Welcome path: NIP-59 uses a fresh ephemeral sender key per event by
  design (anti-linkability), so there is no shared conversation key to collapse into one
  bunker call. It can only help a NIP-17 DM client that batches decrypts from the **same**
  sender, and even then marginally. v1 must not block the UI thread on DM-history decrypt and
  should show progress; a true fix for bulk DM decrypt is a separate effort, not assumed here.
- **9.2 MLS keys remain local (§2.2).** Must be communicated (AC-SIGNER-9); do not let the
  feature imply the bunker secures message content at rest.
- **9.3 Per-group relays are frozen.** Editing the relay list does not change existing
  groups' transport relays — that is an MLS-coordination problem and is **out of scope**.
  The UI must not imply otherwise.
- **9.4 Removing relays can strand discoverability.** Mitigated by AC-RELAY-9; without it, a
  user can quietly become un-invitable.
- **9.5 Two signer seams must move together.** `ndk.signer` (NDK) and the marmot
  `EventSigner` must both reflect the active mode at all times, or the app will sign some
  events locally and others remotely (or fail). The mode switch must be atomic across both.
- **9.6 Offline-first tension.** A backendless PWA that now depends on a reachable bunker
  for *any* write is a reliability regression for that user; AC-SIGNER-7's graceful
  degradation is mandatory, not optional.
- **9.7 Backup semantics in `nip46` mode.** Seed-phrase backup/restore (today's
  `/settings`) assumes a local key. With no local key, "backup" is meaningless (the key
  lives in the bunker) and "restore" would re-introduce a local key. The identity-section
  backup/restore controls must be hidden or clearly disabled in `nip46` mode.

---

## 10. Implementation pointers (non-binding)

- **Split identity from signing (D1).** Today `NostrIdentityContext` conflates *identity*
  (pubkey/npub, backup/restore) with *the secret that signs*. Introduce two seams:
  - an **identity** provider that owns `{ pubkeyHex, npub, mode }`, the local-key
    backup/restore flow (meaningful only when `mode === 'local'`), and the guarded identity
    switch (§5.3) — and crucially, in `nip46` mode holds **no private key**;
  - a **signing** provider exposing one `getActiveSigner()` seam that returns both the
    `ndk.signer` and the marmot `EventSigner` for the current mode. For `nip46`, wrap
    `NDKNip46Signer` to satisfy the `EventSigner` shape (it already exposes `sign`,
    `encrypt`/`decrypt` with `nip44`); reuse `createPrivateKeySigner` for `local`.

  Route `ndkClient.ts:applySigner` and `MarmotContext`'s `signerRef` through the signing
  seam so the two NDK/marmot seams (§9.5) can never diverge. Entering `nip46` deletes
  `lp_nostrIdentity_v1` (after the backup gate of §5.3); the identity provider must keep
  functioning with only a pubkey and a remote signer.
- **Relays:** add `lp_relays_v1` to `STORAGE_KEYS`; introduce a `getEffectiveRelays()`
  helper (saved list ?? `DEFAULT_RELAYS`) and use it where `DEFAULT_RELAYS` is read for the
  general pool / KP discovery / backup / new-group snapshot. Apply changes via NDK pool
  add/remove rather than recreating the singleton.
- **Status:** derive per-relay status from `ndk.pool` relay connection state; no new
  network code required.
- **Danger zone:** wire the existing `resetAllData()` (`storage.ts`) behind a typed
  confirmation; it already clears the right keys/stores.
- **NIP-46 connect:** `NDKNip46Signer.nostrconnect(ndk, relay, undefined, { name, url,
  perms })`; read `signer.nostrConnectUri` synchronously for the QR; `await
  blockUntilReady()` with a 15 s `Promise.race` timeout; persist `signer.toPayload()`;
  restore with `NDKNip46Signer.fromPayload`.
- **Tests (e2e — must drive through the app, per `CLAUDE.md` and
  `feedback_e2e_no_direct_relay`):**
  - **Advanced gating:** Advanced is collapsed on load; expand reveals relay + signer
    controls; identity controls remain outside it.
  - **Relay edit applies:** add a relay, save, and assert subsequent app traffic uses the
    new set (e.g. a second context on the new relay observes a publish made through the
    app); removing the last relay is blocked.
  - **Relay reset:** reset restores `DEFAULT_RELAYS`.
  - **Bunker connect:** stand up a test NIP-46 signer; connect via the app's nostrconnect
    flow; assert an event published afterward is signed by the bunker's key and observed by
    a peer context — do not hand-sign in the test.
  - **Same-key bunker = no switch warning; differing-key bunker = gated switch:** connect a
    bunker holding the current pubkey and assert no switch warning; connect one with a
    different pubkey and assert the multi-point warning (§5.3) appears and that an
    un-backed-up current key blocks the switch behind a backup step.
  - **Bunker offline:** point the session at an unreachable bunker; assert the app times out
    and enters the read-only state rather than hanging.
  - **NIP-07 nip44 guard:** with a stubbed `window.nostr` exposing only `getPublicKey` +
    `signEvent` (no `nip44`), assert `nip07` mode is refused with an error; with a full
    `nip44`-capable stub, assert group join/invite work through the app.
  - **Danger-zone wipe:** confirm wipe clears identity + group state.
  - **npub-only:** assert no Advanced surface renders or copies a hex public key.

---

## 11. Out of scope

- **Changing existing groups' transport relays** (per-group `group.relays`) — MLS
  coordination problem; separate spec (§9.3).
- **The data-key bulk-decrypt optimization** for `nip46` DM history (§9.1) — follow-up.
- **NIP-05 / lightning-address / other profile metadata** — Profile surface, not here.
- **Multi-account / account switching** beyond the single identity-switch warning (§5.3).
- **Per-role relay lists** (general / key-package / backup as separate lists) — D6 resolved
  to a single unified list.
- **Raw `nsec` export** and any **hex public-key** display — D5/D3 resolved against both.
- **NIP-55 Android intent signer** (Amber-as-app-signer beyond its NIP-46 bunker mode).
- **Notification, theme, or language preferences** — these live on Profile already.
</content>
</invoke>
