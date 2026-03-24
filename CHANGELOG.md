# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## Unreleased

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
