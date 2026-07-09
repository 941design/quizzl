# Epic Architecture — Contact Card Exchange

## Paradigm

Modular monolith, package-by-feature, with a pure-logic core isolated from React and I/O.
The card codec is a **pure, side-effect-free module** (bytes in, bytes out; sign/verify via
nostr-tools) so it is unit-testable without jsdom, matching the project's testing discipline
(pure-function extraction, `app/tests/unit/**/*.test.ts`, no jsdom/@testing-library).

## Module map

| Module | Kind | Location | Owns |
|---|---|---|---|
| `contactCard` | **new** (pure core) | `app/src/lib/contactCard.ts` | Card binary format v1: `encodeCard`, `decodeCard`, `parseContactCard`, canonical `CARD_CONTENT` builder, sign/verify glue. No React, no storage, no relay. |
| `contactCardImport` | **new or folded into contactCard** | `app/src/lib/contactCard.ts` | `importCard(profile) → writeContactEntry` with ISO `updatedAt` derivation + avatar preservation. Thin adapter over `contactCache`. |
| `contactCache` | modified | `app/src/lib/contactCache.ts` | Existing LWW cache; import path reuses `writeContactEntry` / `readContactEntry`. |
| `qr` | modified | `app/src/lib/qr.ts` | `normaliseNpubPayload` (scan seam) becomes card-aware or gains a card-aware sibling used by the scanner. |
| `AddContactModal` | modified | `app/src/components/contacts/AddContactModal.tsx` | Routes typed/scanned input through `parseContactCard`; caches profile on add. |
| `NpubQrModal` / share | modified | `app/src/components/groups/NpubQrModal.tsx`, share entry in `app/pages/settings.tsx` | Share mode encodes the current user's signed card as an onboarding URL QR (ECC-L). |
| `add` page | **new** | `app/pages/add.tsx` | Static deep-link/onboarding page reading `window.location.hash`; two modes (existing identity / onboard-then-add). |
| profile nickname cap | modified | profile-edit surface (`app/pages/profile.tsx` / nickname input) | Enforce 32-UTF-8-byte cap at save. |
| group invite input | modified | invite-by-npub UI + call site | Accept a card, down-convert to `pubkeyHex` before `inviteByNpub`; no `contactCache` write (DD 8). |
| `i18n` | modified | `app/src/lib/i18n.ts` | en+de copy for share/import/onboarding/cap-limit strings. |

## Boundary rules

- No direct imports across module boundaries except through declared seams. `contactCard`
  (pure core) MUST NOT import React, storage, NDK, or MarmotContext. UI and page modules
  depend on `contactCard`, never the reverse.
- The **single card decode seam is `parseContactCard`**. Every npub entry point (AddContact,
  QR scanner, group invite, `/add` page) calls it; none parse a card inline (DD 1 —
  correctness requirement, not style).
- `inviteByNpub` stays npub/pubkey-only; card→pubkey down-conversion happens at the caller.
- Own-profile broadcast to public relays is forbidden (CLAUDE.md privacy invariant); the card
  codec and share/import paths MUST emit zero relay events.

## Seams (cross-story contracts)

- `parseContactCard(input: string) → { pubkeyHex: string; profile?: { nickname: string; updatedAt: string } } | { error: string }` — the decode/verify seam consumed by all entry points.
- `encodeCard(pubkeyHex, { nickname, createdAt }, sign) → string` (base64url payload) and a `buildShareUrl(payload) → string` (fragment URL) — the share seam.
- `CARD_CONTENT(name) → string` — the one canonical signed-content builder, shared by encode and decode (its determinism is load-bearing; AC-SIG-5).
- Profile-cache import: reuses existing `writeContactEntry(pubkeyHex, { nickname, avatar, updatedAt })` and `readContactEntry` (`contactCache.ts`) — avatar-preserving, ISO `updatedAt`.

## Implementation constraints

- nostr-tools 2.x (`verifyEvent`, `getEventHash` from `nostr-tools/pure`; `bytesToHex`/`hexToBytes`, nip19). Signature is a NIP-01 kind-0 event signature so remote signers (NIP-07/46) work — sign via the active signer (`signerAdapter`), not raw bytes.
- Static export: `pages/add.tsx` reads `window.location.hash` (fragment), never a dynamic path segment.
- 32-UTF-8-byte name cap: enforced at profile-save and truncated codepoint-safe at encode.
- QR: `qrcode` lib, encode the onboarding URL at ECC-L; keep the QR ≤ version 9.
