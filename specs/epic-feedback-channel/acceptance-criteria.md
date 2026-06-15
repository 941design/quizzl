# Acceptance Criteria: Feedback Channel

## Configuration

**AC-CONFIG-1** The maintainer recipients are read from `NEXT_PUBLIC_MAINTAINER_NPUBS` (comma-separated npubs) and decoded to a list of hex pubkeys at module load.

**AC-CONFIG-2** With `NEXT_PUBLIC_MAINTAINER_NPUBS` unset, the feature uses the default single-entry list (`npub16xxxg3zs8pjz0rdyg9c485um04866leaz4a9hy2s4zm7mgsxx3xs9r87e2` → hex `d18c6444503864278da4417153d39b7d4fad7f3d157a5b9150a8b7eda206344d`) and is fully functional.

**AC-CONFIG-3** Each list entry decodes independently: undecodable entries are dropped; an empty resulting list disables the feature (entry point hidden, page shows unavailable state); module-level decode never throws.

**AC-CONFIG-4** The first valid entry is the active recipient (send target and rendered thread); the full list is the recognition set for admission and contact filtering.

## Sending

**AC-SEND-1** Sending feedback uses the existing DM publish path (`publishDirectMessage` or a thin wrapper) against the active maintainer key — no bespoke send or encryption code.

**AC-SEND-2** Every feedback message is NIP-17 gift-wrapped and NIP-44 encrypted; there is no unencrypted feedback path.

**AC-SEND-3** Sent feedback is persisted to and rendered from the `dm:<active recipient>` thread like any DM.

## Source marker

**AC-MARKER-1** Each feedback message's inner kind-14 rumor carries a `["client","nostling",…]` tag and an `["l","feedback"]` tag.

**AC-MARKER-2** Those tags are present only inside the sealed rumor (visible to the recipient after unwrap) and are not present on the outer relay-visible gift wrap.

**AC-MARKER-3** Ordinary (non-feedback) DMs do not carry the `client`/`feedback` marker tags.

## Replies / walled garden

**AC-REPLY-1** A reply from a maintainer appears in the Feedback thread via the existing inbound DM listener (no new inbound parsing).

**AC-REPLY-2** With the user having joined at least one group, a reply from any key in the recognition set is admitted (not dropped by `isAllowedDmSender`) because every maintainer key is seeded into the knownPeers set at startup.

**AC-REPLY-3** Seeding the maintainer keys does not change walled-garden admission for any other pubkey.

## Notifications

**AC-NOTIFY-1** A maintainer reply increments DM unread and surfaces in the notification bell via the existing machinery.

**AC-NOTIFY-2** Activating a notification whose peer is any maintainer key opens the Feedback surface (`/feedback`), not a generic contact chat (`/contacts?id=<hex>`).

## UI

**AC-UI-1** A Settings-page row labelled (translated) for feedback navigates to `/feedback`, and is rendered only when the feature is enabled.

**AC-UI-2** The Feedback surface is distinctly labelled (title + "encrypted" affordance), takes its header name from config, and renders the active-recipient DM thread by reusing the existing `ContactChat` component.

**AC-UI-3** The surface is reachable as a dedicated page `app/pages/feedback.tsx` — no new dynamic path segment.

**AC-UI-4** When the feature is config-disabled, the Settings row is absent and `/feedback` (if reached directly) shows a benign unavailable state, not a broken thread.

## Contacts list

**AC-CONTACT-1** No key in the recognition set appears in the contacts list, whether or not a feedback thread exists or a reply has arrived.

**AC-CONTACT-2** Filtering is applied at the contacts-list view, not by deleting the underlying record: the feedback surface and the notification bell still resolve the maintainer thread, and the feedback header name (from config) is unaffected.

## Edge / i18n

**AC-EDGE-1** When the active maintainer key equals the logged-in user's own pubkey, the feature renders without error (self-DM edge case).

**AC-I18N-1** All new user-visible strings are translated in `en` and `de`; no hardcoded strings.

## Manual Validation

| AC | What to test manually | Owner |
|---|---|---|
| AC-SEND-2 | Open browser devtools on the relay during a feedback send — confirm only opaque kind-1059 events are visible, no plaintext | — |
| AC-MARKER-2 | Log relay events during send — outer gift wrap should have no `client` or `l` tags | — |
