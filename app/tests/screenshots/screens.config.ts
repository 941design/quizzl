/**
 * Manifest for the browsable UI documentation gallery (`make screenshots`).
 *
 * This file is the single source of truth for WHAT gets photographed, HOW it
 * is grouped into user flows, and WHICH product invariants each screen
 * illustrates. `capture.ts` reads it, drives the app to each state across the
 * viewport matrix, and writes `manifest.json`; `build-gallery.mjs` renders that
 * into a self-contained `index.html`.
 *
 * Keep this declarative. Anything that needs to DRIVE the app (create a group,
 * exchange a contact, send a DM) is a named `builder` implemented in
 * `capture.ts` — this file only references it by key. Simple screens just
 * declare a `route` and are photographed after the standard single-user seed.
 *
 * The `invariants` on each screen are the documentation payload: they state the
 * product rule the screenshot is evidence for. Written at product-owner
 * altitude on purpose — they are what a reviewer checks the picture against.
 */

/** A device size the gallery can toggle between. Widths chosen at the four
 *  breakpoints the responsive layout actually pivots at. */
export interface Viewport {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const VIEWPORTS: Viewport[] = [
  { id: 'mobile', label: 'Mobile', width: 375, height: 812 },
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024 },
  { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
];

export interface ScreenSpec {
  /** Stable, unique, kebab-case. Used for screenshot filenames + anchors. */
  id: string;
  /** Human title shown in the gallery. */
  title: string;
  /** One or two sentences: what this screen is and when the user sees it. */
  description: string;
  /** Product rules this screenshot is evidence for. Rendered alongside it. */
  invariants: string[];
  /**
   * Simple screens: the route to visit after the standard single-user seed
   * (deterministic identity + nickname + theme/language). Query params allowed.
   */
  route?: string;
  /**
   * Populated / multi-user screens: the key of a builder in capture.ts's
   * BUILDERS registry. The builder drives the app (second browser context,
   * real publish paths) and returns the Page to photograph. When set, `route`
   * is ignored.
   */
  builder?: string;
  /** Optional theme override for this screen (defaults to the seed theme). */
  theme?: string;
  /** Optional language override ('en' | 'de'). Defaults to 'en'. */
  language?: 'en' | 'de';
  /** data-testid to wait for before the shot (best-effort; capture continues
   *  after a short timeout if absent so one missing anchor never blanks a run). */
  waitFor?: string;
  /** Extra settle time in ms after `waitFor` before the shot (animations etc.). */
  settleMs?: number;
}

export interface Flow {
  id: string;
  title: string;
  /** One-line summary of the journey this flow documents. */
  summary: string;
  screens: ScreenSpec[];
}

export const FLOWS: Flow[] = [
  {
    id: 'onboarding',
    title: 'Onboarding & Home',
    summary:
      'What a visitor lands on, how the app explains itself, and the deep-link entry point for adding a contact.',
    screens: [
      {
        id: 'home',
        title: 'Start page',
        description:
          'The landing hero and the four primary tiles (Contacts, Groups, Profile, How it works). First thing every visitor sees.',
        invariants: [
          'Viewable with no identity and no network — the start page never blocks on a relay.',
          'No personal data is shown or requested before the user chooses to create a profile.',
        ],
        route: '/',
        waitFor: 'home-subheading',
      },
      {
        id: 'info',
        title: 'How it works',
        description: 'The long-form explainer page describing the app and how conversations stay private.',
        invariants: ['Static prose only — renders offline, identical for every visitor.'],
        route: '/info',
        waitFor: 'info-page',
      },
      {
        id: 'add-no-card',
        title: 'Add contact — no card',
        description:
          'The /add deep-link landing when opened without a contact card payload. This is the target of scanned/shared contact links.',
        invariants: [
          'Contact exchange is out-of-band: a card arrives via a shared link, never by broadcasting profile data to a relay.',
        ],
        route: '/add',
        waitFor: 'add-page-no-card',
      },
    ],
  },
  {
    id: 'identity',
    title: 'Profile & Identity',
    summary: 'Setting a display name and avatar, and the settings that govern keys, relays and signing.',
    screens: [
      {
        id: 'profile',
        title: 'Profile',
        description: 'Where the user sets their nickname and avatar. Shown here with a seeded display name.',
        invariants: [
          'PRIVACY: editing the nickname or avatar never publishes a public kind-0. Profile data is only sent over encrypted, recipient-addressed channels.',
          'The nickname is capped to a 32-UTF-8-byte budget so it always fits a contact card.',
        ],
        route: '/profile',
        waitFor: 'profile-nickname-bytecount',
      },
      {
        id: 'settings',
        title: 'Settings',
        description: 'Theme, language, call settings and the collapsed Advanced section.',
        invariants: ['Language and theme are local preferences — they persist on the device, not on any relay.'],
        route: '/settings',
        waitFor: 'advanced-settings-toggle',
      },
      {
        id: 'settings-advanced',
        title: 'Settings — Advanced',
        description:
          'The expanded Advanced region: public key (npub), relay list, signer connections and the danger zone.',
        invariants: [
          'The npub shown here is public by design; the private key never leaves the device.',
          'The reset-all-data action is deliberately absent — local identity cannot be wiped by an accidental tap.',
        ],
        route: '/settings',
        builder: 'settingsAdvanced',
        waitFor: 'copy-npub-btn',
      },
    ],
  },
  {
    id: 'contacts',
    title: 'Contacts & Direct Messages',
    summary: 'From an empty address book to a saved contact and a private one-to-one conversation.',
    screens: [
      {
        id: 'contacts-empty',
        title: 'Contacts — empty',
        description: 'The address book before anyone has been added.',
        invariants: ['A fresh user has no contacts and no leaked social graph — nothing is fetched from a relay to populate this.'],
        route: '/contacts',
        waitFor: 'contacts-empty-state',
      },
      {
        id: 'contacts-populated',
        title: 'Contacts — with a contact',
        description: 'The address book after a contact has been added through the real add-contact deep link.',
        invariants: ['A contact appears only after an explicit, user-initiated add — never auto-discovered.'],
        builder: 'contactsPopulated',
        waitFor: 'contacts-list',
      },
      {
        id: 'dm-conversation',
        title: 'Direct message',
        description: 'A one-to-one encrypted conversation between two paired users, with messages exchanged both ways.',
        invariants: [
          'A DM is only permitted between users who share a group or a completed pairing (the walled garden).',
          'Messages transit the relay as NIP-59 gift wraps — addressed, encrypted mail, not a broadcast.',
        ],
        builder: 'dmConversation',
        waitFor: 'chat-input',
      },
    ],
  },
  {
    id: 'groups',
    title: 'Learning Groups',
    summary: 'Creating a group, inviting a member, and the shared conversation once they join.',
    screens: [
      {
        id: 'groups-empty',
        title: 'Groups — empty',
        description: 'The groups list before any group exists.',
        invariants: ['No group state is present until the user creates or is admitted to one.'],
        route: '/groups',
        waitFor: 'groups-empty-state',
      },
      {
        id: 'create-group',
        title: 'Create group',
        description: 'The create-group modal where the user names a new group.',
        invariants: ['Creating a group is a local action; membership is established later through encrypted invites.'],
        route: '/groups',
        builder: 'createGroupModal',
        waitFor: 'create-group-modal-content',
      },
      {
        id: 'group-detail',
        title: 'Group conversation',
        description: 'A group with two members and messages exchanged, showing the member list and composer.',
        invariants: [
          'Group messages are MLS-encrypted application rumors delivered only to members — never to public relays.',
          'A newly created group stays private until an invitee explicitly accepts (pull-only admission, Walled Garden v2).',
        ],
        builder: 'groupWithMessages',
        waitFor: 'group-detail-page',
      },
      {
        id: 'group-invite',
        title: 'Invite a member',
        description: 'The invite modal, which offers a picker of existing contacts rather than a free-text key field.',
        invariants: ['You can only invite someone already in your contacts — invitations are addressed to a known pubkey, not typed in blind.'],
        builder: 'inviteModal',
        waitFor: 'invite-member-modal-content',
      },
      {
        id: 'group-pending-invitation',
        title: 'Pending invitation',
        description: 'The invitee side: a received invitation waiting in the pending-invitations queue before they accept.',
        invariants: ['Admission is pull-only: the invitee must accept before the group joins their list and before any DM gate opens.'],
        builder: 'pendingInvitation',
        waitFor: 'pending-invitations-section',
      },
    ],
  },
  {
    id: 'appearance',
    title: 'Appearance & Localisation',
    summary: 'The theming system and the German localisation, both switchable from Settings.',
    screens: [
      {
        id: 'theme-preview-default',
        title: 'Theme preview',
        description: 'The theme-preview page rendering the hero and component samples in the default theme.',
        invariants: ['Every theme must keep text/background contrast at or above WCAG AA (4.5:1).'],
        route: '/theme-preview',
        waitFor: 'theme-preview-hero',
      },
      {
        id: 'theme-preview-forest',
        title: 'Theme preview — Forest',
        description: 'The same page under an alternate theme, demonstrating the theming system swaps a whole palette.',
        invariants: ['Switching theme changes only presentation — no content, identity or data changes.'],
        route: '/theme-preview',
        theme: 'forest',
        waitFor: 'theme-preview-hero',
      },
      {
        id: 'home-german',
        title: 'Start page — German',
        description: 'The start page with the app language set to German, showing full localisation of UI chrome.',
        invariants: ['All user-facing chrome is translated (en/de); no English strings are hardcoded into components.'],
        route: '/',
        language: 'de',
        waitFor: 'home-subheading',
      },
    ],
  },
  {
    id: 'legal',
    title: 'Info & Legal',
    summary: 'The imprint and the feedback channel entry point.',
    screens: [
      {
        id: 'imprint',
        title: 'Imprint',
        description: 'The legally required imprint page, rendered from a single-sourced address template.',
        invariants: ['The address is single-sourced; empty fields (phone, VAT) drop out rather than showing blank labels.'],
        route: '/imprint',
        waitFor: 'imprint-page',
      },
      {
        id: 'feedback',
        title: 'Feedback',
        description: 'The feedback channel entry point for sending feedback to the maintainer.',
        invariants: ['Feedback travels the same encrypted DM path as any other message — it is not a public post.'],
        route: '/feedback',
        waitFor: 'feedback-page',
      },
    ],
  },
];
