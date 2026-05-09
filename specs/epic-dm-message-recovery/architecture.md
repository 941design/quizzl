# DM Message Recovery — Epic Architecture

## Paradigm

Modular monolith at top level; package-by-feature for module layout.
Hexagonal seams at external boundaries (NDK relay subscriptions, IDB persistence).
No direct imports across module boundaries; cross-module access only through declared seam contracts.

## Module Map

### `app/src/lib/directMessages.ts`
**Purpose**: Core DM logic — encrypt/decrypt, seal/wrap, NIP-59 operations, payload parsing, thread isolation.
**Owned data**: NIP-04/NIP-59 constants, `unwrapAndOpen`, `shouldIngestRumor`, `parseDirectPayload`.
**Exposed**: `encryptDirectPayload`, `decryptDirectPayload`, `publishDirectMessage`, `publishDirectReaction`, `unwrapAndOpen`, `shouldIngestRumor`, `parseDirectPayload`, `GIFT_WRAP_KIND`, `SEAL_KIND`, `CHAT_MESSAGE_KIND`.
**Seam consumers**: `ContactChat.tsx` (live subscription), `directMessageNotifications.ts` (bell watcher), `ContactList.tsx` (contact list).

### `app/src/lib/directMessageNotifications.ts`
**Purpose**: Bell notification pipeline — subscribes to inbound DMs and increments the unread counter.
**Owned data**: `subscribeDirectMessageNotifications` (NDK subscription factory), `seenMessageIds` dedup Set.
**Exposed**: `subscribeDirectMessageNotifications`, `incrementDirectMessage`, `rememberContact`.
**Seam consumers**: `DirectMessageNotificationsWatcher.tsx`.

### `app/src/components/contacts/ContactChat.tsx`
**Purpose**: Per-contact DM thread view — loads messages, subscribes to live events, ingests gift wraps.
**Owned data**: `init` (kind-4 + kind-1059 fetch + subscribe), `ingestEvent`, `handleGiftWrapEvent`.
**Seam consumers**: `pages/contacts.tsx`.

### `app/src/components/DirectMessageNotificationsWatcher.tsx`
**Purpose**: Root-level component that mounts the bell subscription.
**Owned data**: `DirectMessageNotificationsWatcher` (React component), `initDirectMessageCounts`.
**Seam consumers**: App root.

### `app/src/context/unreadStore.ts`
**Purpose**: Unread count state management.
**Owned data**: `counts`, `joinRequests`, `directMessages`, `lastReadDM` localStorage key.
**Exposed**: `markDirectMessagesRead`, `getDirectMessageLastReadAt`.

### `app/src/lib/media/blossomClient.ts`
**Purpose**: Image upload/retrieval for DM attachments.
**Seam**: Consumed by DM send path.

---

## Boundary Rules

1. `directMessageNotifications.ts` imports from `directMessages.ts` only for `unwrapAndOpen`. No circular deps.
2. `ContactChat.tsx` imports from both `directMessages.ts` and `directMessageNotifications.ts` but only calls `markDirectMessagesRead` from the latter.
3. IDB operations are centralized in `app/src/lib/storage/index.ts` and its sub-modules. No direct `idb-keyval` calls outside storage layer.
4. NDK subscriptions are created by `directMessageNotifications.ts` and `ContactChat.tsx` only. No subscription in the storage layer.

---

## Seams (cross-story dependencies)

| Seam | From | To | Nature |
|------|------|----|--------|
| S1 | §3.1 parseDirectPayload | §3.2 bell handler | Bell handler's gift-wrap branch calls parseDirectPayload |
| S2 | §3.1 parseDirectPayload | §3.3 ContactChat ingest | ContactChat.ingestEvent calls parseDirectPayload |
| S3 | §3.3 ContactChat.init | §3.4 loadMessages | Self-heal pass runs inside loadMessages before returning |
| S4 | §3.2 subscribeDirectMessageNotifications | §3.6 logger | All silent-skip sites use the namespaced logger |

---

## Implementation Constraints

### From spec
- **Lenient parser**: `parseDirectPayload` never returns `null` for non-empty strings (AC-01–04).
- **No outbound NIP-04**: `publishDirectMessage` stays NIP-17 only.
- **Dedup keys**: kind-4 → event id; kind-1059 → inner rumor id.
- **Self-heal scope**: DM threads only (`threadId.startsWith('dm:')`).
- **Healed marker**: `localStorage` key `lp_dmHealed_v1` per thread.
- **Historical fetch limit**: kind-1059 → 500.
- **Logging policy**: info-level for all silent-skip sites; no warn/error.

### From codebase
- NDK subscriptions use `ndk.subscribe()` with filter objects.
- IDB operations are through `get<ChatMessage[]>`, `appendMessage`, `upsertMessages` in storage layer.
- Bell state is in `unreadStore.ts` with localStorage persistence.
- React components use hooks; no class components.
- Translations in `app/src/lib/i18n.ts` for both `en` and `de`.

### From tests
- Unit tests: Vitest, dynamic import after vi.mock, Map-backed idb-keyval mock.
- E2E: Playwright with deterministic pre-computed keypairs, injectIdentity helper, clearAppState.
- Test keypairs (same seeds used across unit and e2e):
  - alice: `bceef655a4c4f3b3b6f6f7d3c8e2a1b4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0` (npub1qqqq...)
  - bob: `cbecda1c5d5e4c4c5f7f8e4d9f3b2c6e7f8b0c1d2e3f4a5b6c7d8e9f0a1b2` (npub1qqqq...)

---

## Story Dependencies

```
Story 01 (Lenient parser) ──┐
                            ├── No cross-story blocking
Story 02 (Bell gift-wrap)  ──┤
                            │
Story 03 (Historical fetch)  ┘
                            │
Story 04 (Self-heal) ─────────┘ (depends on §3.1 parser being lenient)

Story 05 (E2E hardening) ──────┴─ depends on all of 01-04
```