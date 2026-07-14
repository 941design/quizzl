/**
 * Chat message persistence layer — idb-keyval implementation.
 *
 * Messages are stored per-group under the key `few:messages:{groupId}`
 * in the default idb-keyval store.
 */

import { get, set, del, keys, delMany } from 'idb-keyval';
import { parseDirectPayload, directConversationId } from '@/src/lib/directMessages';
import type { RoledAttachments } from '@/src/lib/media/imageMessage';
import * as walledGarden from '@/src/lib/walledGarden';
import { clearDirectMessageContact } from '@/src/lib/unreadStore';

/** MLS application-message kind discriminator for chat messages. */
export const CHAT_MESSAGE_KIND = 9;

export interface ChatMessage {
  id: string;
  content: string;
  senderPubkey: string;
  groupId: string;
  /** Unix milliseconds */
  createdAt: number;
  /**
   * Image-message attachments parsed from the rumor's `imeta` tags, keyed by
   * the `role` field. Storing the role here keeps full vs thumb selection
   * deterministic — the bubble must not re-derive it from filename or index.
   */
  attachments?: RoledAttachments;
  localMediaRefs?: string[];
  /**
   * True once this slot has been deleted (edit/delete epic). The row is
   * retained physically (never physically purged — AC-DEL-5); render paths
   * must filter it out via `filterVisibleMessages`. Applies identically to
   * text and image-shaped rows (AC-IMG-1).
   */
  tombstoned?: boolean;
  /** True once this slot's content has been replaced by an edit. */
  edited?: boolean;
  /**
   * The revision clock (Unix seconds) of the most recent delete/edit signal
   * applied to this slot. Absent/0 means the row still reflects the original
   * message rumor — no edit/delete signal has been applied yet. See
   * `MessagePatch` for how this is used by the AC-STORE-3 clobber-guard.
   */
  rev?: number;
}

function storageKey(groupId: string): string {
  return `few:messages:${groupId}`;
}

// ─── Self-heal pass (story-04, §3.4) ────────────────────────────────────────

/** localStorage key for the per-thread healed marker */
const HEALED_MARKER_KEY = 'lp_dmHealed_v1';

/**
 * Returns the set of thread ids that have already been self-healed.
 * Safe: falls back to [] if the key is absent or corrupt.
 */
function getHealedThreads(): string[] {
  try {
    const raw = localStorage.getItem(HEALED_MARKER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw as string);
    if (!Array.isArray(parsed)) return [];
    return parsed as string[];
  } catch {
    return [];
  }
}

/** Writes the healed marker, appending threadId to the existing set. */
function markHealed(threadId: string): void {
  try {
    const existing = getHealedThreads();
    if (!existing.includes(threadId)) {
      localStorage.setItem(HEALED_MARKER_KEY, JSON.stringify([...existing, threadId]));
    }
  } catch {
    // localStorage unavailable (SSR, private browsing, quota) — skip silently.
    // The self-heal pass still runs; only the marker is unavailable.
  }
}

/**
 * Self-heal pass: detect and correct malformed rows in a DM-thread message array.
 *
 * Returns a result object so the caller can decide whether to persist:
 *   - If needsRewrite: the caller must write healedMessages back to IDB.
 *   - If refetchIds is non-empty: the caller should enqueue those ids for relay refetch.
 *
 * Case 1 — envelope-in-content:
 *   content matches /^\s*\{\s*"type"\s*:\s*"(text|image)"/
 *   → re-parse via parseDirectPayload, upgrade content in place.
 *   → attachments populated for image envelopes.
 *   → id and createdAt unchanged.
 *
 * Case 2 — non-canonical id:
 *   id is not a 64-character lowercase hex string
 *   → enqueued for refetch (returned as refetchIds).
 *   → caller coordinates relay refetch + row replacement.
 *
 * Case 3 — orphaned optimistic image (self-authored):
 *   attachments.full?.sha256 present but attachments.full?.url missing
 *   AND senderPubkey === ownPubkeyHex
 *   → row deleted (optimistic image that never uploaded).
 *   → peer-authored orphaned images go to Case 2.
 */
