# Bug Report: Open group view does not refresh live when an invited member accepts

## Description

When a user invites a new member to an MLS group and **stays on the group page /
detail view**, and the invited member subsequently accepts the invitation (joins
the group), the **bell / notification icon updates** with an event, but the group
detail currently in view does **not** update. The member list / group state shown
in the open view does not refresh live. The user must navigate away and back (or
reload the page) to see the newly joined member.

## Expected behavior

While a group's detail view is open, when a peer accepts an invitation and joins
the group, the open view updates live — the new member appears in the member
list (and any dependent group state refreshes) without a manual reload — mirroring
the live update the notification bell already receives.

## Actual behavior

Only the bell/notification badge updates live. The open group detail view remains
stale until the user leaves and re-enters the view or reloads.

## Impact

Confusing, incorrect UI state for the person who performed the invitation and is
watching the group. The membership displayed contradicts the notification they
just received. Undermines confidence that group state is real-time.

## Reproduction steps

1. User A opens a group's detail view and invites User B.
2. User A stays on the group detail view.
3. User B accepts the invitation (joins the group) — driven through the app.
4. Observe: User A's bell/notification updates, but the member list in the open
   group view does not change until reload.

Starting reference for investigation: the dual-listener architecture
(`MarmotContext` + `ChatStoreContext`) on the MLS rumor stream, per
`specs/marmot-application-rumor-dispatch.md`, and the groups page
(`app/src/pages/groups.tsx`).

## Source

Reported by user, 2026-07-10.
