/**
 * Chat message persistence layer — idb-keyval implementation.
 *
 * Messages are stored per-group under the key `quizzl:messages:{groupId}`
 * in the default idb-keyval store.
 */

import { get, set, del, keys, delMany } from 'idb-keyval';
import { parseDirectPayload } from '@/src/lib/directMessages';
import type { RoledAttachments } from '@/src/lib/media/imageMessage';
import * as walledGarden from '@/src/lib/walledGarden';

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
}

function storageKey(groupId: string): string {
  return `quizzl:messages:${groupId}`;
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
    await set(storageKey(groupId), healedMessages);
    markHealed(groupId);
  } else {
    // Always mark healed even when no rows needed correction — idempotent.
    markHealed(groupId);
  }

  return { messages: healedMessages, refetchIds };
}

// Per-key append serialization: each key has a pending promise chain so
// concurrent appends never race and lose messages.
const appendQueues = new Map<string, Promise<void>>();

/** Append a single message to the group's persisted log. Deduplicates by id. */
export function appendMessage(groupId: string, message: ChatMessage): Promise<void> {
  const key = storageKey(groupId);
  const prev = appendQueues.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    const existing = (await get<ChatMessage[]>(key)) ?? [];
    if (existing.some((m) => m.id === message.id)) return;
    await set(key, [...existing, message]);
    // Dev-only hook: notify E2E tests when a message is written to IDB.
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
      (window as any).__quizzlTest?.onChatIdbWrite?.({ groupId, messageId: message.id });
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
  return next;
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
    (k): k is string => typeof k === 'string' && k.startsWith('quizzl:messages:'),
  );
  if (messageKeys.length > 0) {
    await delMany(messageKeys);
  }
}

/**
 * Purges IDB DM thread keys belonging to stranger peers.
 *
 * Enumerates all keys matching `quizzl:messages:dm:<peerHex>`, calls
 * `isAllowedDmSender` on each `<peerHex>`, and `del()`s the key when the
 * peer is a stranger.  Keys that carry the `quizzl:messages:` prefix but
 * lack the `dm:` discriminator (e.g. `quizzl:messages:<groupId>`) are
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
  const dmPrefix = 'quizzl:messages:dm:';
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