export function selfHealMessages(
  threadId: string,
  messages: ChatMessage[],
  ownPubkeyHex: string,
): {
  messages: ChatMessage[];
  needsRewrite: boolean;
  /** Ids of rows with non-canonical ids — caller enqueues for refetch */
  refetchIds: string[];
} {
  const refetchIds: string[] = [];
  let needsRewrite = false;

  const canonicalIdPattern = /^[0-9a-f]{64}$/;
  const envelopePattern = /^\s*\{\s*"type"\s*:\s*"(text|image)"/;

  const healed = messages.map((msg): ChatMessage => {
    // ── Case 3: orphaned optimistic image (self-authored only) ───────────
    // A self-authored image row where attachments.full has sha256 but url is
    // missing means the Blossom upload never completed. Drop it silently.
    const fullAttachment = msg.attachments?.full;
    const hasSha256 = fullAttachment != null && 'sha256' in fullAttachment;
    const urlInAttachment =
      fullAttachment != null && 'url' in fullAttachment ? (fullAttachment as { url?: string }).url : undefined;
    const urlIsMissing = urlInAttachment == null;
    const isOrphanedSelfImage =
      hasSha256 && urlIsMissing && msg.senderPubkey.toLowerCase() === ownPubkeyHex.toLowerCase();

    if (isOrphanedSelfImage) {
      needsRewrite = true;
      return null as unknown as ChatMessage;
    }

    // ── Case 1: envelope-in-content (safe rewrite only) ─────────────────
    // Rewrite content when the decoded text differs from the envelope string.
    // We NEVER rewrite for rows where the sha256 reference would be lost:
    //   (a) isOrphanedSelfImage → already handled above (row dropped).
    //   (b) peer-authored orphaned images: isOrphanedSelfImage is false
    //       but envelopePattern would match, so we need an explicit guard.
    // An attachment upgrade (injecting from envelope when original had none)
    // is safe only when the original row had no attachments at all, and only
    // for text envelopes (no sha256 risk). For image envelopes, the attachment
    // upgrade carries the sha256 and is always safe.
    const isOrphanedPeerImage =
      hasSha256 && urlIsMissing && msg.senderPubkey.toLowerCase() !== ownPubkeyHex.toLowerCase();

    if (envelopePattern.test(msg.content)) {
      const parsed = parseDirectPayload(msg.content);
      if (parsed) {
        const contentDiffers = parsed.content !== msg.content;
        // Only upgrade attachments when the original had no attachments object at
        // all (not just no full attachment) and we have a complete one to inject.
        const originalHasNoAttachments = msg.attachments == null;
        const needsAttachmentUpgrade =
          originalHasNoAttachments && parsed.attachments != null;
        if (contentDiffers || needsAttachmentUpgrade) {
          // For orphaned peer images: skip the content rewrite (would lose the
          // sha256 reference). Pass through unchanged; Case 2 handles the id.
          if (!isOrphanedPeerImage) {
            needsRewrite = true;
            msg = {
              ...msg,
              content: parsed.content,
              attachments: needsAttachmentUpgrade ? parsed.attachments : msg.attachments,
            };
          }
        }
        // If neither content differs nor upgrade needed, pass through unchanged.
      }
    }

    // ── Case 2: non-canonical id ──────────────────────────────────────────
    if (!canonicalIdPattern.test(msg.id)) {
      refetchIds.push(msg.id);
    }

    return msg;
  });

  // Remove null entries (rows dropped by Case 3)
  const filtered = healed.filter((msg): msg is ChatMessage => msg !== null);

  return { messages: filtered, needsRewrite, refetchIds };
}

// Per-key append serialization: each key has a pending promise chain so
// concurrent writes (append/update/tombstone/remove/self-heal) never race
// and lose or revert each other's changes. Declared here (ahead of
// `loadMessages`) so the self-heal rewrite below can enqueue on it too —
// see `enqueueSelfHealRewrite`.
const appendQueues = new Map<string, Promise<void>>();

/**
 * Runs the self-heal rewrite for `threadId` inside the shared per-thread
 * `appendQueues` slot for `key`, re-reading and re-healing against the
 * *freshest* stored state at write time rather than reusing the snapshot
 * read at the top of `loadMessages`.
 *
 * This closes a race with the edit/delete storage foundation (S1): the
 * previous implementation called `set()` directly from `loadMessages`,
 * bypassing `appendQueues` entirely (the only unqueued write in this
 * module). A concurrent `updateMessageInPlace`/`tombstoneMessage` write
 * (e.g. an inbound delete or edit landing between `loadMessages`' initial
 * read and the old direct `set()`) would be silently reverted by that
 * stale-snapshot write. Re-reading and re-healing inside the queue turn
 * means the write always reflects the latest persisted state; because
 * `selfHealMessages` only ever rewrites envelope/attachment fields on rows
 * it recognizes as malformed and passes every other field through
 * unchanged via object spread, any `tombstoned`/`edited`/`rev` flags
 * present on the freshest read survive the re-heal automatically.
 */
function enqueueSelfHealRewrite(
  key: string,
  threadId: string,
  ownPubkeyHex: string,
): Promise<void> {
  const prev = appendQueues.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    const freshest = (await get<ChatMessage[]>(key)) ?? [];
    const { messages: reHealed, needsRewrite: stillNeedsRewrite } = selfHealMessages(
      threadId,
      freshest,
      ownPubkeyHex,
    );
    if (stillNeedsRewrite) {
      await set(key, reHealed);
    }
  });
  const settled = next.catch(() => {});
  appendQueues.set(key, settled);
  settled.then(() => {
    if (appendQueues.get(key) === settled) appendQueues.delete(key);
  });
  return next;
}

