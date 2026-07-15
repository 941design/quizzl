# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## Unreleased

### Deprecated
- Message attachments (image sharing) are disabled on every surface — contacts/DMs, groups, and developer messages (chat)
  - New `ATTACHMENTS_ENABLED` toggle in `app/src/config/features.ts`, following the `CALLS_ENABLED` precedent: the feature code is retained in full, only the UI is gated off
  - Gated in `ChatBox` (the single composer behind all three surfaces) so all three attach entry points — the attach button, drag/drop, and clipboard paste — go dark together and cannot drift apart
  - Images already sent or received still render, so existing history stays readable
  - Sending is unaffected for text; the composer, edit/delete, and reactions all behave as before
  - Flip the toggle to `true` to restore the feature — no re-implementation needed

### Fixed
- Fixed member profiles not propagating to newly joined group members (marmot)
  - Existing members now republish their profile when `onMembersChanged` detects a member count increase, ensuring new joiners receive current name/avatar data
  - Root cause: profile publish only fired once (guarded by `profilePublishedRef`), so members who joined after initial sync never received existing members' profiles
  - Added `prevMemberCount` closure variable in `subscribeNewGroups()` to track joins across `onMembersChanged` callbacks
  - Added 5 regression tests covering join, stable, leave, sequential-join, and rejoin scenarios
  - Bug report: bug-reports/profile-propagation-new-members.md
- Fixed avatar images showing as placeholders on mobile and HTTPS environments (profile)
  - All avatar `imageUrl` values in `avatarManifest.json` and the manifest generator now use protocol-relative `//` URLs instead of `http://`
  - Root cause: browsers block HTTP image loads from HTTPS pages (mixed-content policy), silently replacing images with placeholders
  - Added regression test to prevent future manifest regeneration from re-introducing `http://` URLs
  - Bug report: bug-reports/avatar-images-placeholder-mobile.md
