# Avatar Images Show as Placeholders on Mobile - Bug Report

## Bug Description
On mobile devices accessing the app over HTTPS, avatar images in the avatar selection modal and profile displays show as placeholders instead of the actual avatar images. Desktop users with HTTP localhost don't experience this issue.

## Expected Behavior
- Avatar images should display correctly on mobile
- Users should see the actual avatar images (fruit, accessories) when selecting avatars
- Avatar previews in profile chips and leaderboard should display correctly

## Reproduction Steps
1. Access the app on a mobile device (iOS Safari or Android Chrome)
2. Navigate to Settings page
3. Click "Choose Avatar" button to open avatar selection modal
4. Observe: Placeholder/blank images displayed instead of actual avatar graphics
5. Same issue appears in header profile chip and leaderboard entries

## Actual Behavior
Avatar images fail to load silently on mobile. Instead of showing the fruit avatars with accessories, a blank/placeholder is displayed. On desktop with HTTP localhost, images load correctly.

## Impact
- **Severity**: High
- **Affected Users**: All mobile users (iOS and Android)
- **Affected Workflows**: Profile setup, avatar selection, profile display on leaderboard and groups

## Environment/Context
- Mobile browsers (iOS Safari, Android Chrome) enforce HTTPS and strict mixed content policy
- Desktop dev environment uses HTTP localhost, masking the issue
- Avatar URLs are HTTP (`http://wp10665333.server-he.de/avatars/{id}.png`)
- App is served over HTTPS on production (GitHub Pages) and mobile always uses HTTPS

## Root Cause Hypothesis
**Mixed Content Blocking**: Avatar image URLs are served over HTTP protocol. When the app is loaded over HTTPS (which is required on production and mobile), browsers enforce mixed content policy that silently blocks HTTP resource requests. This causes images to fail loading without visible errors, especially on mobile browsers which are stricter than desktop.

**Affected Code**:
1. `app/src/config/profile.ts` (line 16) - Hardcoded HTTP avatar endpoint
2. `app/scripts/generate-avatar-manifest.mjs` (line 4, 119) - Generates manifest with HTTP URLs
3. `app/src/components/AvatarBrowserModal.tsx` (line 190) - Image loading without error handling
4. `app/src/components/ProfileSummary.tsx` (line 41) - Avatar display without error handling
5. `app/pages/settings.tsx` (line 326) - Avatar preview without error handling

**Why Mobile is Affected**:
- Mobile browsers enforce mixed content policy more strictly than desktop
- Desktop dev environments use HTTP localhost, avoiding mixed content issues
- Mobile always accesses over HTTPS (production)
- No fallback, error handling, or warning when images fail to load

**No Error Handling**: Image components have no `onError` callback, `crossOrigin` attribute, or fallback mechanism.

## Constraints
- Static export app (`output: 'export'` in Next.js) - no server-side proxying/CDN possible
- GitHub Pages hosting enforces HTTPS
- Need backward compatibility with existing saved avatar selections
- Must work on all mobile browsers (iOS Safari, Android Chrome, Firefox)

## Codebase Context
- **Likely locations**:
  - `app/src/config/profile.ts` - Avatar endpoint configuration
  - `app/src/components/AvatarBrowserModal.tsx` - Main avatar browser component
  - `app/src/components/ProfileSummary.tsx` - Avatar display in headers
  - `app/pages/settings.tsx` - Avatar preview in settings

- **Related code**: Similar HTTPS requirement checks exist elsewhere:
  - `MarmotContext.tsx` (line 133) - Groups feature checks `isSecureContext`
  - `qr.ts` (line 16) - QR camera checks `window.isSecureContext`
  - `groups.tsx` (lines 270-280) - Shows "HTTPS required" warning for groups

- **Technology stack**:
  - Next.js 14.2.35 with static export
  - Chakra UI 2.10.9 for Image component
  - No Next.js image optimization (using raw Chakra UI Image)

## Out of Scope
- Refactoring image loading architecture beyond what's needed for the fix
- Adding image optimization or CDN integration
- Changing the avatar manifest generation process
- Feature enhancements to avatar selection UI
