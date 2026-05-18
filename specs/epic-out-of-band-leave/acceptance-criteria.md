# Acceptance Criteria — Out-of-Band Group Leave

Epic: `epic-out-of-band-leave`
Produced by: story-planner (Mode 1)
Date: 2026-05-18

---

## AC-SYNC: Leave-sync module (S1)

- **AC-SYNC-1** — `app/src/lib/marmot/leaveSync.ts` MUST export the constant `LEAVE_INTENT_KIND` with value `13` and a TypeScript interface `LeaveIntentPayload { pubkey: string }`. (Spec: § MLS Application Message Payload)

- **AC-SYNC-2** — `leaveSync.ts` MUST export a `serialiseLeaveIntent(payload: LeaveIntentPayload): string` function that returns `JSON.stringify({ pubkey: payload.pubkey })` without additional fields. (Spec: § MLS Application Message Payload; Exploration: patterns_to_mirror[0])

- **AC-SYNC-3** — `leaveSync.ts` MUST export a `parseLeaveIntent(content: string): LeaveIntentPayload | null` function that returns `null` for any input where `typeof parsed.pubkey !== 'string'`, and otherwise returns `{ pubkey: parsed.pubkey }`. (Spec: § MLS Application Message Payload; Exploration: patterns_to_mirror[0])

- **AC-SYNC-4** — A unit test in `app/tests/unit/marmot/leaveSync.test.ts` MUST assert that `parseLeaveIntent(serialiseLeaveIntent({ pubkey: "abcd" }))` returns `{ pubkey: "abcd" }` (round-trip), and that `parseLeaveIntent("not-json")` and `parseLeaveIntent('{"foo":1}')` both return `null`. (Spec: § Stories S1; Exploration: test_patterns[0])

---

## AC-HANDLER: Unified dispatcher integration (S2)

- **AC-HANDLER-1** — After this epic ships, `grep -r "group.on('applicationMessage'" app/src/` MUST return exactly one match, located in `app/src/lib/marmot/applicationRumorDispatcher.ts`. No other file in `app/src/context/` or elsewhere MUST contain this pattern. (Spec: § Relationship to Other Epics, § Key Decisions §1; Architecture: Boundary rules AR-1)

- **AC-HANDLER-2** — After this epic ships, `grep -rn 'rumor\.kind' app/src/context/` MUST return zero matches. All kind dispatch MUST live in handler modules under `app/src/lib/marmot/handlers/` or in `applicationRumorDispatcher.ts`. (Spec: § Relationship to Other Epics; Architecture: Boundary rules AR-3)

- **AC-HANDLER-3** — `app/src/lib/marmot/handlers/leaveHandler.ts` MUST export a `LeaveHandlerDeps` interface `{ enqueueLeave: (groupId: string, pubkey: string) => void }` and a `createLeaveIntentHandler(deps: LeaveHandlerDeps): RumorHandler` factory function. The file MUST NOT import from `app/src/context/`. (Spec: § Key Decisions §1, § UI Components New Components; Architecture: Boundary rules handler purity)

- **AC-HANDLER-4** — `handleLeaveIntent` (or the `handle` function inside `createLeaveIntentHandler`) MUST call `parseLeaveIntent(rumor.content)` and return early (no-op) if the result is `null`; otherwise MUST call `deps.enqueueLeave(ctx.groupId, payload.pubkey)`. (Spec: § Flow 2 step 1-2; Architecture: Seams handler-to-context)

- **AC-HANDLER-5** — `app/src/lib/marmot/registerHandlers.ts`'s `HandlerDeps` interface MUST include `enqueueLeave: (groupId: string, pubkey: string) => void`, and `buildDispatcher()` MUST append `createLeaveIntentHandler({ enqueueLeave: deps.enqueueLeave })` to the handlers array. (Spec: § Key Decisions §1; Architecture: Module map registerHandlers.ts; Exploration: patterns_to_mirror[2])

- **AC-HANDLER-6** — A unit test in `app/tests/unit/marmot/leaveHandler.test.ts` MUST assert: (a) a well-formed kind-13 rumor causes `enqueueLeave` to be called once with the correct `(groupId, pubkey)` arguments; (b) a malformed payload (missing `pubkey`) causes `enqueueLeave` to not be called. (Spec: § Flow 2 steps 1-2; Exploration: test_patterns[1])

