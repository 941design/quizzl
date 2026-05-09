# Acceptance Criteria — DM Message Recovery

## §3.1 Lenient parser (closes G1)

| ID | Description | Test surface |
|----|-------------|--------------|
| AC-01 | `parseDirectPayload('hello')` returns `{ content: 'hello' }` | Unit test in `app/tests/unit/directMessages.test.ts` — direct call |
| AC-02 | `parseDirectPayload('{"type":"text","text":"hi"}')` returns `{ content: 'hi' }` | Unit test in `app/tests/unit/directMessages.test.ts` — direct call |
| AC-03 | `parseDirectPayload('{"unknown":"shape"}')` returns `{ content: '{"unknown":"shape"}' }` (raw JSON string treated as text) | Unit test in `app/tests/unit/directMessages.test.ts` — direct call |
| AC-04 | `parseDirectPayload('')` returns `null` | Unit test in `app/tests/unit/directMessages.test.ts` — direct call |
| AC-05 | `parseDirectPayload` for a valid image envelope returns the same value as today (no behaviour change on the happy path) | Covered by existing `directMessages.test.ts` image round-trip test |
| AC-06 | A unit test in `app/tests/unit/directMessages.test.ts` asserts AC-01 through AC-04 by direct call | Test file existence + assertion count |

**Trace notes:** All five ACs (§3.1) — parsing priority 1–4, empty guard, image envelope preserved. AC-05 has no explicit new test (relies on existing test); no ambiguity.

---

## §3.1, §3.3, §3.5 ContactChat inbound

| ID | Description | Test surface |
|----|-------------|--------------|
| AC-07 | `ingestEvent` in `ContactChat.tsx` returns a `ChatMessage` (not `null`) when the kind-4 event decrypts to a non-empty bare-plaintext string | Unit test in `app/tests/unit/directMessages.test.ts` or integration test — `ingestEvent` called with a bare-plaintext kind-4 event, asserts return value is non-null |
| AC-08 | `handleGiftWrapEvent` in `ContactChat.tsx` upserts a `ChatMessage` for any kind-14 rumor whose decrypted content is non-empty, regardless of envelope shape | Unit test — `handleGiftWrapEvent` called with bare-plaintext rumor, asserts `ChatMessage` is upserted |
| AC-09 | `ContactChat.init` fires a parallel `fetchEventsWithTimeout({ kinds: [1059], '#p': [pubkeyHex], limit: 500 })` and ingests every result through the gift-wrap unwrap+parse path | Unit test — `init` called (mocked NDK), asserts the kind-1059 fetch filter was issued and results were processed through `handleGiftWrapEvent` |
| AC-10 | `ContactChat.init` waits for both historical fetches to settle before calling `upsertMessages`; rendered list is in `createdAt` order | Unit test — both fetch promises resolve out of order; asserts `upsertMessages` is called only after both settle, with monotonically-ordered messages |
| AC-11 | A historical gift wrap whose inner rumor id matches a `ChatMessage` already in IDB does not produce a duplicate row | Unit test — `appendMessage` called twice with the same rumor id; asserts only one row exists in the mock store |
| AC-12 | E2E: `dm-third-party-inbound.spec.ts` publishes a kind-4 bare-plaintext event, asserts bell badge becomes 1, opens chat, asserts bubble renders plaintext | `app/tests/e2e/dm-third-party-inbound.spec.ts` |
| AC-13 | E2E: `dm-historical-recovery.spec.ts` seeds 5 gift-wrapped DMs on relay before recipient session starts, opens chat, asserts all 5 render in `created_at` order with no duplicates | `app/tests/e2e/dm-historical-recovery.spec.ts` |

**Trace notes:** AC-07–08 (§3.1 parser integration in ContactChat); AC-09–11 (§3.3 historical fetch + dedup); AC-10 (§3.5 order-of-operations); AC-12–13 (E2E covering §3.1+G1 and §3.3+G3). No ambiguous ACs. AC-12 is partially covered by AC-07/08 but requires an end-to-end relay round-trip to verify the bell pipeline.

---

## §3.2 Bell watcher subscribes to gift wraps (closes G2)

