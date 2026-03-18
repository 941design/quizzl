# Feature Specification Request: Learning Groups via Nostr + MLS

## 1. Overview

Add **learning groups** to Quizzl so users can form study groups and see each other's progress. Groups provide social encouragement for learning — not competition. The underlying protocol is **Marmot (MLS over Nostr)**, providing robust end-to-end encrypted group membership without relay trust.

### 1.1 Goals

- Users can create and join learning groups
- Group members see each other's quiz scores and study activity
- Groups are robust and private (E2E encrypted via MLS)
- Identity is tiered: zero-friction start, optional hardening
- Solo learning mode continues to work fully offline

### 1.2 Non-Goals (for this iteration)

- Distributing quiz questions through Nostr (future feature)
- Real-time answer synchronization or live quiz sessions
- Competition features (rankings within group are informational, not gamified)
- Teacher/admin roles or quiz authoring
- Group chat or messaging

---

## 2. Architecture

### 2.1 Protocol Choice: Marmot (MLS over Nostr)

**Why Marmot over NIP-29:**

| Concern | NIP-29 | Marmot/MLS |
|---------|--------|------------|
| Relay trust | Relay sees all data | Relay is untrusted, sees only encrypted blobs |
| Membership | Relay-enforced | Cryptographically enforced |
| Infrastructure | Requires special NIP-29 relay | Works with any standard Nostr relay |
| Proven in ecosystem | Yes | Yes — used in notestr (sister project) |
| Complexity | Medium | Higher, but patterns exist in notestr |

Marmot is alpha (`marmot-ts` v0.4), but the underlying cryptography (MLS RFC 9420, NIP-44, NIP-59) is well-specified. The notestr project provides battle-tested integration patterns for: `MarmotClient` setup, `NdkNetworkAdapter`, IndexedDB storage backends, device sync, and NIP-46 authentication.

### 2.2 Nostr Event Kinds Used

| Kind | Purpose |
|------|---------|
| 443 | KeyPackage publication (MLS init material for invitations) |
| 444 | Gift-wrapped Welcome (group invitation delivery) |
| 445 | Encrypted group messages (score updates, MLS Commits) |
| 10051 | Relay list for KeyPackage discovery |
| 0 | User metadata (nickname, display name) |

### 2.3 Data Synced via Groups

**Only scores and study activity are synced.** Specifically:

```
ScoreUpdate {
  topicSlug: string        // which topic
  quizPoints: number       // current total score for that topic
  maxPoints: number        // max possible points
  completedTasks: number   // study plan tasks completed
  totalTasks: number       // total study plan tasks
  lastStudiedAt: string    // ISO timestamp
}
```

This is sent as an MLS application message within the group. Members accumulate each other's score updates and display them in the leaderboard and shared study times views.

**Not synced:** quiz answers, notes content, selected topics list, settings.

---

## 3. Identity Model (Tiered)

Identity is introduced progressively. Users start with zero friction and can harden their identity when ready.

### Tier 1: Local Identity (default, zero friction)

- On first launch, generate a Nostr keypair automatically
- Store private key in localStorage (encrypted with a derived key)
- User picks a nickname and avatar (existing flow)
- Publish kind 0 metadata to relays
- **Risk:** clearing browser data = identity lost
- **Sufficient for:** solo learning, joining a group on one device

### Tier 2: Seed Phrase Backup

- User can generate/view a BIP-39-style mnemonic or raw nsec
- Displayed once with "write this down" prompt
- Allows recovery on a new device or after clearing browser data
- **No server involvement** — purely client-side backup
- **Sufficient for:** durable identity across devices, self-sovereign backup

### Tier 3: Nostr Signer (NIP-07 / NIP-46)

- Connect a browser extension (nos2x, Alby) via NIP-07
- Or connect a remote signer (nsec.app, Amber) via NIP-46 bunker URL
- Private key never touches the app
- **Sufficient for:** users with existing Nostr identity, maximum security

### Tier Transitions

