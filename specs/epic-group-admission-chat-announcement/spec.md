# Group member-admitted chat announcement

**Status**: pre-implementation

## Problem

When an admin approves a pending join request, the requester is added to the
group, but nothing appears in the group chat to mark the event. Members other
than the approving admin have no in-timeline signal that the group's membership
just changed, and no record of *who* let the new member in. Group chats already
announce comparable admin actions in the timeline (rename, invite-cancelled,
member-leave), so admission is a conspicuous gap.

*Success signal: after an admin approves a join request, every member's chat
timeline shows a "<admitter> admitted <new member>" announcement, attributed to
the admin who actually approved.*

## Solution

Post a **display-only kind-9 announcement** to the group when an admin approves
a join request, exactly mirroring the existing `group_renamed` announcement
pattern. The announcement carries the newly-admitted member's pubkey; the
admitter is derived from the protocol-enforced MLS sender of the announcement
message (never a self-reported field). Receivers render it as a muted timeline
row reading "<admitter> admitted <new member>".

## Scope

### In Scope
- A new `member_admitted` structured message type (`parseStructured.ts`).
- Sending the announcement from the join-request **approval** path only.
- A render branch + presentational component for the announcement.
- English and German copy.
- Unit tests for parse/attribution; an e2e test in the groups/relay bucket.

### Out of Scope
- **Direct invites** (InviteMemberModal / invite-by-npub / invite-from-contacts)
  do NOT announce. Product-owner decision (2026-07-19): "admitted" means a gated
  join request being approved, not any member addition. Direct invites stay
  silent, exactly as today.
- Removing/leaving announcements (already handled by `leave_intent`).
- Any change to who can approve, or to the approval mechanics themselves.

## Design Decisions

- **DD-1 — Mirror `group_renamed` end-to-end.** The app already has a proven,
  reviewed pattern for admin-action timeline announcements (structured kind-9,
  display-only, actor from protocol sender). Reusing it verbatim minimizes risk
  and keeps the timeline visually consistent. See `parseStructured.ts:22,40`,
  `ChatBox.tsx:512-518`, `GroupRenamedChatAnnouncement.tsx`,
  `groups.tsx:465-470`.
- **DD-2 — Admitter attribution from `msg.senderPubkey`, never a payload field.**
  Security invariant already enforced for `invite_cancelled` (`resolveCancellerDisplay`)
  and `group_renamed`. The payload carries only the *admitted member's* pubkey
  (`pubkey`); the admitter is whoever the MLS layer says signed the kind-9. A
  self-reported "by" field would be spoofable, so it is not introduced.
- **DD-3 — Approval path is the single send site.** The announcement is fired
  from `groups.tsx handleApproveRequest` after `approveJoinRequest(request)`
  returns `{ ok: true }`, fire-and-forget via the already-wired
  `sendAnnouncementRef` (the same ref the rename announcement uses). Only on
  `ok` — a failed approval posts nothing. The direct-invite path is deliberately
  untouched.
- **DD-4 — New member's display name resolves from the group profile map.**
  `approveJoinRequestImpl` already seeds a provisional `MemberProfile` from the
  join request's self-provided name, so the admitter sees the new member's name
  immediately. Remote members resolve from their own profile map, falling back
  to a truncated npub until the real profile arrives — identical to
  `invite_cancelled` / `leave_intent`.

## Technical Approach

Affected files:
- `app/src/lib/marmot/parseStructured.ts` — add the `member_admitted` variant to
  the `StructuredContent` union and a guard clause (validate `type` +
  `typeof pubkey === 'string'`).
- `app/src/components/groups/MemberAdmittedChatAnnouncement.tsx` — new component,
  mirror `GroupRenamedChatAnnouncement.tsx` (same Box styling; `data-testid="member-admitted-announcement"`).
- `app/src/components/chat/ChatBox.tsx` — new render branch in
  `renderStructuredMessage` gated on `allowPollMessages`, resolving
  `admitterDisplay` from `profileMap[msg.senderPubkey]` and `memberDisplay` from
  `profileMap[structured.pubkey]` (both with truncated-npub fallback).
- `app/src/lib/i18n.ts` — `groups.admittedMemberAnnouncement: (admitter, member) => string`
  type entry + en + de implementations (mirror `renamedGroupAnnouncement`).
- `app/pages/groups.tsx` — in `handleApproveRequest`, after a successful
  `approveJoinRequest`, fire `void sendAnnouncementRef.current?.(JSON.stringify({ type: 'member_admitted', pubkey: request.pubkeyHex }))`.

Worked example (rendered en copy): `"Alice admitted Bob"`.

`messageActionUi.ts` already treats any `parseStructured`-recognized content as
non-actionable (no edit/delete affordance); the new type inherits that because
`parseStructured` returns non-null for it — no change needed there.

## Stories

Single story — the change is one cohesive vertical slice through an existing,
well-established announcement pattern. Splitting would create artificial seams
across files that are always changed together.

- **S1 — member-admitted announcement**: parse type + guard, component, render
  branch, i18n (en+de), approval send site, unit tests, e2e test.

## Non-Goals

- Announcing direct (non-request) member additions — explicitly rejected by the
  product owner for this epic.
- Introducing any self-reported admitter field in the payload — rejected on
  security grounds (spoofable; contradicts the established attribution rule).
