# Acceptance Criteria — Advanced Settings

Source: `specs/epic-advanced-settings/spec.md` §8 (with validator amendments, 2026-06-15)

## Gating
- **AC-GATE-1** `/settings` renders a collapsible "Advanced" section, collapsed on every load; controls not visible until expanded. Existing identity controls unchanged and outside Advanced.

## Relays
- **AC-RELAY-1** Advanced shows the current effective relay list (saved list, or `DEFAULT_RELAYS` when none saved).
- **AC-RELAY-2** A valid `wss://`/`ws://` URL can be added; new relay appears in the list.
- **AC-RELAY-3** An invalid or duplicate URL is rejected with an inline error and not added.
- **AC-RELAY-4** A relay can be removed, except the last one — removing it is blocked with an explanatory message.
- **AC-RELAY-5** A reset control restores the list to `DEFAULT_RELAYS`.
- **AC-RELAY-6** Each relay row shows a live connection-status indicator from the NDK pool.
- **AC-RELAY-7** Saving applies to the live NDK pool without a full page reload; subsequent publishes/subscriptions use exactly the saved set.
- **AC-RELAY-8** The saved list is used for key-package discovery/publish, relay backup, and relay snapshot of newly created groups; existing groups' relays are unchanged.
- **AC-RELAY-9** Saving re-publishes kind 30051 relay list on the new set and triggers key-package discoverability so kind 30443 is present on the new set.

## Remote signer — NIP-46
- **AC-SIGNER-1** Signer mode defaults to `local`; `nip46` is an explicit opt-in. Entering `nip46` removes the locally-stored private key (no copy retained).
- **AC-SIGNER-2** Bunker connectable via `nostrconnect://` (QR/deep-link) and pasted `bunker://` URI; `auth_url` challenge opens in new tab.
- **AC-SIGNER-3** Permission request enumerates `sign_event` for all kinds the app emits (0, 5, 443, 444, 445, 1059, 10051, 30051, 30078, 30443) plus `nip44_encrypt`/`nip44_decrypt`; gift-wrap/Welcome decryption works in `nip46` mode.
- **AC-SIGNER-4** Connecting a bunker with a differing pubkey is treated as an identity switch: user warned (key deleted + must be backed up, new identity unconnected, no groups carry over); proceeds only after explicit confirmation.
- **AC-SIGNER-4b** If current identity's key is not backed up, the differing-pubkey switch is blocked behind a backup step or "I am abandoning this key" acknowledgement. Same-key bunker connects without warning.
- **AC-SIGNER-5** NIP-46 session payload persists to `lp_nip46Session_v1` and contains no private key.
- **AC-SIGNER-6** On reload in `nip46` mode, session restores and reconnects; reconnecting state shown until signing is available.
- **AC-SIGNER-7** Unreachable bunker times out (~15 s, does not hang); app enters read-only/signer-unavailable state with retry affordance.
- **AC-SIGNER-8** Disconnecting the bunker never leaves the user without a usable signer; returns to a local identity with the consequence stated.
- **AC-SIGNER-9** Bunker UI states: on-device group-message keys remain local; group messaging is unaffected; DM-history load and large invites are slower. Must NOT claim group sends are slower.
- **AC-SIGNER-10** After the signer mode switch completes, both NDK signer and marmot EventSigner reflect the new mode before the UI shows readiness. No event published between the two seam bindings using mismatched signers.

## Other controls
- **AC-OTHER-1** Relay connection status and confirmation-gated device-wipe (`resetAllData`) present behind Advanced; wipe requires explicit confirmation.
- **AC-OTHER-2** `nip07` mode connects to a browser extension and routes signing through it (same signer abstraction + identity/signing split as `nip46`); absence of extension reported clearly.

## NIP-07 extension
- **AC-NIP07-1** Entering `nip07` mode refused with clear error when extension lacks `window.nostr.nip44`. When `nip44` is present, group join and invite work end to end.
- **AC-NIP07-2** The `nip07` signer path wraps `NDKNip07Signer` in an adapter exposing `.nip44 = { encrypt, decrypt }` satisfying the `applesauce-core` `EventSigner` interface; calls route to `window.nostr.nip44.encrypt/decrypt`.

## npub invariant
- **AC-NPUB-1** No user-facing surface displays or copies a public key in hex form; shown and copied only as `npub…`. No regression on existing npub-only display.

## i18n
- **AC-I18N-1** All new user-visible strings added to `Copy` type and both `en` and `de` objects in `app/src/lib/i18n.ts`; nothing hardcoded.