/**
 * Load all persisted messages for a group, running the self-heal pass on
 * first access of each DM thread.
 *
 * For DM threads (threadId.startsWith('dm:')) the self-heal pass:
 *   - Detects envelope-in-content rows and upgrades them in place.
 *   - Detects non-canonical ids and returns them as refetchIds for the caller.
 *   - Drops orphaned optimistic images authored by the local user.
 *   - Runs once per thread per device (per-thread healed marker).
 *
 * For group threads: behaves as before (direct read from IDB).
 *
 * @returns messages — the (possibly healed) message array.
 * @returns refetchIds — DM threads only; ids of rows with non-canonical ids.
 */
export async function loadMessages(
  groupId: string,
): Promise<{ messages: ChatMessage[]; refetchIds: string[] }> {
  const stored = await get<ChatMessage[]>(storageKey(groupId));
  const messages = stored ?? [];

  // Group threads: no self-heal
  if (!groupId.startsWith('dm:')) {
    return { messages, refetchIds: [] };
  }

  // DM thread: check healed marker
  const healed = getHealedThreads();
  if (healed.includes(groupId)) {
    return { messages, refetchIds: [] };
  }

  // Self-heal pass requires the local pubkey.
  // Read from localStorage (synchronous; the identity is hydrated before first chat open).
  // Fall back to '' if not yet hydrated — the pass will still run but Case 3
  // (orphaned optimistic image) won't fire for self-authored rows.
  let ownPubkeyHex = '';
  try {
    const identityRaw = localStorage.getItem('lp_nostrIdentity_v1');
    if (identityRaw) {
      const identity = JSON.parse(identityRaw);
      ownPubkeyHex = identity.pubkeyHex ?? '';
    }
  } catch {
    // Ignore: identity not yet hydrated or corrupt.
  }

  const { messages: healedMessages, needsRewrite, refetchIds } =
    selfHealMessages(groupId, messages, ownPubkeyHex);

  if (needsRewrite) {
    // Routed through the shared appendQueues slot (never a direct `set()`)
    // and re-healed against the freshest state at write time — see
    // `enqueueSelfHealRewrite` for why this matters now that concurrent
    // tombstone/edit writes exist.
    await enqueueSelfHealRewrite(storageKey(groupId), groupId, ownPubkeyHex);
    markHealed(groupId);
    // Re-read: the queued rewrite may have healed a newer snapshot than
    // `healedMessages` above (computed from the pre-queue read), so return
    // exactly what's now persisted rather than the possibly-stale value.
    const finalStored = (await get<ChatMessage[]>(storageKey(groupId))) ?? [];
    return { messages: finalStored, refetchIds };
  }

  // Always mark healed even when no rows needed correction — idempotent.
  markHealed(groupId);
  return { messages: healedMessages, refetchIds };
}