---

## AC-SEND: Send path — leaveGroup emits kind-13 + kind-9 (S3)

- **AC-SEND-1** — `leaveGroup(groupId)` in `MarmotContext.tsx` MUST call `group.sendApplicationRumor` with a rumor of kind `LEAVE_INTENT_KIND` (13) and content `serialiseLeaveIntent({ pubkey: selfPubkeyHex })` **before** it calls any local-state purge functions (`removeGroupFromStorage`, `clearMemberScores`, etc.). (Spec: § Flow 1 steps 2-4, § Implementation constraints §6; Architecture: Implementation constraints §4)

- **AC-SEND-2** — After the kind-13 send, `leaveGroup` MUST issue a fire-and-forget kind-9 chat rumor with content `JSON.stringify({ type: "leave_intent", pubkey: selfPubkeyHex })`. The failure of this send MUST NOT prevent local-state purge or navigation from proceeding. (Spec: § Flow 1 step 3, § Chat Message Rendering)

- **AC-SEND-3** — If the kind-13 send fails due to unapplied proposals, `leaveGroup` MUST fall back to `sendRumorSafe` (which auto-commits first) before re-attempting the kind-13 send. (Spec: § Flow 1 step 2)

- **AC-SEND-4** — After kind-13 and kind-9 sends, `leaveGroup` MUST call `removeGroupFromStorage(groupId)`, `clearMemberScores(groupId)`, `clearMemberProfiles(groupId)`, `clearMessages(groupId)`, `clearPollData(groupId)`, `clearGroupMedia(groupId)`, `clearProfileRequestMemos(groupId)`, and `clearUnreadGroup(groupId)` — the same purge sequence as the pre-epic soft-mute implementation — then navigate to `/groups`. (Spec: § Flow 1 steps 4-5; Architecture: MarmotContext MODIFIED)

- **AC-SEND-5** — `leaveGroup` MUST NOT call `mlsGroup.leave()` at any point. No MLS Remove proposal MUST be emitted by the departing member's client. (Spec: § Background The problem, § Key Decisions §1; Non-Goals)

---

## AC-QUEUE: Pending-removal queue and debounce (S4)

- **AC-QUEUE-1** — `MarmotContext` MUST declare `pendingRemovalsRef` as `React.useRef<Map<string, PendingRemoval[]>>(new Map())` and `debounceTimersRef` as `React.useRef<Map<string, NodeJS.Timeout>>(new Map())`. Both MUST be `useRef`, not `useState`, so mutations do not trigger re-renders. (Spec: § Data Model, § Key Decisions §4; Architecture: Implementation constraints §3; Exploration: implementation_constraints[2])

- **AC-QUEUE-2** — The `enqueueLeave(groupId: string, pubkey: string)` closure MUST add a `PendingRemoval { groupId, pubkey, receivedAt: Date.now() }` entry to `pendingRemovalsRef.current.get(groupId)` (creating the array if absent), then arm (or extend) the per-group debounce timer in `debounceTimersRef.current` to fire after 5000 ms, replacing any existing timer for that group. (Spec: § Data Model, § Flow 2 step 2, § Key Decisions §4; Architecture: Implementation constraints §3)

- **AC-QUEUE-3** — Debounce timers MUST be cleared in the existing `groupSubsRef` cleanup at `MarmotContext.tsx:720-727`. When a group subscription is torn down, any pending timer for that group MUST be cancelled via `clearTimeout`. (Spec: § Data Model; Architecture: Implementation constraints §3; Exploration: implementation_constraints[2])

- **AC-QUEUE-4** — The `enqueueLeave` closure MUST be supplied to `buildDispatcher()` as `deps.enqueueLeave` inside `subscribeNewGroups`, replacing any stub that was wired in S2. (Spec: § Key Decisions §1; Exploration: patterns_to_mirror[2] notes)

---

## AC-COMMIT: Auto-commit path (S5)

