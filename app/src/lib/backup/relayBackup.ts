/**
 * Relay backup — payload assembly, serialization, encryption, and publishing.
 *
 * Collects all local app state (localStorage + IDB) into a single
 * BackupPayload object, encrypts it with NIP-44 self-encryption,
 * and publishes/fetches it as a kind 30078 replaceable event.
 */

import { STORAGE_KEYS, DEFAULT_RELAYS } from '@/src/types';
import {
  loadAllGroups,
  loadMemberScores,
  loadMemberProfiles,
  saveGroup,
  saveMemberScores,
  saveMemberProfiles,
  clearAllGroupData,
  IdbGroupStateBackend,
} from '@/src/lib/marmot/groupStorage';
import { loadMessages, clearMessages } from '@/src/lib/marmot/chatPersistence';
import type { ChatMessage } from '@/src/lib/marmot/chatPersistence';
import type { EventSigner } from 'applesauce-core';
import type NDK from '@nostr-dev-kit/ndk';
import { fetchEventsWithTimeout } from '@/src/lib/ndkClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupPayload {
  version: 1;
  createdAt: number;
  settings: { theme: string; language: string } | null;
  userProfile: {
    nickname: string;
    avatar: { id: string; subject: string; accessories: string[] } | null;
    badgeIds: string[];
  } | null;
  selectedTopics: string[] | null;
  progress: Record<string, unknown> | null;
  studyTimes: unknown[] | null;
  scoreSyncSeq: number;
  groups: Array<{
    id: string;
    name: string;
    createdAt: number;
    memberPubkeys: string[];
    relays: string[];
  }>;
  groupStates: Record<string, string>;
  memberScores: Record<string, unknown[]>;
  memberProfiles: Record<string, unknown[]>;
  chatMessages: Record<
    string,
    Array<{
      id: string;
      content: string;
      senderPubkey: string;
      groupId: string;
      createdAt: number;
    }>
  >;
}

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function readJsonItem<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Payload assembly
// ---------------------------------------------------------------------------

/** Maximum number of chat messages to include per group. */
const MAX_CHAT_MESSAGES = 10;

export async function collectBackupPayload(): Promise<BackupPayload> {
  // localStorage reads
  const settings = readJsonItem<{ theme: string; language: string }>(
    STORAGE_KEYS.settings,
  );

  const rawProfile = readJsonItem<{
    nickname: string;
    avatar: { id: string; subject: string; accessories: string[] } | null;
    badgeIds: string[];
  }>(STORAGE_KEYS.userProfile);
  const userProfile = rawProfile ?? null;

  const rawTopics = readJsonItem<{ slugs: string[] }>(
    STORAGE_KEYS.selectedTopics,
  );
  const selectedTopics = rawTopics?.slugs ?? null;

  const progress = readJsonItem<Record<string, unknown>>(
    STORAGE_KEYS.progress,
  );

  const rawStudyTimes = readJsonItem<{ sessions: unknown[] }>(
    STORAGE_KEYS.studyTimes,
  );
  const studyTimes = rawStudyTimes?.sessions ?? null;

  const scoreSyncSeq = Number(
    localStorage.getItem(STORAGE_KEYS.scoreSyncSeq) ?? '0',
  );

  // IDB reads
  const groups = await loadAllGroups();

  const groupStates: Record<string, string> = {};
  const memberScores: Record<string, unknown[]> = {};
  const memberProfiles: Record<string, unknown[]> = {};
  const chatMessages: Record<string, ChatMessage[]> = {};

  const stateBackend = new IdbGroupStateBackend();
  const stateKeys = await stateBackend.keys();

  // Load MLS state for all known keys and base64-encode
  for (const key of stateKeys) {
    const state = await stateBackend.getItem(key);
    if (state) {
      // SerializedClientState may be a Uint8Array or have a bytes field
      const bytes =
        state instanceof Uint8Array
          ? state
          : typeof (state as { bytes?: Uint8Array }).bytes !== 'undefined'
            ? new Uint8Array((state as { bytes: Uint8Array }).bytes)
            : new TextEncoder().encode(JSON.stringify(state));
      groupStates[key] = uint8ArrayToBase64(bytes);
    }
  }

  // Per-group data
  for (const group of groups) {
    const scores = await loadMemberScores(group.id);
    memberScores[group.id] = scores;

    const profiles = await loadMemberProfiles(group.id);
    memberProfiles[group.id] = profiles;

    const messages = await loadMessages(group.id);
    // Keep only the last MAX_CHAT_MESSAGES, preserving chronological order
    chatMessages[group.id] = messages.slice(-MAX_CHAT_MESSAGES);
  }

  return {
    version: 1,
    createdAt: Math.floor(Date.now() / 1000),
    settings,
    userProfile,
    selectedTopics,
    progress,
    studyTimes,
    scoreSyncSeq,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      createdAt: g.createdAt,
      memberPubkeys: g.memberPubkeys,
      relays: g.relays,
    })),
    groupStates,
    memberScores,
    memberProfiles,
    chatMessages,
  };
}