/**
 * Append a single message to the group's persisted log. Deduplicates by id
 * (insert-if-absent; never overwrites an existing row). This is the
 * AC-STORE-3 substrate for the append path: because a re-delivered original
 * message rumor carries the same id as any already-stored row, the
 * dedup-by-id no-op below structurally prevents it from clobbering an
 * already edited/tombstoned row. See `updateMessageInPlace` for the
 * explicit rev-based clobber-guard that protects the update-in-place path.
 */
export function appendMessage(groupId: string, message: ChatMessage): Promise<void> {
  const key = storageKey(groupId);
  const prev = appendQueues.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    const existing = (await get<ChatMessage[]>(key)) ?? [];
    if (existing.some((m) => m.id === message.id)) return;
    await set(key, [...existing, message]);
    // Dev-only hook: notify E2E tests when a message is written to IDB.
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
      (window as any).__fewTest?.onChatIdbWrite?.({ groupId, messageId: message.id });
    }
  });
  const settled = next.catch(() => {});
  appendQueues.set(key, settled);
  settled.then(() => {
    if (appendQueues.get(key) === settled) appendQueues.delete(key);
  });
  return next;
}

// ─── Edit/delete storage foundation (epic-feature-request-message-edit-and-delete, S1) ──

/**
 * Strips `undefined`-valued keys from a shallow object, returning a new
 * object containing only the keys whose value is not `undefined`. Used to
 * sanitize a `MessagePatch` before merging it onto a stored row, so an
 * explicit `{content: undefined}` (or an internally rev-stripped patch —
 * see `updateMessageInPlace`) can never null out a field on merge.
 */
