/**
 * Chat message persistence layer — idb-keyval implementation.
 *
 * Messages are stored per-group under the key `quizzl:messages:{groupId}`
 * in the default idb-keyval store.
 */

import { get, set, del } from 'idb-keyval';
import type { RoledAttachments } from '@/src/lib/media/imageMessage';

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

/** Load all persisted messages for a group, sorted oldest-first. */
export async function loadMessages(groupId: string): Promise<ChatMessage[]> {
  const stored = await get<ChatMessage[]>(storageKey(groupId));
  return stored ?? [];
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
