# First-visit invite welcome screen

**Status**: pre-implementation

## Problem

A brand-new person's first contact with few.chat is almost always an invitation
from someone they know — either a **contact card link** (`/add#c=…`) or a **group
invite link** (`/groups/?join=…&admin=…&name=Y`). Today that first moment is
underwhelming and impersonal:

- Opening a **contact card** shows only a brief "setting up…" spinner while an
  identity is silently generated, then dumps the newcomer onto the contacts page
  with a "Contact added" toast. The inviter's name — which is embedded in the
  link and readable with no network call — is never shown. There is no framing of
  what few.chat is or why they were invited.
- Opening a **group invite** shows the join card straight away, with a bare
  name-gate input. The group name is shown, but there is no welcome, no value
  proposition, and no sense that this is someone's first encounter with the app.

Neither entry point tells the newcomer *who invited them*, *what few.chat is*, or
*that they can be up and running in one step*. The marketing hero page
(`/` — "Just chat.", the no-email/no-password value bullets, themed watercolor
accents) exists but is never shown in the invite context, where a first-timer
would most benefit from it.

*Success signal: a first-time visitor who opens an invite link sees a single
welcoming screen that names their inviter (or their group), pitches few.chat, lets
them type their own name, and completes the invite in one action — no spinner
dead-end, no bare join card.*

## Solution

Introduce a single new **welcome screen** shown to genuine first-time visitors who
arrive via an invite link. The screen blends the invite message with the hero
pitch and hosts the completing action inline:

- **Invite message** at the top:
  - Contact card with a readable inviter name → "{name} invited you to few.chat".
  - Group invite → "You're invited to join {group}".
  - Contact card with **no** readable name (older v1 cards, bare npub / `nostr:`
    URIs) → the personalized line is omitted entirely; the rest of the screen
    still renders.
- **Hero pitch**: the existing "Just chat." lead plus the no-email/no-password/
  no-phone/no-strangers/free value bullets, reusing the current home copy so there
  is a single source of truth.
- **Themed watercolor accents** behind the content, reusing the existing
  `HeroAccents` treatment.
- **Own-name field**: an input where the newcomer types their own display name.
- **One primary button** that completes the invite immediately:
  - Contact card → save the entered name to the local profile, then run the
    existing add-contact flow and land on the added contact.
  - Group invite → save the entered name, then send the existing join request.

"First-time visitor" means **no stored identity existed when the app initialized
this page load** — i.e. the identity was freshly auto-generated on this very
visit. Returning users (identity already on disk) never see the welcome screen and
continue to get today's behavior. A first-time visitor who opens the app at a
non-invite route (`/`) also sees today's behavior — the welcome screen is specific
to the invite entry points.

## Scope

### In Scope

- A new welcome-screen presentation, blended from the invite message + hero pitch
  + watercolor accents, shown to first-time visitors on the two invite entry
  points (`/add` contact card, `/groups?join` group invite).
- A first-launch signal derived from "no stored identity at init", surfaced from
  the identity context so the invite pages can branch on it.
- An own-name input on the welcome screen and one-action completion of the invite
  (add contact / send join request), persisting the entered name to the local
  profile through the existing `saveProfile` path.
- The unknown-inviter fallback (omit the invite line when a contact card carries
  no name).
- New `en` + `de` translations for all new welcome-screen copy; reuse of existing
  home/group copy where it already says the right thing.

### Out of Scope

- Changing the silent identity auto-generation on first mount. Identity stays
  transparent; no manual "create identity" step is added.
- Any change to the `/` hero for non-invite first launches, or to the returning-
  user experience on invite links.
- The relay/crypto mechanics of adding a contact, the pairing echo, sending a join
  request, admin approval, or auto-accept. The welcome screen reuses these paths
  unchanged; it only reframes the entry and captures the name earlier.
- Avatar capture (contact cards carry no avatar; avatar heals later over the
  existing channels).

## Design Decisions

- **First-time detection = identity-null-at-init.** `NostrIdentityContext` already
  calls `loadStoredIdentity()` on first mount and auto-generates a keypair when it
  returns null (`app/src/context/NostrIdentityContext.tsx:174-187`). Capture that
  null result as a session-scoped `isFreshIdentity` signal on the context. A page
  reload after the identity is created reports `isFreshIdentity = false` naturally,
  so the welcome screen does not re-appear. No new persisted marker is required.
