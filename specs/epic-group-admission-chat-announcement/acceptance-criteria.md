# Acceptance Criteria — Group member-admitted chat announcement

## S1 — member-admitted announcement

- **AC-PARSE-1** — `parseStructured('{"type":"member_admitted","pubkey":"<64-hex>"}')`
  returns `{ type: 'member_admitted', pubkey: '<64-hex>' }`.
  *Spans modules:* marmot-structured-content.
- **AC-PARSE-2** — `parseStructured` returns `null` (or a non-`member_admitted`
  value) when the payload's `type` is `member_admitted` but `pubkey` is missing,
  not a string, or not a canonical 64-char lowercase-hex pubkey (too short/long,
  uppercase, or non-hex). Malformed payloads never produce a `member_admitted`
  result — this prevents a crafted message from reaching `pubkeyToNpub` (which
  throws on malformed hex) and breaking the timeline for receivers.
- **AC-ATTR-1** — The rendered announcement attributes the admitter to the
  message's protocol sender (`msg.senderPubkey`), NOT to any field carried in the
  structured payload. A payload with a spoofed self-reported admitter cannot
  change who is shown as the admitter. (Asserted at the resolution seam used by
  the render branch — same guarantee as `resolveCancellerDisplay` for
  `invite_cancelled`.)
- **AC-RENDER-1** — When a chat message parses as `member_admitted`, ChatBox
  renders the `MemberAdmittedChatAnnouncement` component (testid
  `member-admitted-announcement`) instead of a plain text bubble, showing the
  admitter display name and the admitted member's display name via the
  `groups.admittedMemberAnnouncement` copy.
- **AC-RENDER-2** — The admitted member's display name resolves from
  `profileMap[structured.pubkey]`, falling back to a truncated npub when the
  profile is not yet known.
- **AC-I18N-1** — `groups.admittedMemberAnnouncement` exists in BOTH `en` and
  `de` copy objects and is typed on the `Copy` interface; the en form reads like
  `"<admitter> admitted <member>"` and the de form is a correct German
  translation.
- **AC-SEND-1** — On a successful join-request approval (`approveJoinRequest`
  returns `{ ok: true }`), `handleApproveRequest` posts exactly one
  `member_admitted` announcement carrying the approved requester's `pubkeyHex`,
  via the wired `sendAnnouncementRef`. On a failed approval (`ok: false`), no
  announcement is posted.
- **AC-SCOPE-1** — The direct-invite path (InviteMemberModal / invite-by-npub)
  posts NO `member_admitted` announcement. Only join-request approval announces.

## Manual Validation

(none — all criteria are covered by unit and e2e tests.)
