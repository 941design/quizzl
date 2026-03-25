# Acceptance Criteria — Relay Backup (NIP-78)

## AC-1: Backup Payload Assembly
- `collectBackupPayload()` returns a `BackupPayload` object with `version: 1` and `createdAt` set to current Unix seconds.
- All 6 localStorage fields (`settings`, `userProfile`, `selectedTopics`, `progress`, `studyTimes`, `scoreSyncSeq`) are read from their `lp_*` keys and included in the payload; null values are preserved as-is.
- For each group in `loadAllGroups()`, the payload includes: group metadata in `groups[]`, base64-encoded MLS state in `groupStates[groupId]`, member scores in `memberScores["group:{groupId}"]`, member profiles in `memberProfiles["group:{groupId}"]`, and last 10 chat messages in `chatMessages[groupId]`.
- MLS `SerializedClientState` (Uint8Array) is base64-encoded via `btoa(String.fromCharCode(...bytes))` for JSON serialization.

## AC-2: NIP-44 Encrypt-to-Self and Event Construction
- `createBackupEvent(payload, signer, pubkeyHex)` produces a kind 30078 Nostr event with `tags: [["d", "quizzl"]]`, `content` set to `signer.nip44.encrypt(pubkeyHex, JSON.stringify(payload))`, and the event is signed via `signer.signEvent()`.

## AC-3: Publish to Relays
- `publishBackup(signer, pubkeyHex)` publishes the backup event to relays from the kind 30051 relay list, falling back to `DEFAULT_RELAYS`.
- If at least one relay accepts, the function resolves successfully (no UI indication).
- If all relays reject, the function returns a failure indicator that callers can use to show a non-blocking toast.

## AC-4: Fetch and Decrypt Backup
- `fetchBackup(signer, pubkeyHex, relays)` fetches kind 30078 events with filter `{ kinds: [30078], authors: [pubkeyHex], '#d': ['quizzl'] }`, takes the most recent by `created_at`, decrypts via `signer.nip44.decrypt(pubkeyHex, content)`, and returns the parsed `BackupPayload`.
- If `version > 1`, the function throws an error with message indicating a newer version.
- If no backup event exists, the function returns `null`.

## AC-5: Restore (Rehydrate) from Backup
- `restoreFromBackup(payload)` clears all existing localStorage keys (via `STORAGE_KEYS`) and IDB stores, then rehydrates: each non-null localStorage field is written to its `lp_*` key; each group is saved via `saveGroup()`; each MLS state is base64-decoded and written via `IdbGroupStateBackend.setItem()`; member scores/profiles are written via `saveMemberScores()`/`saveMemberProfiles()`; chat messages are written via idb-keyval `set()`.
- After restore, `lp_nostrIdentityBackedUp_v1` is set to `'true'`.

## AC-6: Debounced Backup Trigger
- `BackupScheduler` exposes `markDirty(immediate?: boolean)` that schedules a backup publish.
- At most one publish occurs per 5-minute window. Immediate triggers queue and flush at the next debounce window opening.
- When dirty and debounce window opens, `publishBackup()` is called automatically.

## AC-7: Context Integration — Trigger on Group and Profile Events
- `MarmotContext` calls `backupScheduler.markDirty(true)` (immediate) after: group created, group joined (Welcome), group left, member invited.
- `ProfileContext` calls `backupScheduler.markDirty(true)` after profile save.
- A `visibilitychange` listener calls `markDirty(true)` when page becomes hidden.
- Quiz completion / settings change / study session call `markDirty(false)` (deferred).

## AC-8: Restore UI Flow
- During mnemonic restore, after identity is derived, the app fetches the backup from relays.
- If a backup exists, the user is warned that restore replaces all current data and must confirm.
- On confirm, `restoreFromBackup()` runs and the app reloads to reinitialize contexts.
- If no backup exists, restore proceeds as before (identity-only recovery).
