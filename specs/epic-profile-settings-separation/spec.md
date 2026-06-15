# Feature Request: Separate Profile (Customization) from Settings (Technical)

**Status:** Proposed
**Date:** 2026-06-15
**Type:** Information-architecture change (navigation / surface split)
**Affected context:** `app/pages/settings.tsx`, `app/pages/profile.tsx`, `app/pages/index.tsx`, `app/src/components/Layout.tsx`, `ProfileContext`, `useMoodTheme`, `LanguageContext`, `NostrIdentityContext`, `app/src/lib/i18n.ts`

---

## 1. Summary

Today **one page** (`/settings`, `app/pages/settings.tsx`) holds everything: profile
customization (nickname, avatar), display preferences (language, theme), and
sensitive identity/key operations (npub, QR, seed-phrase backup, seed-phrase
restore). It is reached from **both** the gear icon **and** the header profile chip —
the two distinct-looking entry points lead to the same place.

This feature **splits that single page into two purpose-built surfaces**:

- **Profile** — *customization*: who you are and how the app looks/reads to you.
  Nickname, avatar, theme, language. Reached by clicking the **header profile chip**
  (avatar + name) and the home-page **Profile tile**.
- **Settings** — *technical / account*: your Nostr identity and key management.
  npub display + copy, QR code, key **backup** (seed phrase), key **restore**.
  Reached by the **gear icon**, which keeps its current `/settings` route and the
  "Settings" label.

The cog wheel stops being "everything" and becomes "the technical stuff most users
touch once." The chip — which already *looks* like a profile affordance — finally
opens an actual profile.

### What changes for the user

| Actor | Before | After |
|---|---|---|
| User editing their name/avatar | Goes to `/settings`, scrolls past identity/keys | Clicks the profile chip → lands on **Profile**, edits directly |
| User changing theme/language | In `/settings` among key-backup controls | On **Profile**, grouped with name/avatar as "customization" |
| User backing up / restoring keys | In `/settings`, mixed with profile fields | On **Settings** (gear), now the page's sole focus |
| Header profile chip | Goes to `/settings` (same as gear) | Goes to **Profile** (distinct from gear) |
| Home-page "Profile" tile | **Dead link** (routes to `/profile` with no pubkey → "not found" warning) | Opens the user's own **Profile** page |
| Gear icon | Opens the everything-page | Opens **Settings** — identity & keys only |
| Viewing another user's profile | `/profile?pubkey=<hex>`, read-only | **Unchanged** — still read-only, still `/profile?pubkey=<hex>` |

### Decisions taken (confirmed with product owner)

| ID | Decision | Resolution |
|---|---|---|
| D1 | Bucket: Language | **Profile.** Language sits with Theme as personal customization. |
| D2 | Bucket: npub + QR | **Settings only.** npub, QR, backup, and restore stay together behind the gear; Profile does **not** duplicate them. |
| D3 | Navigation | **Chip → Profile, gear → Settings.** The header avatar+name chip opens Profile; the gear opens Settings. The home-page Profile tile is fixed to open the own Profile. |
| D4 | Gear page label | **Keep "Settings".** Profile is "Profile"; the gear page remains "Settings" — minimal churn, familiar. |
| D5 | Profile save UX (name/avatar) | **Explicit Save button** for nickname/avatar (recommended). A network kind:0 publish must not fire on every keystroke; theme/language remain immediate-apply. |
| D6 | Own-Profile route mechanism | **Reuse `/profile`, branch own-vs-other on pubkey** (recommended). Remove the own→`/settings` redirect. Keeps static-export friendliness and fixes the dead home tile in one move. |

---

## 2. Behavior specification

### 2.1 The Profile surface (customization)

The Profile surface presents, in this order, the controls that today live in the
**Profile**, **Language**, and **Theme** sections of `settings.tsx`:

1. **Nickname** — text input, max 32 chars (unchanged constraint).
2. **Avatar** — avatar picker modal (unchanged).
3. **Theme** — the five theme choices (Calm, Playful, Lego, Minecraft, Flower).
4. **Language** — English / Deutsch toggle.

**Save semantics are preserved exactly as they are today, per field group:**

- **Nickname + avatar** are *published identity*. Saving them must continue to
  (a) write local storage (`lp_userProfile_v1` via `writeUserProfile` / `ProfileContext.saveProfile`),
  (b) publish a Nostr **kind:0** metadata event (`publishProfileUpdate`), and
  (c) mark the local backup dirty (`markBackupDirty(true)`) — the same three effects
  the current `settings.tsx` save performs (settings.tsx ~242–249). (AC-PROFILE-2.)
