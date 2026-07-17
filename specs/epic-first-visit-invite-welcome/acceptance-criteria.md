# Acceptance Criteria — First-visit invite welcome screen

## First-launch detection

**AC-DETECT-1** — When the app initializes a page load and no stored identity
exists (`loadStoredIdentity()` returns null before auto-generation), the identity
context reports `isFreshIdentity = true` for that session.

**AC-DETECT-2** — When a stored identity already exists at init, the context
reports `isFreshIdentity = false`. After a first-time visitor's identity is
auto-generated and the app is reloaded, `isFreshIdentity` is `false` on the reload
(the welcome screen does not re-appear).

## Welcome screen content and blend

**AC-SCREEN-1** — The welcome screen renders the themed watercolor accents
(reusing the existing `HeroAccents` treatment) behind its content.

**AC-SCREEN-2** — The welcome screen renders the "Just chat." lead and the full
value-bullet list (no email / no login-or-password / no phone / no messages from
strangers / completely free), sourced from the existing home copy rather than
duplicated strings.

**AC-SCREEN-3** — The welcome screen renders an own-name input and exactly one
primary action button that completes the invite.

## Contact-card variant

**AC-CONTACT-1** — When a first-time visitor (`isFreshIdentity`) opens a contact
card link (`/add#c=…`), the welcome screen is shown instead of the "setting up…"
spinner / silent redirect.

**AC-CONTACT-2** — When the contact card carries a readable, signature-verified
inviter name, the welcome screen shows "{name} invited you to few.chat" with that
name.

**AC-CONTACT-3** — When the contact card carries no readable name (older v1 card,
bare npub, or `nostr:` URI), no invite line is rendered; the pitch, name input, and
action still render.

**AC-CONTACT-4** — Pressing the primary action on the contact welcome screen: (a)
saves the entered name to the local profile via the existing `saveProfile` path;
(b) runs the existing add-contact flow; (c) ends on the added contact
(`/contacts?…&added=1`).

**AC-CONTACT-5** — A non-blank name is required on the contact welcome screen: the
primary action is disabled until the newcomer enters a name (consistent with the
group-invite name gate).

## Group-invite variant

**AC-GROUP-1** — When a first-time visitor (`isFreshIdentity`) opens a group invite
link (`/groups/?join=…&admin=…&name=Y`), the welcome screen is shown, hosting the
name field and the join action (no separate join card afterward).

**AC-GROUP-2** — The group welcome screen shows the group name Y from the invite
URL in its invite line ("You're invited to join {group}").

**AC-GROUP-3** — The join action requires a non-blank name (the existing name
gate): the button is disabled until the newcomer enters a name.

**AC-GROUP-4** — Pressing the join action saves the entered name to the local
profile and sends the existing join request (reusing today's send path), then shows
the existing "request sent" confirmation.

## Own-name capture

**AC-NAME-1** — A name entered on the welcome screen is persisted to the local
profile so the newcomer is no longer name-gated on subsequent flows within the
session.

**AC-NAME-2** — For a v2 pairing contact card, a name captured on the welcome
screen satisfies the existing pending-pairing-echo name requirement inline, without
routing the newcomer through `/profile?pairing=1`.

## Privacy

**AC-PRIV-1** — Neither rendering the welcome screen nor completing the invite
publishes the entered name or any profile metadata as a public/kind-0 event. The
name travels only over the existing encrypted, recipient-addressed channels (group
join request; targeted pairing echo).

**AC-PRIV-2** — Reading the inviter name (contact card) and the group name (invite
URL) for display requires no relay read and induces no broadcast of the newcomer's
own data.

## Returning users unaffected

**AC-RETURN-1** — A returning user (identity already on disk, `isFreshIdentity =
false`) who opens a contact card link gets today's behavior (no welcome screen).

**AC-RETURN-2** — A returning user who opens a group invite link gets today's join
card behavior (no welcome screen).

**AC-RETURN-3** — A first-time visitor who opens the app at a non-invite route
(e.g. `/`) sees today's hero, not the invite welcome screen.

## Translations

**AC-I18N-1** — All new welcome-screen copy has both `en` and `de` entries in
`app/src/lib/i18n.ts`, added to the `Copy` type and both language dictionaries; no
user-visible string is hardcoded in the component.

**AC-I18N-2** — The dynamic invite lines use the function-copy pattern (e.g.
`(name: string) => string`) consistent with existing dynamic copy entries.
