# Architecture — Invite Contact Picker Redesign

## Paradigm

Package-by-feature React/Next.js component tree, Chakra UI for styling, static export
(`output: 'export'`). No new module boundaries — this epic edits one existing component
(`InviteMemberModal`) and its e2e coverage. No new services, data flow, or storage.

## Module map

| Module | Purpose | Location | Owned data |
|---|---|---|---|
| `InviteMemberModal` | Renders the group-invite contact picker modal | `app/src/components/groups/InviteMemberModal.tsx` | `selectedPubkeyHex`, `isLoading`, `error`, `success` (component-local React state; unchanged) |
| `ProfileSummary` | Avatar+name row content, reused unmodified | `app/src/components/ProfileSummary.tsx` | none (pure presentational) |
| `contacts` lib | `selectableContactsForGroup` selection/eligibility logic, reused unmodified | `app/src/lib/contacts.ts` | none touched by this epic |
| e2e helpers/specs | Drive the modal via Playwright | `app/tests/e2e/helpers/group-setup.ts`, `app/tests/e2e/groups-invite-pending-contact-selectable.spec.ts`, `app/tests/e2e/groups-invite-guidance-state.spec.ts`, `app/tests/e2e/groups-error-cases.spec.ts` | none |

## Boundary rules

No direct imports across module boundaries. `InviteMemberModal` continues to consume
`selectableContactsForGroup`/`listContacts` and `ProfileSummary` exactly as it (or its
sibling `contacts.tsx`) already does today — no new coupling is introduced. e2e
specs/helpers only ever interact with the app through rendered DOM + Playwright, never via
raw WebSocket (project-wide CLAUDE.md rule, unaffected by this epic — no relay traffic is
touched).

## Seams

None — single-component, single-story epic. No cross-story contracts to declare.

## Implementation constraints (from exploration.json)

1. **`data-testid` goes on `ModalContent`, never `Modal`** (learning:
   `chakra-ui-modal-does-not-forward` — already correctly followed by the existing modal at
   line 153; preserve it).
2. **Row shell mirrors `ContactListView`'s row** (`app/pages/contacts.tsx:120-170`) — border,
   radius, background, hover treatment — but as a plain clickable `Box`/`Flex` with an
   `onClick` handler, NOT `LinkBox`/`LinkOverlay`/`NextLink` (AC-UX-7: no navigation).
3. **Selected-state styling**: `aria-pressed={isSelected}`, `borderColor`/`boxShadow` using
   the `brand.400` token (consistent with contacts.tsx's own hover `brand.400`, and
   analogous to the settings theme-picker's active-state treatment at
   `app/pages/settings.tsx:605-660`, without that page's checkmark badge — judged overkill
   for a text row).
4. **Disabled-row styling**: reduced opacity + `cursor: not-allowed`, no `onClick` attached.
   No prior disabled-row convention exists elsewhere in the app; this is this epic's
   precedent.
5. **`data-testid="invite-contact-row-${pubkeyHex}"`** per row, plus
   `data-testid="invite-contact-list"` on the row container — replacing
   `invite-contact-select`/`<option>` as the thing e2e specs target.
6. **No new i18n keys** — reuse `copy.groups.inviteContactLabel`,
   `inviteReasonAlreadyMember`, `inviteReasonBlocked` verbatim.
7. **e2e disabled-row assertions must target app state, not DOM state** (learning:
   `playwright-selectoption-can-force-set-disabled` — the historical reason
   `groups-error-cases.spec.ts`/`groups-invite-pending-contact-selectable.spec.ts` assert
   `invite-submit-btn` stays disabled + no `invite-error`/`invite-success`, rather than
   trusting a `disabled` DOM attribute. A row has no native `disabled` attribute at all, so
   the rewritten specs MUST keep asserting on `invite-submit-btn`/error/success state after
   attempting a click on a disabled row — never on a row-level DOM flag alone.
8. **`group-setup.ts`'s `inviteContactViaPicker` helper** keeps its existing
   wait-for-attach-before-interact discipline (VQ-S3-006 anti-race rationale in its current
   comment), retargeted from `option[value=...]` `toBeAttached` to
   `invite-contact-row-<hex>` `toBeAttached`/`toBeVisible`.