- **Theme** and **Language** are *local display preferences*. Changing either writes
  `lp_settings_v1` and **applies immediately** (theme → `document.documentElement.dataset.theme`
  and Chakra theme; language → `document.documentElement.lang` and `useCopy()`), exactly
  as today. They are **not** published to Nostr and **must not** mark the backup dirty.
  (AC-PROFILE-3.)

Nickname/avatar use an explicit **Save** button (Decision D5), as today — a kind:0
relay publish must not fire on every keystroke. Theme and language remain
immediate-apply. The *effects* above are fixed regardless of the control style.

### 2.2 The Settings surface (technical / account)

The Settings surface (`/settings`, gear icon, label "Settings") presents **only** the
**Nostr Identity** section as it exists today:

1. **npub** — display + copy.
2. **QR code** — for others to scan/add you.
3. **Backup** — generate seed phrase + confirm flow.
4. **Restore** — paste seed phrase to recover an identity.

All four behave exactly as today, including the **restore** side effect that fetches
kind:0 from relays and writes the recovered nickname back to local storage
(settings.tsx ~144–168). After this feature, `/settings` no longer renders nickname,
avatar, theme, or language. (AC-SETTINGS-1, AC-SETTINGS-2.)

### 2.3 Navigation

- **Header profile chip** (`data-testid="header-profile-chip"`, avatar + nickname)
  links to the **Profile** surface instead of `/settings`. (AC-NAV-1.)
- **Gear icon** (desktop `IconButton` and mobile `data-testid="mobile-header-settings-link"`)
  continues to link to `/settings`, now the Settings surface. (AC-NAV-2.)
- **Mobile hamburger menu**: the profile chip entry inside the dropdown links to
  **Profile**; the gear remains the path to Settings. (AC-NAV-3.)
- **Home-page "Profile" tile** (`index.tsx`) links to the user's own **Profile**
  surface — fixing today's dead link (which routes to `/profile` with no pubkey and
  renders a "not found" warning). (AC-NAV-4.)

### 2.4 Own vs. other-user profile

- Viewing **another** user's profile (`/profile?pubkey=<hex>`) remains a **read-only**
  contact-detail view, unchanged by this feature. (AC-OTHER-1.)
- The user's **own** Profile is **editable** (the controls in §2.1). The editable
  own-profile and the read-only other-profile render from the same `/profile` route,
  branching on whether the requested pubkey is the logged-in user's (Decision D6;
  mechanism in §6). The current behavior where the own pubkey on `/profile`
  **redirects to `/settings`** (profile.tsx ~66–69) is **removed** — the own pubkey
  now renders the editable Profile, not a redirect to the keys page. (AC-OTHER-2.)

### 2.5 Backup-needed discoverability (cross-surface)

Editing nickname/avatar marks the local backup dirty (§2.1), but the **backup
affordance now lives on a different surface** (Settings) from the **action that
dirties it** (Profile). The "your identity isn't backed up / has unsaved changes"
signal must remain discoverable from where the user is. At minimum, the existing
backup-status indication must not be lost; ideally a small indicator (e.g. a dot on
the gear icon, or a one-line hint on Profile pointing to Settings) surfaces a dirty
backup so a user who just edited their profile knows to visit Settings. (Decision D6;
AC-BACKUP-1.)

---

## 3. The decisions this required

| ID | Decision | Resolution |
|---|---|---|
| D1 | Language bucket | **Profile** (confirmed). Sits with Theme. |
| D2 | npub + QR placement | **Settings only** (confirmed). No duplication on Profile. |
| D3 | Navigation wiring | **Chip → Profile, gear → Settings**; home tile fixed (confirmed). |
| D4 | Gear page label | **"Settings"** retained (confirmed). |
| D5 | Profile save UX (name/avatar) | **Explicit Save button** for nickname/avatar. Rejected: autosave — would fire a kind:0 relay publish per keystroke and spuriously mark the backup dirty. Theme/language stay immediate-apply (no publish). |
| D6 | Own-Profile route mechanism | **Reuse `/profile`, branch own-vs-other on pubkey**; remove the own→`/settings` redirect (§4.2). Rejected: a dedicated own-profile route — adds a surface without benefit and leaves the home tile / `/profile` redirect to untangle separately. |

