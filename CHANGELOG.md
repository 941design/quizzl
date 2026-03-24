# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## Unreleased

### Fixed
- Fixed avatar images showing as placeholders on mobile and HTTPS environments (profile)
  - All avatar `imageUrl` values in `avatarManifest.json` and the manifest generator now use protocol-relative `//` URLs instead of `http://`
  - Root cause: browsers block HTTP image loads from HTTPS pages (mixed-content policy), silently replacing images with placeholders
  - Added regression test to prevent future manifest regeneration from re-introducing `http://` URLs
  - Bug report: bug-reports/avatar-images-placeholder-mobile.md
