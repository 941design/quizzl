import type { Group, ProfileAvatar } from '@/src/types';
import { STORAGE_KEYS } from '@/src/types';
import { isStorageAvailable } from '@/src/lib/storage';
import { isAllowedDmSender } from '@/src/lib/walledGarden';
import type { WhitelistArgs } from '@/src/lib/walledGarden';

export type StoredContact = {
  pubkeyHex: string;
  firstSeenAt: string;
  lastSeenAt: string;
  archivedAt?: string | null;
};

export type ContactListItem = StoredContact & {
  nickname: string;
  avatar: ProfileAvatar | null;
  updatedAt: string | null;
  archivedAt: string | null;
  isArchived: boolean;
};

type StoredContactMap = Record<string, StoredContact>;
type ContactCacheMap = Record<string, { nickname: string; avatar: ProfileAvatar | null; updatedAt: string }>;

function readContactCacheSnapshot(): ContactCacheMap {
  if (!isStorageAvailable()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.contactCache);
    return raw ? (JSON.parse(raw) as ContactCacheMap) : {};
  } catch {
    return {};
  }
}

function normalizeStoredContact(pubkeyHex: string, value: Partial<StoredContact> | null | undefined): StoredContact {
  return {
    pubkeyHex: value?.pubkeyHex || pubkeyHex,
    firstSeenAt: value?.firstSeenAt || new Date(0).toISOString(),
    lastSeenAt: value?.lastSeenAt || value?.firstSeenAt || new Date(0).toISOString(),
    archivedAt: value?.archivedAt ?? null,
  };
}

export function readStoredContacts(): StoredContactMap {
  if (!isStorageAvailable()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.contacts);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<StoredContact>>;
    return Object.fromEntries(
      Object.entries(parsed).map(([pubkeyHex, value]) => [pubkeyHex, normalizeStoredContact(pubkeyHex, value)]),
    );
  } catch {
    return {};
  }
}

function writeStoredContacts(next: StoredContactMap): void {
  if (!isStorageAvailable()) return;
  try {
    localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify(next));
  } catch {
    // silent — storage may be full
  }
}

/**
 * Persists a contact by pubkeyHex and last-seen timestamp.
 *
 * @param pubkeyHex - Hex pubkey of the contact to remember.
 * @param seenAt    - ISO timestamp of the event that triggered the remember.
 * @param isAllowed - Optional whitelist accessor injected by callers on the DM
 *                    inbound path (AC-STRUCT-2, DD-6). When provided and returns
 *                    `false` for `pubkeyHex`, the function silently no-ops without
 *                    throwing. Callers that are NOT on the DM path (e.g.
 *                    contactCache profile sync, rememberContactsFromGroups) omit
 *                    this parameter to preserve the existing allow-all behaviour.
 */
export function rememberContact(
  pubkeyHex: string,
  seenAt: string = new Date().toISOString(),
  isAllowed?: (peer: string) => boolean,
): void {
  if (!pubkeyHex) return;
  // AC-STRUCT-2: silently no-op when the whitelist accessor rejects this peer.
  if (isAllowed !== undefined && !isAllowed(pubkeyHex)) return;
  const contacts = readStoredContacts();
  const existing = contacts[pubkeyHex];
  contacts[pubkeyHex] = existing
    ? {
        ...existing,
        lastSeenAt: existing.lastSeenAt >= seenAt ? existing.lastSeenAt : seenAt,
      }
    : {
        pubkeyHex,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        archivedAt: null,
      };
  writeStoredContacts(contacts);
}

export function rememberContactsFromGroups(groups: Group[], ownPubkeyHex: string | null | undefined): void {
  const seenAt = new Date().toISOString();
  for (const group of groups) {
    for (const memberPubkey of group.memberPubkeys) {
      if (ownPubkeyHex && memberPubkey.toLowerCase() === ownPubkeyHex.toLowerCase()) continue;
      rememberContact(memberPubkey, seenAt);
    }
  }
}

export function archiveContact(pubkeyHex: string, archivedAt: string = new Date().toISOString()): void {
  if (!pubkeyHex) return;
  const contacts = readStoredContacts();
  const existing = contacts[pubkeyHex];
  if (!existing) return;
  contacts[pubkeyHex] = {
    ...existing,
    archivedAt,
  };
  writeStoredContacts(contacts);
}

export function unarchiveContact(pubkeyHex: string): void {
  if (!pubkeyHex) return;
  const contacts = readStoredContacts();
  const existing = contacts[pubkeyHex];
  if (!existing) return;
  contacts[pubkeyHex] = {
    ...existing,
    archivedAt: null,
  };
  writeStoredContacts(contacts);
}

export function listContacts(
  ownPubkeyHex: string | null | undefined,
  options?: { includeArchived?: boolean },
): ContactListItem[] {
  const stored = readStoredContacts();
  const cache = readContactCacheSnapshot();
  const includeArchived = options?.includeArchived ?? false;

  return Object.values(stored)
    .filter((contact) => {
      if (!ownPubkeyHex) return true;
      return contact.pubkeyHex.toLowerCase() !== ownPubkeyHex.toLowerCase();
    })
    .filter((contact) => includeArchived || !contact.archivedAt)
    .map((contact) => {
      const cached = cache[contact.pubkeyHex];
      return {
        ...contact,
        nickname: cached?.nickname ?? '',
        avatar: cached?.avatar ?? null,
        updatedAt: cached?.updatedAt ?? null,
        archivedAt: contact.archivedAt ?? null,
        isArchived: Boolean(contact.archivedAt),
      };
    })
    .sort((a, b) => {
      if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
      const updatedA = a.updatedAt ?? a.lastSeenAt;
      const updatedB = b.updatedAt ?? b.lastSeenAt;
      if (updatedA !== updatedB) return updatedB.localeCompare(updatedA);
      return (a.nickname || a.pubkeyHex).localeCompare(b.nickname || b.pubkeyHex);
    });
}

export function getContact(
  pubkeyHex: string,
  ownPubkeyHex: string | null | undefined,
  options?: { includeArchived?: boolean },
): ContactListItem | null {
  return listContacts(ownPubkeyHex, options).find((contact) => contact.pubkeyHex === pubkeyHex) ?? null;
}

/**
 * Purges stranger entries from both contact storage keys (AC-PURGE-5).
 *
 * Reads `STORAGE_KEYS.contacts` (lp_contacts_v1) and
 * `STORAGE_KEYS.contactCache` (lp_contactCache_v1), removes every entry
 * whose key is a stranger pubkey according to `isAllowedDmSender`, then
 * writes the cleaned objects back to localStorage.
 *
 * No-ops when localStorage is unavailable (SSR or restricted context).
 */
export function purgeStrangerContacts(
  getWhitelist: () => WhitelistArgs,
): void {
  if (!isStorageAvailable()) return;

  const { groups, ownPubkeyHex } = getWhitelist();

  // --- contacts store ---
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.contacts);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      let changed = false;
      for (const pubkey of Object.keys(parsed)) {
        if (!isAllowedDmSender(pubkey, groups, ownPubkeyHex)) {
          delete parsed[pubkey];
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify(parsed));
      }
    }
  } catch {
    // Non-fatal — storage may be full or corrupt
  }

  // --- contactCache store ---
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.contactCache);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      let changed = false;
      for (const pubkey of Object.keys(parsed)) {
        if (!isAllowedDmSender(pubkey, groups, ownPubkeyHex)) {
          delete parsed[pubkey];
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEYS.contactCache, JSON.stringify(parsed));
      }
    }
  } catch {
    // Non-fatal — storage may be full or corrupt
  }
}