- **Welcome screen hosts the action (chosen).** The name field and the completing
  button live on the welcome screen itself; there is no separate follow-up card
  for a first-timer. For the group invite this folds today's name-gate + "Request
  to join" onto the welcome screen; for the contact card it adds an inline name
  field and an "add & continue" action.
- **Reuse existing completion logic, don't fork it.** The group variant reuses the
  existing join-request send path (today in `JoinRequestCard` /
  `joinRequestSender.ts`); the contact variant reuses the existing add path
  (`processContactInput` / `addContactByNpub` / the pairing-echo mechanism). The
  welcome screen is a presentation layer plus earlier name capture — the transport
  is untouched.
- **Name capture satisfies the pairing-echo name requirement inline.** For v2
  pairing contact cards, today a nameless scanner is redirected to
  `/profile?pairing=1` to set a name before the echo fires. When the welcome
  screen captures the name up front, that name satisfies the existing pending-echo
  requirement without the profile detour. The echo mechanism itself is unchanged —
  it simply has a name sooner.
- **A name is required on both entry points.** Group invite: a name is required
  to send a join request (preserves today's name gate — the button stays disabled
  until a non-blank name is entered). Contact card: a name is **also required** —
  the primary action stays disabled until the newcomer enters a non-blank name,
  and the entered name is saved before the contact is added. This keeps the two
  entry points consistent and ensures every newcomer starts with a shareable name.
- **Inviter name is read from the link, not the network.** The contact card's
  signed nickname is recoverable purely from the URL fragment via the existing
  pure `parseContactCard` decode; the group name comes from the invite URL's
  `name` param. No relay read and no profile broadcast is involved in showing the
  invite line (privacy invariant preserved).

## Technical Approach

Affected areas (the integration architect owns the final structure):

- **`app/src/context/NostrIdentityContext.tsx`** — expose `isFreshIdentity`
  (true when `loadStoredIdentity()` returned null at init this load). Session-
  scoped, no new persistence.
- **New shared welcome component** (e.g. `app/src/components/WelcomeInvite.tsx`) —
  renders the blended chrome: `HeroAccents`, the invite line (or nothing, per the
  fallback), the reused "Just chat." lead + value bullets, the own-name input, and
  a slot/props for the primary action + its label + disabled state. Two variants
  (contact / group) supplied by the callers.
- **`app/pages/add.tsx`** — when `isFreshIdentity` and a contact card is present,
  decode the card's name read-only for display and render the welcome (contact
  variant) instead of the "setting up…" spinner. The button saves the entered name
  (if any) and runs the existing add flow, ending on `/contacts?…&added=1`.
- **`app/pages/groups.tsx` / `app/src/components/groups/JoinRequestCard.tsx`** —
  when `isFreshIdentity` and `?join` params are present, render the welcome (group
  variant) hosting the existing name gate + "Request to join". Reuse the existing
  send path.
- **`app/src/lib/i18n.ts`** — add a `welcome.*` copy block to the `Copy` type and
  to both `en` and `de` dictionaries (invited-by-name function, group heading if
  not reusing `groups.joinRequestHeading`, name label/placeholder, CTA labels).
  Reuse `home.subheadingLead` and `home.subheadingPoints` for the pitch.

## Stories

Suggested split (planner refines):

1. **First-launch signal** — surface `isFreshIdentity` from
   `NostrIdentityContext`; unit-cover the null-at-init → true, identity-present →
   false mapping.
2. **Shared welcome screen + copy** — the `WelcomeInvite` presentation component
   (accents, invite line with fallback, reused pitch, name input, action slot) and
   the `welcome.*` en/de i18n entries.
3. **Contact-card variant** — wire `/add` to render the welcome for first-timers,
   decode the inviter name for display (fallback to no line), capture the own name,
   and complete the add flow.
4. **Group-invite variant** — wire `/groups?join` to render the welcome for
   first-timers hosting the name gate + join action, and complete the request.

## Non-Goals

- No public/kind-0 broadcast of the entered name or any profile metadata. The name
  is saved locally and only travels over the existing encrypted, recipient-
  addressed channels (group join request; targeted pairing echo). This is a hard
  privacy invariant (see `CLAUDE.md`).
- No manual identity-creation or key-backup step is introduced into the welcome
  flow.
- No redesign of the `/` hero, the contacts page, or the groups list.
- No welcome screen for returning users or for first-timers who arrive at a
  non-invite route.