| ID | Description | Test surface |
|----|-------------|--------------|
| AC-14 | `subscribeDirectMessageNotifications` accepts `privateKeyHex: string` as an additional parameter | Unit test — asserts the function signature accepts the parameter (TypeScript compile check or runtime assertion) |
| AC-15 | `subscribeDirectMessageNotifications` opens two subscriptions: `{ kinds: [4], '#p': [ownPubkeyHex] }` and `{ kinds: [1059], '#p': [ownPubkeyHex] }` | Unit test — fake NDK subscribe called twice; asserts both filter objects are present |
| AC-16 | A kind-1059 event whose unwrapped rumor has `kind === 14`, `pubkey !== ownPubkeyHex`, and `created_at * 1000 > lastRead` calls `rememberContact` and `incrementDirectMessage` exactly once per rumor id | Unit test — fake gift-wrap event emitted from NDK subscription; asserts both functions called exactly once |
| AC-17 | A kind-1059 event whose unwrap throws does not call `rememberContact` or `incrementDirectMessage`; no unhandled promise rejection escapes | Unit test — fake malformed gift-wrap event; asserts neither function is called and no exception propagates |
| AC-18 | A kind-1059 event whose unwrapped rumor has `kind !== 14` (kind-7 reaction, kind-444 welcome, kind-21059 join request) does not call `rememberContact` or `incrementDirectMessage` | Unit test — fake non-kind-14 events (kinds 7, 444, 21059) emitted; asserts neither function is called |
| AC-19 | A kind-1059 event re-delivered with a different outer id but the same inner rumor id increments the bell exactly once | Unit test — `seenRumorIds` Set mocked to contain the rumor id; asserts `incrementDirectMessage` called exactly once (not twice) |
| AC-20 | `DirectMessageNotificationsWatcher` passes `privateKeyHex` (via `useNostrIdentity()`) to `subscribeDirectMessageNotifications` | Code inspection + unit test — `DirectMessageNotificationsWatcher` rendered with mocked identity; asserts the prop is forwarded |
| AC-21 | A unit test in `app/tests/unit/directMessageNotifications.test.ts` covers AC-15 through AC-19 against a fake NDK | Test file existence and assertion coverage |
| AC-22 | E2E: `dm-giftwrap-bell.spec.ts` sends a NIP-17 DM from a second browser context; asserts bell badge increments in the recipient context without opening the chat | `app/tests/e2e/dm-giftwrap-bell.spec.ts` |

**Trace notes:** All ACs trace to §3.2. AC-15 is the root implementation requirement (second subscription added). AC-17 is a silent-skip case; the "no unhandled promise rejection" aspect is a runtime guarantee check — no ambiguity. AC-20 is wiring only but justified as needed for S1 seam (§3.2 → §3.1 parseDirectPayload in the handler).

---

## §3.4 Local-store self-heal

| ID | Description | Test surface |
|----|-------------|--------------|
| AC-23 | `loadMessages(threadId)` for `threadId` starting with `'dm:'` runs the self-heal pass exactly once per thread per device; `localStorage` key `lp_dmHealed_v1` records healed thread ids | Unit test — `loadMessages` called twice for the same thread; asserts the heal pass runs only on the first call and the marker is set |
| AC-24 | A row whose `content` matches `/^\s*\{\s*"type"\s*:\s*"(text\|image)"/` is rewritten in place: `content` becomes the decoded text, attachments populated for image; row `id` and `createdAt` unchanged | Unit test in `app/tests/unit/directMessages/selfHeal.test.ts` — mock IDB row seeded with envelope string; asserts `content` is decoded text and id/createdAt are preserved |
| AC-25 | A row whose `id` is not a 64-character lowercase hex string is enqueued for refetch; if a canonical-id replacement is found it replaces the malformed row | Unit test — mock IDB row with temp UUID; asserts malformed row is deleted and replaced when canonical row arrives |
| AC-26 | A row authored by `pubkeyHex` (own messages) with `attachments.full.sha256` but no `attachments.full.url` is removed | Unit test in `app/tests/unit/directMessages/selfHeal.test.ts` — mock orphaned optimistic image authored by self; asserts row is deleted (never a real outbound) |
| AC-27 | The self-heal pass is idempotent: a second `loadMessages` call returns the same result and does not re-write rows | Unit test in `app/tests/unit/directMessages/selfHeal.test.ts` — `loadMessages` called twice; asserts second call returns the same messages without any IDB writes |
| AC-28 | A unit test in `app/tests/unit/directMessages/selfHeal.test.ts` asserts AC-24, AC-26, and AC-27 | Test file existence and assertion coverage |
| AC-29 | E2E: `dm-self-heal.spec.ts` seeds an IDB row with raw JSON envelope content, opens chat, asserts bubble renders decoded text, reloads page, asserts bubble still renders decoded text, inspects IDB and asserts row has `content === '<decoded>'` | `app/tests/e2e/dm-self-heal.spec.ts` |