- Tier 1 → Tier 2: "Back up your identity" prompt (generates mnemonic from existing key)
- Tier 1 → Tier 3: "Connect signer" replaces locally-stored key
- Tier 2 → Tier 3: Same as above, signer takes precedence
- Downgrading is not supported (once connected to a signer, you don't go back to local key)

---

## 4. Group Lifecycle

### 4.1 Creating a Group

1. User taps "Create Group" in the groups section
2. Enters a group name (e.g., "Biology Study Group")
3. App creates an MLS group via `MarmotClient.createGroup()`
4. Publishes the group creation Commit (kind 445) to configured relays
5. User is now the group admin and sole member
6. Group appears in the sidebar/groups list

### 4.2 Inviting Members

1. Admin opens the group member list
2. Enters an invitee's npub (or scans QR code / pastes npub)
3. App fetches the invitee's kind 443 KeyPackage from relays
4. If no KeyPackage found: show error "This user hasn't set up their Quizzl identity yet"
5. If found: call `group.inviteByKeyPackageEvent()` → publishes Commit (kind 445) + Welcome (kind 444 gift-wrap)
6. Invitee's app picks up the Welcome on next sync → auto-joins the group

### 4.3 Joining a Group

1. App subscribes to kind 444 (gift-wrapped Welcomes) for the user's pubkey
2. On receiving a Welcome: process it, join the MLS group
3. Group appears in the groups list
4. App begins subscribing to kind 445 events for the group
5. User calls `self_update()` to rotate leaf keys (within 24 hours)

### 4.4 Leaving a Group

1. User taps "Leave Group"
2. App sends a leave proposal or the admin removes them
3. MLS Commit advances the epoch, excluding the user
4. Group removed from local state

### 4.5 Score Syncing

1. When a user completes a quiz question or study task, their local progress updates (existing flow)
2. Periodically (e.g., on quiz completion, on app foreground, or every N minutes), the app publishes a `ScoreUpdate` application message to each group the user belongs to
3. Other members receive the update via their group subscription
4. Updates are stored locally (IndexedDB) per group member
5. The leaderboard and shared study times views aggregate these updates

**Sync is background and non-blocking.** If the user is offline, updates queue and send when connectivity returns.

---

## 5. Caveats & Known Risks

### 5.1 MLS Epoch Convergence

When a member joins or leaves, MLS advances the epoch. All members must process the Commit before sending new messages. Since Quizzl only syncs scores in the background (not real-time), this is low-risk — updates can simply wait until the epoch settles. However, rapid membership changes (many joins in quick succession) could create a backlog of Commits that clients must process sequentially.

**Mitigation:** Queue score updates if the group is mid-epoch-transition. Batch invitations where possible.

### 5.2 KeyPackage Availability

A user must publish kind 443 KeyPackages before they can be invited. If a user installs Quizzl but never opens the app while online, they won't have KeyPackages on relays. The inviter gets a confusing "can't invite" error.

**Mitigation:** Publish KeyPackages eagerly on app startup. Provide clear error messaging. Consider a "share invite link" flow that prompts the invitee to open the app first.

### 5.3 Tier 1 Identity Fragility

A locally-generated keypair stored in localStorage is lost if the user clears browser data, uses incognito mode, or switches devices. They lose access to their groups and their identity.

**Mitigation:** Prompt users to back up (Tier 2) before or shortly after joining their first group. Show a persistent but non-intrusive reminder. Never block the flow — just inform.

### 5.4 KeyPackage Single-Use Exhaustion

KeyPackages are consumed on use. If a user is invited to many groups simultaneously, they may run out of published KeyPackages, causing subsequent invitations to fail silently.

**Mitigation:** Publish multiple KeyPackages (e.g., 5-10) and replenish when the count drops below a threshold. Monitor consumption.

### 5.5 Multi-Device Sync

If a user has Quizzl open on two devices (same identity), both devices need to be in the MLS group independently. Marmot handles this via device sync (kind 444 Welcome forwarding, kind 443 auto-invite), but it adds complexity and is a known area of friction in notestr.

**Mitigation:** For the initial implementation, treat multi-device as a stretch goal. Document the limitation. Single-device-per-identity is acceptable for a prototype.

### 5.6 Relay Availability

If configured relays are down, group operations (join, invite, sync) fail. Unlike the current fully-offline app, group features require connectivity.

**Mitigation:** Solo learning continues to work offline. Group features degrade gracefully with clear "offline" indicators. Use multiple relay URLs for redundancy.

### 5.7 Static Export Compatibility

Quizzl currently exports as a static site. Group features require WebSocket connections to Nostr relays. Static export still works (WebSocket connections are client-side), but the app is no longer "fully offline" when groups are in use.

**Mitigation:** No architectural change needed for static export. The app simply opens WebSocket connections at runtime when group features are used.

### 5.8 marmot-ts Alpha Stability

`marmot-ts` is v0.4 alpha. API surface may change between minor versions. No formal security audit of the Marmot-specific layer (though MLS RFC 9420 and NIP-44 are independently audited).

**Mitigation:** Pin the marmot-ts version. Wrap marmot-ts calls behind an adapter layer (as notestr does with `NdkNetworkAdapter` and `MarmotClient` provider). Track upstream releases. Accept the alpha risk for a prototype.

### 5.9 Score Conflicts

If a user resets their quiz and retakes it, their score changes. Multiple score updates for the same topic arrive at group members. The latest update should win (last-write-wins by timestamp), but clock skew between devices could cause inconsistencies.

**Mitigation:** Use logical timestamps or include an incrementing sequence number in ScoreUpdate. Always take the update with the highest sequence.

### 5.10 Group Size Limits

MLS Commits are processed by all members. For very large groups (100+), each membership change triggers processing across all clients. This is unlikely for a study group app but worth documenting.

**Mitigation:** Soft-limit groups to ~50 members in the UI. No hard enforcement needed for a prototype.

---

## 6. UX Considerations

### 6.1 Social, Not Competitive

- Leaderboard shows group members' progress without explicit ranking emphasis
- Frame as "how we're doing" not "who's winning"
- Consider showing collaborative metrics: "Group has completed 73% of Biology"
- Celebrate group milestones, not individual supremacy

### 6.2 Progressive Disclosure

- Groups are optional — solo learning is the default and always works
- Group features revealed after the user has established a learning pattern
- Identity tiers introduced progressively, not as an upfront gate

### 6.3 Offline Resilience

- All quiz, notes, and study plan features work fully offline (current behavior preserved)
- Group sync happens when online; stale data shown with "last synced" timestamp
- No features become unavailable due to group membership — groups enhance, never gate

---

## 7. E2E Test Infrastructure

E2E tests are a hard requirement. The test harness must exercise the full group lifecycle across multiple clients with real Nostr relay and NIP-46 bunker infrastructure.

### 7.1 Infrastructure Components

| Component | Implementation | Notes |
|-----------|---------------|-------|
| **Nostr relay** | strfry via Docker (`docker-compose.e2e.yml`) | Ephemeral storage (`tmpfs`), port 7777 |
| **Bunker A** | `bunker.mjs` with hardcoded deterministic keypair | NIP-46 backend, auto-permits all requests |
| **Bunker B** | Same `bunker.mjs`, different keypair via env var | Second identity for multi-user tests |
| **App server** | Static build served via `npx serve` on port 3100 | Built with `NEXT_PUBLIC_RELAYS=ws://localhost:7777` |

This matches the proven architecture from notestr's E2E infrastructure.

### 7.2 Global Setup / Teardown

**Global setup** (runs once before all tests):
1. Start strfry relay via `docker compose -f docker-compose.e2e.yml up -d`
2. Build the app with `NODE_ENV=test` and `NEXT_PUBLIC_RELAYS=ws://localhost:7777`
3. Start bunker A (deterministic keypair A)
4. Start bunker B (deterministic keypair B, via `BUNKER_PRIVATE_KEY` env var)
5. Start static file server (`npx serve out -l 3100`)
6. HTTP health check on `http://localhost:3100`
7. Save child PIDs to `.state.json` for teardown

**Global teardown:**
1. Kill bunker A, bunker B, and serve processes via saved PIDs
2. Stop relay container via `docker compose down`

### 7.3 Fixtures

**Auth helpers** (one per identity):
- `auth-helper.ts` — `authenticateViaBunker(page)` for User A
- `auth-helper-b.ts` — `authenticateAsBunkerB(page)` for User B, exports `USER_B_NPUB`

**Cleanup helper:**
- `clearAppState(page)` — clears localStorage and all IndexedDB databases (group state, KeyPackages, score cache)

**NDK client fixture** (optional, for relay-level verification):
- Headless NDK instance with a third keypair for subscribing to relay events and verifying published data without the UI

### 7.4 Test Scenarios

Tests use two separate Playwright browser contexts (isolated storage) for User A and User B.

#### Identity & Auth
| Test | Actors | Verifies |
|------|--------|----------|
| Tier 1 auto-identity | 1 client | App generates keypair on first launch, publishes kind 0 metadata and kind 443 KeyPackage |
| Bunker auth | 1 client | NIP-46 bunker login flow, pubkey chip visible, session persists across reload |
| Seed phrase backup | 1 client | Mnemonic generation from existing key, recovery on fresh context |

#### Group Lifecycle
| Test | Actors | Verifies |
|------|--------|----------|
| Create group | User A | Group created via MarmotClient, kind 445 Commit published to relay, group appears in UI |
| Invite member | User A, User B | User B authenticates first (publishes KP), User A invites by npub, invite completes |
| Join group | User B | User B receives kind 444 Welcome, group appears in sidebar after reload/sync |
| Leave group | User B | User B leaves, group removed from local state |

#### Score Sync
| Test | Actors | Verifies |
|------|--------|----------|
| Score published to group | User A | User A completes quiz, ScoreUpdate application message sent via MLS, verifiable on relay |
| Score received by member | User A, User B | User A publishes score, User B sees updated progress in leaderboard view |

#### Error & Edge Cases
| Test | Actors | Verifies |
|------|--------|----------|
| Invite without KeyPackage | User A | Inviting an npub with no published KP shows clear error |
| Offline graceful degradation | 1 client | Solo learning works without relay, group features show offline indicator |
| Relay down during sync | 1 client | Score sync queues, no crash, resumes when relay available |

### 7.5 Makefile Targets

```makefile
e2e-up:                     # Start relay container
    docker compose -f docker-compose.e2e.yml up -d

e2e-down:                   # Stop relay container
    docker compose -f docker-compose.e2e.yml down -v

test-e2e: e2e-up            # Run Playwright tests (relay must be up)
    cd app && npx playwright test

test-e2e-ui: e2e-up         # Run Playwright in UI mode
    cd app && npx playwright test --ui
```

### 7.6 Known Limitations (from notestr)

- **MLS epoch convergence:** Multi-user application message tests (score propagation after `selfUpdate`) may be flaky due to marmot-ts epoch divergence. Notestr currently skips these. Accept this as a known limitation and test score sync in the "happy path" (no concurrent membership changes).
- **Timing sensitivity:** MLS crypto + relay roundtrips make multi-user tests inherently slow. Use generous timeouts (60-120s) and `test.describe.serial()` for ordered flows.
- **KeyPackage publish delay:** User B must authenticate and wait ~3s for KeyPackage publication before User A can invite. Build this delay into the test flow.

---

## 8. Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@internet-privacy/marmot-ts` | ^0.4.0 | MLS group protocol |
| `@nostr-dev-kit/ndk` | ^3.0.3 | Nostr relay connections, event handling, NIP-46 |
| `nostr-tools` | ^2.23 | NIP-19 encoding (npub/nsec), event utilities |
| `idb-keyval` | latest | IndexedDB wrapper for group state and KeyPackage storage |

These are the same dependencies used in notestr, enabling code reuse for the Nostr/Marmot layer.

---

## 8. Relationship to Notestr

Notestr (sister project) provides proven implementation patterns for:

- `NdkNetworkAdapter` — relay I/O adapter implementing `NostrNetworkInterface`
- `MarmotClient` provider — React context for group operations
- `useDeviceSync` hook — Welcome receipt, auto-invite, group event ingestion
- NIP-46 authentication flow — bunker URL parsing, session persistence
- IndexedDB storage backends — group state and KeyPackage persistence

These patterns should be extracted or adapted, not copied verbatim (different UI framework). The Nostr/Marmot layer is framework-agnostic.

---

## 9. Open Questions

1. **Who can add members?** (deferred per user request — to be decided later)
2. **Should group names/metadata be synced via MLS or stored locally?** (MLS application message vs. local-only)
3. **How many KeyPackages to pre-publish?** (5? 10? configurable?)
4. **Should score updates be push-on-change or periodic batch?** (or both — immediate on quiz completion, periodic heartbeat)
5. **Relay configuration:** ship with default public relays or require user configuration?
6. **Should there be a "group code" or "invite link" flow** for easier onboarding (instead of requiring npub)?

---

## 10. Future Features (Out of Scope)

These are explicitly deferred but noted for architectural awareness:

- **Quiz question distribution via Nostr** — host pushes questions to group as MLS application messages
- **Live quiz sessions** — real-time synchronized quiz rounds with answer collection
- **Group chat** — text messaging within the MLS group
- **Collaborative notes** — shared note-taking within a group
- **Achievements and badges** — group-level milestones and rewards
- **Group admin controls** — remove members, transfer ownership, manage permissions