---

## 4. Conflicts and caveats

### 4.1 Two save semantics on one page

Profile mixes **published** fields (nickname/avatar → kind:0 to relays + backup-dirty)
with **local-only** preferences (theme/language → immediate apply, no publish, no
backup-dirty). These must not be conflated. A single "Save everything" button that
republishes kind:0 when the user only flipped the theme would be wrong (needless relay
traffic, spurious backup-dirty). The split in §2.1 — explicit save for identity fields,
immediate-apply for preferences — must be preserved. (AC-PROFILE-3.)

### 4.2 The own→/settings redirect must be removed deliberately

`profile.tsx` currently redirects the own pubkey to `/settings` (~66–69). That redirect
exists *because* own-profile editing lived on `/settings`. After this feature, removing
it is mandatory — otherwise the chip→Profile link would bounce straight back to the
keys page and the split would be invisible. Verify no other caller depends on that
redirect. (AC-OTHER-2.)

### 4.3 Backup-dirty signal can be orphaned by the split

Before, editing your name and backing up your key were on the same page, so the dirty
state was self-evident. After the split, a user edits their name on **Profile**, the
backup goes dirty, but the **Settings** page that offers backup is elsewhere. Without
§2.5, the user has no on-screen reason to navigate to Settings and the backup nudge is
effectively lost. This is the one behavior that *degrades* if the split is done
naively. (AC-BACKUP-1.)

### 4.4 Bookmarks / muscle memory pointing at `/settings`

Anyone who bookmarked `/settings` to edit their name will now find only identity/keys
there. This is acceptable (the chip and home tile lead to Profile), but worth stating:
`/settings` deliberately no longer contains profile fields. No redirect from `/settings`
to Profile is added — the gear's destination is intentionally the technical page.

### 4.5 Theme/language application path is unchanged

Theme and language move **surfaces** but not **mechanism**: they still write
`lp_settings_v1` and apply through `useMoodTheme` / `LanguageContext`. The providers and
their app-wide effects are untouched; only the *controls* relocate from `settings.tsx`
to the Profile surface. No regression to global theming/i18n is expected — confirm the
controls re-render against the same hooks. (AC-PROFILE-3.)

### 4.6 i18n for new page chrome

Page titles/headings ("Profile", "Settings") and any new hint text (§2.5) must be
translated in both `en` and `de` per `CLAUDE.md`. Reuse existing keys where they exist
(e.g. the home tile already labels "Profile"); add new keys to the `Copy` type and both
language objects in `app/src/lib/i18n.ts`. (AC-I18N-1.)

---

## 5. Acceptance criteria

### Profile surface
- **AC-PROFILE-1** The Profile surface renders nickname, avatar, theme, and language
  controls — and does **not** render npub, QR, backup, or restore.
- **AC-PROFILE-2** Saving nickname/avatar on Profile (a) persists to local storage,
  (b) publishes a Nostr kind:0 event, and (c) marks the local backup dirty — the same
  three effects as today's settings save.
- **AC-PROFILE-3** Changing theme or language on Profile applies immediately and
  persists to `lp_settings_v1`, **without** publishing a kind:0 event and **without**
  marking the backup dirty.

### Settings surface
- **AC-SETTINGS-1** The Settings surface (`/settings`, gear, label "Settings") renders
  the Nostr Identity controls (npub + copy, QR, backup, restore) and **does not**
  render nickname, avatar, theme, or language.
- **AC-SETTINGS-2** Backup, restore, npub copy, and QR behave exactly as before the
  split, including restore writing the recovered nickname back to local storage.

### Navigation
- **AC-NAV-1** The header profile chip opens the **Profile** surface (not `/settings`).
- **AC-NAV-2** The gear icon (desktop and mobile) opens the **Settings** surface.
- **AC-NAV-3** The mobile hamburger menu's profile entry opens Profile; the gear path
  opens Settings.
- **AC-NAV-4** The home-page "Profile" tile opens the user's own editable Profile (no
  longer a dead link / "not found" warning).

### Own vs. other profile
- **AC-OTHER-1** Viewing another user's profile (`/profile?pubkey=<hex>`) remains a
  read-only view, unchanged.
- **AC-OTHER-2** Navigating to the user's own profile renders the **editable** Profile;
  the previous own-pubkey → `/settings` redirect no longer fires.