// ---------------------------------------------------------------------------
// S2: NIP-44 encrypt, publish, fetch, decrypt
// ---------------------------------------------------------------------------

/** Kind 30078 is a parameterized replaceable event (NIP-78: application data). */
const BACKUP_EVENT_KIND = 30078;
const BACKUP_D_TAG = 'quizzl';

/** Kind 30051 is a relay list for specific use (NIP-51 sets). */
const RELAY_LIST_KIND = 30051;

/**
 * Encrypt the backup payload with NIP-44 (self-encryption) and build
 * a kind 30078 unsigned event template.
 */
export async function createBackupEvent(
  payload: BackupPayload,
  signer: EventSigner,
  pubkeyHex: string,
): Promise<{ kind: number; created_at: number; tags: string[][]; content: string }> {
  const plaintext = JSON.stringify(payload);
  const ciphertext = await signer.nip44!.encrypt(pubkeyHex, plaintext);

  return {
    kind: BACKUP_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', BACKUP_D_TAG]],
    content: ciphertext,
  };
}

/**
 * Collect the backup payload, encrypt it, sign it, and publish to relays.
 * Returns { ok: true } on success, or { ok: false, error } if all relays reject.
 */
export async function publishBackup(
  signer: EventSigner,
  pubkeyHex: string,
  ndk: NDK,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const payload = await collectBackupPayload();
    const eventTemplate = await createBackupEvent(payload, signer, pubkeyHex);
    const signedEvent = await signer.signEvent(eventTemplate);

    const { NDKEvent, NDKRelaySet } = await import('@nostr-dev-kit/ndk');
    const relayUrls = await getBackupRelays(ndk, pubkeyHex);
    const relaySet = NDKRelaySet.fromRelayUrls(relayUrls, ndk);

    const ndkEvent = new NDKEvent(ndk);
    ndkEvent.kind = signedEvent.kind;
    ndkEvent.content = signedEvent.content;
    ndkEvent.tags = signedEvent.tags;
    ndkEvent.created_at = signedEvent.created_at;
    ndkEvent.pubkey = signedEvent.pubkey;
    ndkEvent.id = signedEvent.id;
    ndkEvent.sig = signedEvent.sig;

    await ndkEvent.publish(relaySet);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'publish failed';
    return { ok: false, error: message };
  }
}

/**
 * Fetch the latest backup from relays, decrypt it, validate version,
 * and return the BackupPayload or null if none found.
 */
export async function fetchBackup(
  signer: EventSigner,
  pubkeyHex: string,
  ndk: NDK,
  relays?: string[],
): Promise<BackupPayload | null> {
  const relayUrls = relays ?? [...DEFAULT_RELAYS];

  const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
  const relaySet = NDKRelaySet.fromRelayUrls(relayUrls, ndk);

  const { events } = await fetchEventsWithTimeout(
    ndk,
    { kinds: [BACKUP_EVENT_KIND], authors: [pubkeyHex], '#d': [BACKUP_D_TAG] },
    undefined,
    relaySet,
  );

  if (events.size === 0) return null;

  // Pick the newest event by created_at
  let newest: { content: string; created_at: number } | null = null;
  for (const ev of events) {
    if (!newest || (ev.created_at ?? 0) > newest.created_at) {
      newest = { content: ev.content, created_at: ev.created_at ?? 0 };
    }
  }

  if (!newest) return null;

  const plaintext = await signer.nip44!.decrypt(pubkeyHex, newest.content);
  const parsed = JSON.parse(plaintext) as BackupPayload;

  if (parsed.version !== 1) {
    throw new Error(`Unsupported backup version: ${parsed.version}`);
  }

  return parsed;
}

/**
 * Read relay URLs from the user's kind 30051 relay list event.
 * Falls back to DEFAULT_RELAYS if no list is found.
 */
