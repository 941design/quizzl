# Architecture: Feedback Channel

## Paradigm

Modular monolith, package-by-feature. The feedback channel is a thin wiring layer — it introduces one new config module and one new page, then wires existing modules together with minimal changes.

## Module Map

| Module | Purpose | Location | Change |
|---|---|---|---|
| `maintainer-config` | Maintainer identity (list of hex pubkeys, active recipient, membership check) | `app/src/config/maintainer.ts` | NEW |
| `publicEnv` | Env var accessor for `NEXT_PUBLIC_MAINTAINER_NPUBS` | `app/src/lib/publicEnv.ts` | EXTEND |
| `directMessages` | DM send path; add feedback marker tags opt-in | `app/src/lib/directMessages.ts` | EXTEND |
| `MarmotContext` | Seed maintainer keys into knownPeers at startup | `app/src/context/MarmotContext.tsx` | EXTEND |
| `feedback-page` | Distinct feedback surface; reuses ContactChat | `app/pages/feedback.tsx` | NEW |
| `settings-page` | Add feedback entry point row | `app/pages/settings.tsx` | EXTEND |
| `contacts-page` | Filter out maintainer keys from contact list | `app/pages/contacts.tsx` | EXTEND |
| `NotificationBell` | Route maintainer DM notifications to /feedback | `app/src/components/NotificationBell.tsx` | EXTEND |
| `i18n` | Translation keys for all new UI strings | `app/src/lib/i18n.ts` | EXTEND |

## Boundary Rules

- No direct imports across module boundaries. Cross-module access only through declared seam contracts.
- `maintainer-config` is imported by: `directMessages`, `MarmotContext`, `feedback-page`, `settings-page`, `contacts-page`, `NotificationBell`.
- `contactChat` is NOT modified — feedback page is a consumer of it, not a modifier.
- `walledGarden` is NOT modified — the seeding in MarmotContext ensures admission without changing the gate logic.

## Seams

- **S1**: `maintainer-config` → all consumers: exports `MAINTAINER_PUBKEYS_HEX`, `MAINTAINER_ACTIVE_PUBKEY_HEX`, `MAINTAINER_DISPLAY_NAME`, `isMaintainerPubkey(hex)`.
- **S2**: `directMessages` → feedback-page: `publishFeedbackMessage` wrapper adds marker tags.
- **S3**: `maintainer-config` → `MarmotContext`: `MAINTAINER_PUBKEYS_HEX` array seeded on mount.

## Implementation Constraints

- `publicEnv.ts` accessors must be bare `process.env.NEXT_PUBLIC_X` calls — no guard, no optional chaining (Next.js static replacement requirement).
- Config module must be fail-soft per entry: catch on each `npubToPubkeyHex` decode, drop invalid entries, never throw at module load.
- `isAllowedDmSender` is NOT modified — it is pure and receives knownPeers as a parameter.
- Contacts filtering is applied at the view (contacts page), not in `listContacts()`, so the feedback surface and notification bell can still resolve the maintainer thread.
- All user-visible strings must go through `useCopy()` / `i18n.ts`.
- Static export routing rule: no new dynamic path segments; use `app/pages/feedback.tsx` as a standalone page.