**Trace notes:** All ACs trace to §3.4. AC-23's per-thread marker is a storage mechanism detail; test coverage confirms the marker gates re-runs. AC-26 and AC-27 are well-specified; no ambiguity. AC-29 is a full round-trip E2E validation with IDB inspection.

---

## §3.6 Decryption-failure observability

| ID | Description | Test surface |
|----|-------------|--------------|
| AC-30 | Each silent-skip site (`parseDirectPayload` lenient fallback, `decryptDirectPayload` throwing, `unwrapAndOpen` throwing, `shouldIngestRumor` returning false) calls the namespaced logger at `info` level with a stable message tag | Unit test — each code path triggered with appropriate failure input; asserts logger receives `info` call with expected tag |
| AC-31 | No silent-skip site calls `console.warn` or `console.error`; unit tests assert the test logger receives `info` calls only | Unit test — spy on `console.warn` and `console.error`; asserts zero calls across all silent-skip paths |

**Trace notes:** Both ACs trace to §3.6. Well-specified; no ambiguity. The "stable message tag" is a naming convention constraint — test surface is the logger call count and tag string, not a specific value.

---

## §3.2 (cross-story, non-functional constraints)

| ID | Description | Test surface |
|----|-------------|--------------|
| AC-32 | No outbound NIP-04 events are published by any code path introduced in this epic; `publishDirectMessage` (NIP-17 gift-wrap only) is not modified | Code inspection + unit test — all publish paths checked; `publishDirectMessage` signature unchanged |
| AC-33 | All user-visible strings introduced by this epic are added to both `en` and `de` blocks of `app/src/lib/i18n.ts` | Code inspection — new strings in i18n.ts have both `en` and `de` entries |

**Trace notes:** AC-32 is a constraint enforced by review; no runtime test surface (zero outbound events is demonstrated by absence). AC-33 is a code-style requirement; verified by inspection since no user-facing strings are expected on the happy path per spec §6.

---

## Validation summary

| Check | Result |
|-------|--------|
| AC IDs well-formed (AC-XX, sequential) | ✅ AC-01–AC-33, all present, no gaps |
| All ACs traceable to §3.x | ✅ Every AC maps to §3.1, §3.2, §3.3, §3.4, §3.5, or §3.6 |
| Ambiguous ACs | ✅ None |
| Missing test hints | ✅ None — all 33 ACs have a named test file or surface |
| Cross-cutting (AC-32, AC-33) | ✅ Both belong to §3.2 constraint row but are listed under "Cross-cutting" for clarity |

**Notable completeness checks:**
- AC-05 relies on an existing test (no new test added); acceptable per spec language.
- AC-12–13 are E2E-only; AC-07–08 are unit-level; the split ensures both real relay round-trips and fast regression coverage.
- AC-29 exercises the full IDB rewrite cycle including post-reload persistence — stronger than unit-level self-heal coverage.
- AC-31 covers the "no warn/error" constraint at the logger level, which also implicitly covers AC-30 (if a skip site called warn/error it would fail AC-31).

---

```
RETROSPECTIVE:
skipped: false
mode: 1_acceptance_criteria
note: "Spec has 33 well-formed ACs across 6 spec sections with complete test-surface coverage; no ambiguous ACs or missing test hints found."
```