export async function getBackupRelays(
  ndk: NDK,
  pubkeyHex: string,
): Promise<string[]> {
  const { events } = await fetchEventsWithTimeout(ndk, {
    kinds: [RELAY_LIST_KIND],
    authors: [pubkeyHex],
  });

  if (events.size === 0) return [...DEFAULT_RELAYS];

  // Pick newest event
  let newest: { tags: string[][] } | null = null;
  let newestAt = 0;
  for (const ev of events) {
    if ((ev.created_at ?? 0) > newestAt) {
      newestAt = ev.created_at ?? 0;
      newest = { tags: ev.tags };
    }
  }

  if (!newest) return [...DEFAULT_RELAYS];

  // Extract relay URLs from 'relay' or 'r' tags
  const relayUrls = newest.tags
    .filter((t) => t[0] === 'relay' || t[0] === 'r')
    .map((t) => t[1])
    .filter(Boolean);

  return relayUrls.length > 0 ? relayUrls : [...DEFAULT_RELAYS];
}

// ---------------------------------------------------------------------------
// S3: Restore state from backup payload
// ---------------------------------------------------------------------------

/**
 * Restore all local state from a backup payload.
 * Clears existing localStorage and IDB data before rehydrating.
 */
export async function restoreFromBackup(payload: BackupPayload): Promise<void> {
  // 1. Clear all localStorage keys
  for (const key of Object.values(STORAGE_KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Silent fail
    }
  }

  // 2. Clear all IDB stores
  // Load groups first so we can clear their chat messages (stored in default idb-keyval store)
  const existingGroups = await loadAllGroups();
  await clearAllGroupData();
  for (const group of existingGroups) {
    await clearMessages(group.id);
  }

  // 3. Rehydrate localStorage
  if (payload.settings) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(payload.settings));
  }
  if (payload.userProfile) {
    localStorage.setItem(STORAGE_KEYS.userProfile, JSON.stringify(payload.userProfile));
  }
  if (payload.selectedTopics) {
    localStorage.setItem(
      STORAGE_KEYS.selectedTopics,
      JSON.stringify({ slugs: payload.selectedTopics }),
    );
  }
  if (payload.progress) {
    localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(payload.progress));
  }
  if (payload.studyTimes) {
    localStorage.setItem(
      STORAGE_KEYS.studyTimes,
      JSON.stringify({ sessions: payload.studyTimes }),
    );
  }
  if (payload.scoreSyncSeq !== undefined) {
    localStorage.setItem(STORAGE_KEYS.scoreSyncSeq, String(payload.scoreSyncSeq));
  }

  // 4. Rehydrate IDB: groups
  for (const group of payload.groups) {
    await saveGroup(group);
  }

  // 5. Rehydrate MLS state (base64-decoded)
  const stateBackend = new IdbGroupStateBackend();
  for (const [key, b64] of Object.entries(payload.groupStates)) {
    const bytes = base64ToUint8Array(b64);
    await stateBackend.setItem(key, bytes as never);
  }

  // 6. Rehydrate member scores
  for (const [groupId, scores] of Object.entries(payload.memberScores)) {
    await saveMemberScores(groupId, scores as never[]);
  }

  // 7. Rehydrate member profiles
  for (const [groupId, profiles] of Object.entries(payload.memberProfiles)) {
    await saveMemberProfiles(groupId, profiles as never[]);
  }

  // 8. Rehydrate chat messages
  const { set: idbSet } = await import('idb-keyval');
  for (const [groupId, messages] of Object.entries(payload.chatMessages)) {
    await idbSet(`quizzl:messages:${groupId}`, messages);
  }

  // 9. Mark identity as backed up
  localStorage.setItem(STORAGE_KEYS.nostrBackedUp, 'true');
}

// ---------------------------------------------------------------------------
// S4: Backup scheduler with debounce
// ---------------------------------------------------------------------------

/** Minimum interval between backup publishes (5 minutes). */
const DEBOUNCE_MS = 5 * 60 * 1000;

export class BackupScheduler {
  private publishFn: () => Promise<void>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastPublishAt = 0;
  private disposed = false;

  constructor(publishFn: () => Promise<void>) {
    this.publishFn = publishFn;
  }

  /**
   * Mark the backup as dirty (state has changed).
   * If `immediate` is true, publish as soon as the debounce window allows.
   * Otherwise, schedule a publish after the debounce interval.
   */
  markDirty(immediate?: boolean): void {
    if (this.disposed) return;

    // Clear any existing scheduled timer
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const elapsed = Date.now() - this.lastPublishAt;
    const remaining = DEBOUNCE_MS - elapsed;

    if (immediate && remaining <= 0) {
      // Can publish right now
      this.doPublish();
    } else {
      // Schedule for when the debounce window expires
      const delay = remaining > 0 ? remaining : DEBOUNCE_MS;
      this.timer = setTimeout(() => this.doPublish(), delay);
    }
  }

  /** Clean up timers. */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private doPublish(): void {
    this.lastPublishAt = Date.now();
    this.timer = null;
    this.publishFn().catch((err) => {
      console.warn('[BackupScheduler] publish failed:', err);
    });
  }
}