### Backup discoverability
- **AC-BACKUP-1** After editing nickname/avatar on Profile (which dirties the backup),
  the "backup needed / unsaved" state remains discoverable to the user from where they
  are (e.g. an indicator on the gear or a hint on Profile pointing to Settings); it is
  not silently lost by living only on the Settings page.

### i18n
- **AC-I18N-1** All page titles, section headings, and any new hint text on both
  surfaces are translated in `en` and `de`; no hardcoded user-visible strings.

---

## 6. Implementation pointers (non-binding)

- **Surface mechanism (Decision D6):** the project uses query params over path
  segments (`CLAUDE.md`) and one page file per route. Reuse `pages/profile.tsx`:
  branch on `pubkey === ownPubkey` (or absent) → render the **editable** own Profile;
  otherwise → the existing read-only other-user view. Remove the own→`/settings`
  redirect (profile.tsx ~66–69). Lift the Profile/Language/Theme JSX out of
  `settings.tsx` into the own-profile branch. This keeps static-export friendliness
  (no new dynamic segment) and fixes the home tile in one move.
- **Settings page slim-down:** `settings.tsx` keeps only the Nostr Identity section;
  drop the Profile/Language/Theme sections (now on Profile). Leave the route and label
  ("Settings") intact.
- **Navigation wiring (`Layout.tsx`):** repoint the profile chip `Link` (desktop ~and
  mobile dropdown) from `/settings` to the Profile surface. Leave the gear `IconButton`
  links pointing at `/settings`. Repoint the home-tile `Link` in `index.tsx` to the own
  Profile.
- **Save semantics:** reuse the existing `ProfileContext.saveProfile` +
  `publishProfileUpdate` + `markBackupDirty` for nickname/avatar (Decision D5: keep an
  explicit Save for these). Keep theme via `useAppTheme().setTheme` and language via
  `LanguageContext` — both already immediate-apply and persist to `lp_settings_v1`.
- **Backup discoverability (§2.5):** the simplest implementation is a small badge/dot
  on the gear icon driven by the existing backup-dirty flag, plus optionally a one-line
  hint on Profile. Reuse whatever flag `markBackupDirty` already sets.
- **i18n:** add `en` + `de` keys for the Profile page title and any new hint; reuse the
  existing "Profile" / "Settings" labels where present. Extend the `Copy` type and both
  language objects in `app/src/lib/i18n.ts`; consume via `useCopy()`.
- **Tests (e2e — must drive through the app, per `CLAUDE.md` and
  `feedback_e2e_no_direct_relay`):**
  - **Chip → Profile:** click the header profile chip; assert the Profile surface with
    nickname/avatar/theme/language is shown (and identity controls are absent).
  - **Gear → Settings:** click the gear; assert the Settings surface with npub/QR/
    backup/restore (and no profile/theme/language controls).
  - **Home tile:** click the home "Profile" tile; assert it opens the own editable
    Profile (no "not found" warning).
  - **Profile edit publishes:** change the nickname and save; assert a kind:0 publish
    happens **through the app's signer/publish path** (boot a second context as a peer
    and verify the updated profile is observed, per the publish-via-app rule) — do not
    hand-sign a kind:0 in the test.
  - **Theme/language are local:** change theme and language on Profile; assert they
    apply and persist across reload, and that **no** kind:0 publish is triggered by the
    change.
  - **Own profile no longer redirects:** navigate to the own profile; assert the
    editable Profile renders rather than a bounce to `/settings`.
  - **Other-user profile read-only:** open a contact's `/profile?pubkey=<hex>`; assert
    the read-only view is unchanged.

---

## 7. Out of scope

- **New profile fields** (about/bio, banner, NIP-05, website, separate username vs.
  nickname). This feature relocates the existing fields; it does not add to the
  `UserProfile` shape.
- **Redesign of the profile or settings visuals** beyond the split itself. Same
  controls, regrouped; no new styling system.
- **Relay configuration, notification preferences, or other technical settings** not
  present today. Settings holds exactly the identity controls that exist now; new
  technical settings are a separate future feature (they would land on the gear page).
- **Changing how theme/language persist** (still `lp_settings_v1`, still local-only).
  No move to Nostr-published preferences.
- **Changing the kind:0 publish payload** (still `name` + fixed `about` + `client`).
- **A redirect from `/settings` to Profile** for old bookmarks (§4.4) — deliberately
  not added.