- **AC-COMMIT-1** — When the debounce timer fires, the timer callback MUST re-fetch the live `mlsGroup` via `clientRef.current?.groups.get(groupId)` rather than relying on a closed-over reference. If `mlsGroup` is null, the callback MUST return without committing and leave the queue entries in place. (Spec: § Flow 2 step 5; Architecture: Seams context-to-mls-state; Exploration: open_questions_for_planner[0])

- **AC-COMMIT-2** — For each pending pubkey, the timer callback MUST call `getPubkeyLeafNodeIndexes(mlsGroup.state, pubkey)`. If the returned array is empty (pubkey no longer in the ratchet tree), the entry MUST be dropped from the queue and skipped — no Remove proposal MUST be built for it. (Spec: § Flow 2 step 5a, § Edge Cases "Leave intent arrives after member was already removed"; Architecture: Implementation constraints §5; Exploration: implementation_constraints[3])

- **AC-COMMIT-3** — Remove proposals MUST be built as plain objects `{ proposalType: PROPOSAL_TYPE_REMOVE, remove: { removed: leafIndex } }` using `PROPOSAL_TYPE_REMOVE = 3`. The `proposeRemoveUser()` function or any `Proposals.Remove(...)` factory MUST NOT be used. (Spec: § Flow 2 step 5b; Architecture: Implementation constraints §1-2; Exploration: key_call_sites[0])

- **AC-COMMIT-4** — The timer callback MUST issue exactly one `mlsGroup.commit({ extraProposals: [...removeProposals, Proposals.proposeUpdateMetadata({ adminPubkeys: remainingAdmins })] })` call, combining all Remove proposals and the `adminPubkeys` metadata update in a single `extraProposals` array. Two separate `commit` or `proposeUpdateMetadata` await calls are not permitted. (Spec: § Flow 2 step 5c; Architecture: Implementation constraints §1; Exploration: key_call_sites patterns_to_mirror[3])

- **AC-COMMIT-5** — `remainingAdmins` MUST be computed as `mlsGroup.groupData?.adminPubkeys.filter(pk => !departingPubkeys.includes(pk))` at timer-fire time (reading from the live group object, not a stale closure). (Spec: § Flow 2 step 5c; Exploration: implementation_constraints[4])

- **AC-COMMIT-6** — On successful commit, the timer callback MUST remove from `pendingRemovalsRef.current.get(groupId)` only the entries for pubkeys that were just committed. Entries added to the queue during the commit window MUST remain for the next timer cycle. (Spec: § Flow 2 step 5d)

- **AC-COMMIT-7** — On commit failure (exception or rollback), the timer callback MUST NOT retry immediately with the cached `removeProposals` array. The failing entries MUST remain in the pending queue so the next timer tick re-derives leaf indexes via `getPubkeyLeafNodeIndexes` (step 5a) before re-attempting. (Spec: § Flow 2 step 5e, § Edge Cases "group.commit succeeds locally but publish fails"; Architecture: Implementation constraints §5)

- **AC-COMMIT-8** — A unit test in `app/tests/unit/marmot/autoCommitLeave.test.ts` (or equivalent) MUST assert: (a) a single pending pubkey produces exactly one `mlsGroup.commit` call with the correct `extraProposals` shape; (b) when `getPubkeyLeafNodeIndexes` returns `[]` for a pubkey, `commit` is not called and the entry is dropped; (c) two simultaneous pending pubkeys produce one `commit` call with two Remove proposals and the correct `remainingAdmins`. (Spec: § Flow 2; Exploration: test_patterns[2])

---

## AC-CHAT: Kind-9 announcement parsing and rendering (S6)

- **AC-CHAT-1** — `StructuredContent` union in `app/src/lib/marmot/parseStructured.ts` MUST include the variant `{ type: 'leave_intent'; pubkey: string }`. (Spec: § Chat Message Rendering; Architecture: Module map parseStructured.ts; Exploration: patterns_to_mirror[3])

- **AC-CHAT-2** — `parseStructured(content)` MUST return `{ type: 'leave_intent', pubkey: string }` when `content` is valid JSON with `type === 'leave_intent'` and `typeof parsed.pubkey === 'string'`, and MUST return `null` for missing or non-string `pubkey`. (Spec: § Chat Message Rendering; Exploration: patterns_to_mirror[3])