function stripUndefinedValues<T extends object>(obj: T): T {
  const out = {} as T;
  (Object.keys(obj) as (keyof T)[]).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

/**
 * Patch fields accepted by `updateMessageInPlace`. This is the
 * storage-update-in-place seam contract handed to the reconciliation core
 * (S3, `app/src/lib/messageEdits/api.ts`). All fields are optional — only
 * the fields present in the patch (after `undefined`-stripping) are merged
 * into the existing row; omitted fields are left unchanged.
 *
 * Flags are merge-only, never implicitly cleared: un-tombstoning or
 * un-editing a slot requires the patch to carry the field explicitly
 * (`tombstoned: false` / `edited: false`, per spec §2.5's un-tombstone
 * rule) — a later patch that only sets `content`/`rev` leaves an existing
 * `tombstoned:true` / `edited:true` row exactly as flagged.
 *
 * `rev` is the revision clock: a real edit or delete signal always carries
 * `rev >= 1` (Unix seconds — see spec §2.4/§2.5). `rev` that is absent,
 * `0`, negative, or non-finite is treated as "not a real signal" — exactly
 * the condition the AC-STORE-3 clobber-guard in `updateMessageInPlace`
 * checks for — and is never persisted onto the stored row (a malformed
 * `rev` is stripped from the patch rather than corrupting the revision
 * clock).
 *
 * Division of responsibility with S3 (reconciliation core) for rev
 * ordering: storage provides an atomic **strictly-older-rev floor** — a
 * write whose rev is strictly less than the stored row's rev is always
 * rejected, closing the read-modify-write TOCTOU a caller would otherwise
 * have across two queue turns. Storage does NOT resolve **equal-rev
 * ties**: a write whose rev equals the stored rev always passes the floor,
 * and S3 alone decides (delete-wins; else higher replacement-id wins)
 * which patch to construct and send for that case.
 */
export interface MessagePatch {
  tombstoned?: boolean;
  edited?: boolean;
  rev?: number;
  content?: string;
}

/**
 * Update an existing row's fields in place, WITHOUT re-inserting the row or
 * changing its position in the stored per-thread array (AC-EDIT-2). No-ops
 * if `id` is not present — there is nothing to update.
 *
 * Two ordered guards run inside the queue turn before the merge:
 *
 * 1. **AC-STORE-3 clobber-guard.** A write is a "real signal" only when
 *    `typeof patch.rev === 'number' && Number.isFinite(patch.rev) &&
 *    patch.rev >= 1`. Any non-real-signal write — rev absent, `0`,
 *    negative, NaN, or a non-number that slipped past the `MessagePatch`
 *    type at runtime (e.g. a wire `["rev","<sec>"]` tag parsed to a
 *    string) — is rejected (no-op) against a row already flagged
 *    `tombstoned` or `edited`. This covers both a re-delivered *original*
 *    message rumor (no rev) and a malformed wire `rev`.
 * 2. **Monotonic-rev floor.** A write whose (sanitized) rev is strictly
 *    less than the stored row's `rev ?? 0` is rejected (no-op),
 *    regardless of the row's tombstoned/edited flags. This closes the
 *    read-modify-write race a caller would otherwise have to defend
 *    against across two queue turns (see `MessagePatch`). **Equal revs
 *    always pass this floor** — storage does not resolve equal-rev ties;
 *    that stays S3's responsibility.
 *
 * A malformed rev (non-finite or negative) is never persisted: it is
 * stripped from the patch before the merge, exactly as if it had been
 * omitted, rather than corrupting the row's revision clock. `undefined`-
 * valued keys (including a stripped rev) are removed from the patch before
 * the `{...target, ...patch}` merge, so no field is ever nulled out by
 * omission.
 *
 * Serialised on the same per-thread `appendQueues` key
 * (`storageKey(groupId)`) as `appendMessage` / `removeMessages`, so
 * concurrent writes to a thread never race.
 */
export function updateMessageInPlace(
  groupId: string,
  id: string,
  patch: MessagePatch,
): Promise<void> {
  const key = storageKey(groupId);
  const prev = appendQueues.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    const existing = (await get<ChatMessage[]>(key)) ?? [];
    const index = existing.findIndex((m) => m.id === id);
    if (index === -1) return; // nothing to update

    const target = existing[index];

    // Sanitize the incoming rev: well-formed means a finite number >= 0.
    // Anything else (NaN, negative, non-number) is treated as "no signal"
    // (incomingRev = 0) for both guards below, and is never persisted.
    const rawRev = patch.rev;
    const revIsWellFormed =
      typeof rawRev === 'number' && Number.isFinite(rawRev) && rawRev >= 0;
    const incomingRev = revIsWellFormed ? (rawRev as number) : 0;
    const isRealSignal = incomingRev >= 1;

    // Guard 1 — AC-STORE-3 clobber-guard: a non-real-signal write must not
    // clobber an already edited/tombstoned slot.
    if (!isRealSignal && (target.tombstoned === true || target.edited === true)) {
      return;
    }

    // Guard 2 — monotonic-rev floor: a write can never regress a slot's
    // rev clock. Equal revs pass through; S3 owns equal-rev tie
    // resolution (see `MessagePatch`).
    const storedRev = target.rev ?? 0;
    if (incomingRev < storedRev) {
      return;
    }

    // Never persist a malformed rev; strip it so the merge below leaves
    // the stored rev untouched instead of writing NaN/negative to storage.
    const sanitizedPatch: MessagePatch = revIsWellFormed ? patch : { ...patch, rev: undefined };
    const cleanPatch = stripUndefinedValues(sanitizedPatch);

    const updatedRow: ChatMessage = { ...target, ...cleanPatch };
    const updatedRows = existing.slice();
    updatedRows[index] = updatedRow;
    await set(key, updatedRows);
  });
  const settled = next.catch(() => {});
  appendQueues.set(key, settled);
  settled.then(() => {
    if (appendQueues.get(key) === settled) appendQueues.delete(key);
  });
  return next;
}

/**
 * Tombstone a message row: flips `tombstoned:true` and stores `rev`, while
 * retaining the row physically in storage (AC-DEL-5) — re-delivery of the
 * original rumor for this id must not resurrect it. Never calls
 * `removeMessages`: that path is reserved for the ADR-001/002 purge /
 * self-heal path only, never for user-initiated delete.
 *
 * `rev` must be a real signal — finite and `>= 1`, matching the
 * `isRealSignal` predicate in `updateMessageInPlace` — or the call is
 * rejected (no-op) rather than persisting a tombstone whose rev is
 * trivially overridable by a later rev=0/absent write, or that would
 * corrupt the revision clock with a non-finite/negative value.
 *
 * Applies identically to text and image-shaped rows (AC-IMG-1) — there is
 * no attachment-specific branch; the same `updateMessageInPlace` call path
 * flips the flag regardless of the row's shape.
 */
