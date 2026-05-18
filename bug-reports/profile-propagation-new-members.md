# Profiles Not Propagated to New Group Members - Bug Report

## Bug Description
When a new member joins a group, existing members don't republish their current profiles to the new member. This causes new members to see incomplete or outdated profile information for existing group members, or no profile information at all if profiles haven't been explicitly published since the new member joined.

## Expected Behavior
- When a new member joins a group, all existing members should automatically republish their current profiles
- New members should immediately see the nickname, avatar, and badges of all existing group members
- Profile information should be consistent across all group members regardless of join time

## Reproduction Steps
1. User A creates a group and sets a profile (nickname and avatar)
2. User B joins the group via invitation
3. User A's profile should be immediately visible to User B when the group loads
4. If User A updates their profile while User B is in the group, User B should see the update
5. If User C joins the group later, they should see both User A's and User B's current profiles

## Actual Behavior
When User B joins:
- User B sees only historical profiles that were published before they joined
- If User A never explicitly published their profile, User B doesn't see User A's profile at all
- If User A updates their profile after User B joins, new members don't receive the update unless they manually rejoin the group
- New members only see abbreviated pubkeys instead of nicknames for users who haven't republished since the new member joined

## Impact
- **Severity**: High
- **Affected Users**: All group members, especially those joining existing groups
- **Affected Workflows**: Group member discovery, leaderboard display, collaborative quizzing features

## Environment/Context
- Quizzl learning groups with MLS (Messaging Layer Security)
- Nostr-based profile sync via application rumors
- IndexedDB caching of member profiles per group
- GitHub Pages hosting with Nostr relay network

## Root Cause Hypothesis
**Profile Publishing Flow**: Profiles are published exactly once per group when the group is subscribed to via the `onHistorySynced` callback in `welcomeSubscription.ts`. This happens when:
- User A creates a group (profile published immediately)
- User A joins an existing group via Welcome (profile published after historical sync)

**Gap**: There is no mechanism to republish existing members' profiles when a new member joins. The system relies on historical event replay:
- When User B joins, they fetch historical events from relays (including old profile messages from User A)
- But User A doesn't know User B joined and doesn't republish their current profile
- User A's new profile updates are sent to existing members, but User B misses them if they join after the update

**Affected Code**:
1. `app/src/context/MarmotContext.tsx` (lines 327-444) - `subscribeNewGroups()` publishes profile only once via `onHistorySynced`
2. `app/src/lib/marmot/welcomeSubscription.ts` (lines 156-283) - Historical sync mechanism, `onHistorySynced` callback
3. `app/src/context/MarmotContext.tsx` (lines 696-722) - `publishProfileUpdate()` is manual or called from settings, not on member join events
4. No handler for member join events to trigger profile republishing

**Why It's Missing**:
- Comment in `welcomeSubscription.ts` (lines 195-199): Profile updates intentionally deferred during join to avoid MLS epoch divergence
- No separate event handler for "member joined" that could republish profiles after epoch sync
- Fire-and-forget profile publishing with no acknowledgment or resend logic

## Constraints
- Cannot call `sendApplicationRumor()` during Welcome join (advances MLS epoch, breaks historical event decryption)
- Must preserve MLS epoch consistency - can't have divergent branches
- Need to maintain last-writer-wins semantics for profile updates (by `updatedAt` timestamp)
- Must work across multiple groups - user might be in 5+ groups simultaneously
- Battery/network constraints on mobile - shouldn't spam republishes

## Codebase Context
- **Likely locations**:
  - `app/src/context/MarmotContext.tsx` - Main profile publishing logic and group subscription
  - `app/src/lib/marmot/welcomeSubscription.ts` - Historical sync and onHistorySynced callback
  - `app/src/lib/marmot/groupStorage.ts` - Profile caching and merge logic

- **Related functionality**:
  - `profileSync.ts` - Profile serialization and parsing
  - `app/tests/e2e/groups-member-profiles.spec.ts` - E2E test that works around this with 10-second waits
  - `MarmotContext.tsx` (lines 222-225) - `onMembersChanged` callback is called when members added, could trigger republish

- **Integration points**:
  - Nostr kind 1 application rumors for profile delivery
  - MLS group state and epoch management
  - IndexedDB profile storage with last-writer-wins merge strategy

## Out of Scope
- Refactoring MLS state management
- Adding new relays or relay discovery logic
- Changing profile message format or protocol
- Performance optimization beyond what's needed for the fix
- Feature enhancements to profile UI