- **AC-CHAT-3** — `app/src/components/groups/LeaveChatAnnouncement.tsx` MUST be a new presentational component accepting `{ memberDisplay: string }` props and rendering the text from `copy.groups.leftGroup(memberDisplay)` inside a gray-sidebar styled box with `data-testid="leave-chat-announcement"`. (Spec: § UI Components New Components; Architecture: Module map LeaveChatAnnouncement.tsx; Exploration: patterns_to_mirror[4])

- **AC-CHAT-4** — `LeaveChatAnnouncement` MUST use `useCopy()` to retrieve the display string, and MUST NOT hardcode any English or German text. (Spec: § Chat Message Rendering; Architecture: Boundary rules §7 Translation contract)

- **AC-CHAT-5** — `renderStructuredMessage` in `app/src/components/chat/ChatBox.tsx` MUST include a branch for `structured?.type === 'leave_intent'` that resolves `memberDisplay` as `profileMap[structured.pubkey]?.nickname ?? truncateNpub(pubkeyToNpub(structured.pubkey))` and renders `<LeaveChatAnnouncement memberDisplay={memberDisplay} />`. (Spec: § Chat Message Rendering; Architecture: Module map ChatBox.tsx; Exploration: patterns_to_mirror[5])

- **AC-CHAT-6** — A unit test MUST assert that `parseStructured('{"type":"leave_intent","pubkey":"abcd1234"}')` returns `{ type: 'leave_intent', pubkey: 'abcd1234' }`, and that `parseStructured('{"type":"leave_intent"}')` (missing pubkey) returns `null`. (Spec: § Chat Message Rendering; Exploration: patterns_to_mirror[3] — "Coverage: parseStructured.test.ts")

---

## AC-I18N: Translation keys (S6)

- **AC-I18N-1** — The `Copy` type in `app/src/lib/i18n.ts` MUST include `groups.leftGroup: (member: string) => string` as a new key in the `groups` namespace. (Spec: § Key Decisions §5; Architecture: Module map i18n.ts; Exploration: translation_keys_needed[0])

- **AC-I18N-2** — The English translation object MUST include `groups.leftGroup: (member: string) => \`${member} left the group\`` and the German object MUST include `groups.leftGroup: (member: string) => \`${member} hat die Gruppe verlassen\``. (Spec: § Key Decisions §5; Exploration: translation_keys_needed[0])

- **AC-I18N-3** — A vitest test in `app/tests/unit/` MUST assert exact string values for both `en` and `de` `groups.leftGroup` keys, following the pattern of `app/tests/unit/cancelPendingInvitation.i18n.test.ts`. (Spec: § Stories S6; Exploration: test_patterns[3])

---

## AC-MEMBERS: Member-list refresh on commit (S7)