export function tombstoneMessage(groupId: string, id: string, rev: number): Promise<void> {
  if (typeof rev !== 'number' || !Number.isFinite(rev) || rev < 1) {
    return Promise.resolve();
  }
  return updateMessageInPlace(groupId, id, { tombstoned: true, rev });
}

/**
 * Pure filter mirroring the reactions module's `!r.removed` pattern in
 * `aggregateForMessage` (`app/src/lib/reactions/api.ts`): strips
 * tombstoned rows out of a message array.
 *
 * `loadMessages` itself stays raw/unfiltered (mirroring `loadReactions`'s
 * raw-read precedent) because non-render consumers need the full row set,
 * including tombstoned rows — e.g. `relayBackup.ts`, `reactionHandler.ts`'s
 * known-target existence check, and the reconciliation core's future slot
 * resolution / idempotency checks (AC-STORE-2). Storage read paths that
 * render a thread (message list, list preview) apply this filter to the
 * result of `loadMessages` before rendering.
 */
export function filterVisibleMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !m.tombstoned);
}

/**
 * Remove specific messages from a group's persisted log by id.
 * No-ops for ids that aren't present. Serialised on the same per-key queue as
 * appendMessage so a remove cannot race a concurrent append on the same key.
 */
export function removeMessages(groupId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  const key = storageKey(groupId);
  const dropSet = new Set(ids);
  const prev = appendQueues.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    const existing = (await get<ChatMessage[]>(key)) ?? [];
    const filtered = existing.filter((m) => !dropSet.has(m.id));
    if (filtered.length === existing.length) return;
    await set(key, filtered);
  });
  const settled = next.catch(() => {});
  appendQueues.set(key, settled);
  settled.then(() => {
    if (appendQueues.get(key) === settled) appendQueues.delete(key);
  });
  return next;
}

/** Remove all persisted messages for a group (e.g. on group leave). */
export function clearMessages(groupId: string): Promise<void> {
  const key = storageKey(groupId);
  const prev = appendQueues.get(key) ?? Promise.resolve();
  const next = prev.then(() => del(key));
  const settled = next.then(
    () => { appendQueues.delete(key); },
    () => { appendQueues.delete(key); },
  );
  appendQueues.set(key, settled);
  // Edit/delete epic hygiene (S3 round-2 remediation finding 5): prune
  // messageEdits/api.ts's own pending-signal / delete-marker / slot-meta aux
  // state for this thread too, so it doesn't outlive the ChatMessage rows it
  // refers to. Dynamic import to avoid a circular import — messageEdits/
  // api.ts imports THIS module — mirroring storage.ts's existing
  // dynamic-import wiring for the same module (clearAccountScopedIdbData).
  // Failure here must not block the group-leave purge; logged and swallowed.
  const auxCleanup = import('@/src/lib/messageEdits/api')
    .then(({ clearMessageEditsStateForThread }) => clearMessageEditsStateForThread(groupId))
    .catch((err) => {
      console.warn('[chatPersistence] clearMessages: messageEdits aux cleanup failed', err);
    });
  return Promise.all([next, auxCleanup]).then(() => undefined);
}

// ─── Single-peer history wipe on block (epic-block-contact, S3) ────────────

/**
 * Result of {@link wipeSinglePeerHistory} — lets the caller (S4's block
 * action) observe partial success under a simulated storage-quota failure
 * without either half of the wipe throwing. `true` means that call
 * completed without throwing; `false` means it threw and the error was
 * logged + swallowed (AC-WIPE-5).
 */
export interface HistoryWipeResult {
  /** True iff `clearMessages(directConversationId(peerPubkeyHex))` completed without throwing. */
  threadCleared: boolean;
  /** True iff `clearDirectMessageContact(peerPubkeyHex)` completed without throwing. */
  countersCleared: boolean;
  /**
   * True iff `reactions/api.ts#clearDmReactionsForPeer(peerPubkeyHex)`
   * completed without throwing (gate-remediation finding 4). The DM reaction
   * aggregate (`few:reactions:dm:<peerHex>`) is a distinct idb-keyval
   * namespace from the thread record above — a full wipe requires deleting
   * it too, or a blocked peer's emoji/message-id/reactor-pubkey rows survive
   * the block. `clearDmReactionsForPeer` itself is case-insensitive by
   * enumeration (it does not assume the row was written under a lowercase
   * key), so this flag does not depend on the case of the stored contact
   * pubkeyHex.
   */
  reactionsCleared: boolean;
}