- **AC-MEMBERS-1** — When the auto-remove commit from S5 succeeds, the `onMembersChanged` callback wired at `MarmotContext.tsx:599-609` MUST fire (via the MLS group's own notification mechanism), causing the member list displayed in the UI to refresh and no longer show the departed member. (Spec: § Flow 2 step 6, § Scope § In Scope "Member-list refresh"; Exploration: key_call_sites[4])

- **AC-MEMBERS-2** — An e2e test in `app/tests/e2e/groups-leave-intent.spec.ts` MUST: create a two-client session (User A creates group, invites User B); User B calls the leave flow; within 5 seconds User A's client commits the removal; User B's name MUST disappear from User A's member list; User A MUST be able to send a chat message after the removal commit (proving the group is not blocked). (Spec: § Verification across all stories)

---

## AC-EDGE: Edge-case behaviors

- **AC-EDGE-1** — When `leaveHandler.ts` receives a kind-13 rumor for a pubkey that `getPubkeyLeafNodeIndexes` no longer finds in the ratchet tree (already removed by another admin), the enqueue callback MUST still be called; the stale-leaf guard in AC-COMMIT-2 MUST silently drop the entry when the timer fires. The group MUST NOT enter an error state. (Spec: § Edge Cases "Leave intent arrives after member was already removed", § Flow 2 step 5a)

- **AC-EDGE-2** — When two admins both fire their debounce timer for the same departing pubkey, only one commit MUST win (via `EpochResolver` fork resolution). The losing admin's client MUST not produce a duplicate Remove after the rollback — the pending-queue re-check (AC-COMMIT-2, `getPubkeyLeafNodeIndexes` returns `[]`) MUST prevent a second commit. (Spec: § Edge Cases "Two admins both fire their debounce timer for the same pubkey", § Edge Cases "Multiple admins try to commit the same removal")

- **AC-EDGE-3** — When multiple members leave simultaneously within the 5-second debounce window, their pubkeys MUST be batched into a single `mlsGroup.commit` call with multiple Remove proposals in one `extraProposals` array. (Spec: § Edge Cases "Multiple members leave simultaneously", § Key Decisions §4)

- **AC-EDGE-4** — When `group.commit` succeeds locally but publish fails, the pending-removal entry MUST remain in `pendingRemovalsRef` and the retry path MUST re-derive leaf indexes via `getPubkeyLeafNodeIndexes` before re-attempting. No retry MUST use the cached `removeProposals` array from the failed attempt. (Spec: § Edge Cases "group.commit succeeds locally but publish fails", § Flow 2 step 5e)

- **AC-EDGE-5** — When a kind-9 leave-announcement send (fire-and-forget) fails for any reason, the departing member's local-state purge and navigation to `/groups` MUST still complete. The failure MUST NOT surface an error to the user. (Spec: § Flow 1 step 3, § Chat Message Rendering "Fire-and-forget")

- **AC-EDGE-6** — On admin cold-start (app restart), kind-13 messages re-delivered by `subscribeToGroupMessages` historical sync MUST be routed through `leaveHandler.ts` via the dispatcher, repopulating the pending-removal queue. The 5-second debounce MUST absorb the burst into a single commit per group. No first-sync gate or deduplication mechanism beyond the existing dispatcher LRU is required. (Spec: § Flow 3, § Data Model; Exploration: implementation_constraints[7])

- **AC-EDGE-7** — When the departing member is the only admin (sole-admin edge case) or when only non-admin members remain (pre-admin-promotion groups), the ghost leaf MUST persist in the ratchet tree and the group MUST NOT be blocked. This is an explicitly accepted limitation; no error MUST be raised. (Spec: § Flow 4, § Edge Cases "Departed member is the only admin", § Non-Goals)

- **AC-EDGE-8** — When an auto-remove commit is rolled back by a concurrent chat or poll commit from the same admin targeting the same epoch, `EpochResolver` resolves the conflict; the pending-removal queue entry MUST remain, and the auto-remove logic MUST re-fire on the next timer tick or next inbound event, re-deriving leaf indexes. (Spec: § Edge Cases "Auto-remove commit rolled back by concurrent chat/poll commit from same admin")

---

## AC-ARCH: Cross-cutting boundary invariants

- **AC-ARCH-1** — `app/src/lib/marmot/handlers/leaveHandler.ts` MUST NOT contain any import from `app/src/context/` or any direct IDB call. All side-effects MUST flow through the injected `LeaveHandlerDeps` bag. (Spec: § Key Decisions §1; Architecture: Paradigm, Boundary rules handler purity)

- **AC-ARCH-2** — `app/src/context/ChatStoreContext.tsx` MUST NOT be modified by this epic. The kind-9 leave-intent announcement MUST flow through the existing `chatHandler → appendMessage(IDB) → setChatVersion → ChatStoreContext re-reads IDB` chain without any new listener or kind branch in `ChatStoreContext`. (Spec: § Relationship to Other Epics; Architecture: Seams ChatStoreContext-to-MarmotContext, TOUCH-FREE status)

- **AC-ARCH-3** — `grep -r "from.*handlers/" app/src/ --include="*.ts" --include="*.tsx" -l` MUST list only `registerHandlers.ts` after this epic ships; no other file MUST import directly from the `handlers/` directory. (Spec: § Key Decisions §1; Architecture: Boundary rules AR-4 inherited from unified-dispatch epic)