/**
 * Wipes a single peer's DM history on block (DD-12). Exactly three calls, in
 * this order:
 *
 *   1. `clearMessages(directConversationId(peerPubkeyHex))` — deletes the
 *      idb-keyval thread record (AC-WIPE-1). This already drains any
 *      in-flight `appendMessage` write for the thread and clears edit/delete
 *      aux state (`clearMessageEditsStateForThread`) internally.
 *   2. `clearDirectMessageContact(peerPubkeyHex)` — clears the unread
 *      counter and last-read timestamp (AC-WIPE-2).
 *   3. `reactions/api.ts#clearDmReactionsForPeer(peerPubkeyHex)` — deletes
 *      the DM reaction aggregate (gate-remediation finding 4; DD-3 "permanently
 *      deletes the locally stored DM history" covers reactions too, not just
 *      messages/thread/unread state). Dynamic import mirrors this module's
 *      existing `clearMessages` aux-cleanup wiring (messageEdits) and
 *      `storage.ts`'s `clearAllReactions` call — never a static import, so a
 *      caller that never touches reactions doesn't eagerly load that module.
 *
 * The storage key for steps 1/2 is derived exclusively via
 * `directConversationId` — never a hand-built `dm:<peer>` string literal
 * (AC-WIPE-4). Step 3 does not derive a single key at all: since the
 * reaction WRITE path doesn't normalize case, `clearDmReactionsForPeer`
 * enumerates and case-insensitively matches every `few:reactions:dm:` key
 * itself — see that function's doc comment.
 *
 * Each call is independently try/caught: a thrown/rejected error from any of
 * the three calls is logged via `console.warn` and swallowed, never
 * propagated to the caller (AC-WIPE-5) — mirrors the existing aux-cleanup
 * try/catch convention in `clearMessages`/`purgeStrangerDmThreads`. This
 * function never throws, so a storage-quota failure here can never prevent
 * the block action from setting `archivedAt` or taking filtering effect.
 *
 * Does not read or write `lp_contacts_v1` / `archivedAt` — contact
 * retention (AC-WIPE-3) is the caller's concern via `archiveContact`,
 * called by S4 before this helper.
 */
export async function wipeSinglePeerHistory(peerPubkeyHex: string): Promise<HistoryWipeResult> {
  const threadId = directConversationId(peerPubkeyHex);

  let threadCleared = false;
  try {
    await clearMessages(threadId);
    threadCleared = true;
  } catch (err) {
    console.warn('[chatPersistence] wipeSinglePeerHistory: clearMessages failed', err);
  }

  let countersCleared = false;
  try {
    clearDirectMessageContact(peerPubkeyHex);
    countersCleared = true;
  } catch (err) {
    console.warn('[chatPersistence] wipeSinglePeerHistory: clearDirectMessageContact failed', err);
  }

  let reactionsCleared = false;
  try {
    const { clearDmReactionsForPeer } = await import('@/src/lib/reactions/api');
    // `clearDmReactionsForPeer` is case-insensitive by enumeration (it does
    // NOT assume reaction rows were written under a lowercase key — the
    // reaction WRITE path doesn't normalize case, and AC-CORE-6 explicitly
    // does not guarantee a stored contact pubkeyHex is lowercase). The
    // `.toLowerCase()` here is not load-bearing for correctness — it just
    // matches this function's own AC-WIPE-4 normalization discipline above
    // — but is kept so a caller can rely on this call site's input shape
    // being consistent with the other two calls in this function.
    await clearDmReactionsForPeer(peerPubkeyHex.toLowerCase());
    reactionsCleared = true;
  } catch (err) {
    console.warn('[chatPersistence] wipeSinglePeerHistory: clearDmReactionsForPeer failed', err);
  }

  return { threadCleared, countersCleared, reactionsCleared };
}

/**
 * Remove every persisted chat message across all groups. Used by
 * resetAllData / backup-restore so messages from the previous identity do
 * not survive on the device. Drains the in-memory append queue first to
 * avoid racing a delete against a concurrent append.
 */
export async function clearAllMessages(): Promise<void> {
  const inflight = Array.from(appendQueues.values());
  await Promise.allSettled(inflight);
  appendQueues.clear();
  const allKeys = await keys();
  const messageKeys = allKeys.filter(
    (k): k is string => typeof k === 'string' && k.startsWith('few:messages:'),
  );
  if (messageKeys.length > 0) {
    await delMany(messageKeys);
  }
}

/**
 * Purges IDB DM thread keys belonging to stranger peers.
 *
 * Enumerates all keys matching `few:messages:dm:<peerHex>`, calls
 * `isAllowedDmSender` on each `<peerHex>`, and `del()`s the key when the
 * peer is a stranger.  Keys that carry the `few:messages:` prefix but
 * lack the `dm:` discriminator (e.g. `few:messages:<groupId>`) are
 * NEVER touched (AC-PURGE-3, VQ-S3-013).
 *
 * AC-PERF-1: logs a warning when sweep exceeds 500 ms; throws when it
 * exceeds 2 000 ms.
 *
 * @returns `{ deleted: number }` — number of IDB DM thread keys deleted
 *   (AC-OBS-5).
 */
export async function purgeStrangerDmThreads(
  getWhitelist: () => walledGarden.WhitelistArgs,
): Promise<{ deleted: number }> {
  const { isAllowedDmSender } = walledGarden;
  const start = performance.now();

  const allKeys = await keys();
  const dmPrefix = 'few:messages:dm:';
  const dmKeys = allKeys.filter(
    (k): k is string => typeof k === 'string' && k.startsWith(dmPrefix),
  );

  const { groups, knownPeers, ownPubkeyHex } = getWhitelist();
  const strangerKeys: string[] = [];
  for (const key of dmKeys) {
    const peerHex = key.slice(dmPrefix.length);
    if (!isAllowedDmSender(peerHex, groups, knownPeers, ownPubkeyHex)) {
      strangerKeys.push(key);
    }
  }

  // Optimization guard: delMany([]) is a no-op; this guard avoids the call.
  if (strangerKeys.length > 0) {
    // Drain in-flight append queue entries for the stranger keys BEFORE delMany.
    // Without this, an appendMessage that is mid-flight when delMany fires may
    // resolve AFTER the delete, re-creating the key (in-flight write race).
    // Mirror the clearAllMessages() pattern: await Promise.allSettled(inflight)
    // first, then clear the queue handles, then delete from IDB.
    const inflightForKeys = strangerKeys
      .map((k) => appendQueues.get(k))
      .filter((p): p is Promise<void> => p !== undefined);
    if (inflightForKeys.length > 0) {
      await Promise.allSettled(inflightForKeys);
    }
    for (const key of strangerKeys) {
      appendQueues.delete(key);
    }
    await delMany(strangerKeys);

    // Edit/delete epic hygiene (S3 round-2 remediation finding 5): prune
    // messageEdits/api.ts's own pending-signal / delete-marker / slot-meta
    // aux state for each purged DM thread too. Privacy-relevant: a
    // stranger's buffered delete/edit signal must not survive the purge.
    // Dynamic import to avoid a circular import (messageEdits/api.ts imports
    // THIS module), mirroring storage.ts's existing wiring for the same
    // module. Best-effort: failure here must not fail the purge itself
    // (deleted:strangerKeys.length must still reflect the message-row purge
    // that already succeeded above).
    try {
      const { clearMessageEditsStateForThread } = await import('@/src/lib/messageEdits/api');
      await Promise.all(
        strangerKeys.map((key) => clearMessageEditsStateForThread(key.slice('few:messages:'.length))),
      );
    } catch (err) {
      console.warn('[chatPersistence] purgeStrangerDmThreads: messageEdits aux cleanup failed', err);
    }
  }

  const elapsed = performance.now() - start;
  if (elapsed > 2000) {
    throw new Error(`[purgeStrangerDmThreads] sweep exceeded 2 000 ms (${elapsed.toFixed(0)} ms)`);
  }
  if (elapsed > 500) {
    console.warn(`[purgeStrangerDmThreads] sweep took ${elapsed.toFixed(0)} ms (warn threshold: 500 ms)`);
  }

  return { deleted: strangerKeys.length };
}
