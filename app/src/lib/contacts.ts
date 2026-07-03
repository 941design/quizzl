import type { Group, ProfileAvatar } from '@/src/types';
import { STORAGE_KEYS } from '@/src/types';
import { isStorageAvailable } from '@/src/lib/storage';
import { isAllowedDmSender } from '@/src/lib/walledGarden';
import type { WhitelistArgs } from '@/src/lib/walledGarden';
import { npubToPubkeyHex } from '@/src/lib/nostrKeys';
import { rememberKnownPeers } from '@/src/lib/knownPeers';

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
 * Returns the groups shared by the current user and a given contact — i.e. the
 * groups whose `memberPubkeys` contains the contact's pubkey. Pubkey comparison
 * is case-insensitive, consistent with membership checks elsewhere
 * (MarmotContext.tsx).
 *
 * Pure: no storage access, no React. Callers pass the group list (typically
 * `useMarmot().groups`). The current user's own membership is implicit — the
 * groups array already only contains groups the user belongs to.
 *
 * @param groups        - Groups the current user belongs to.
 * @param contactPubkeyHex - Hex pubkey of the contact to test membership for.
 * @returns The subset of `groups` that also contain the contact, preserving
 *          input order. Empty array when none match or inputs are empty.
 */
export function commonGroups(groups: Group[], contactPubkeyHex: string): Group[] {
  if (!contactPubkeyHex) return [];
  const target = contactPubkeyHex.toLowerCase();
  return groups.filter((group) =>
    group.memberPubkeys.some((member) => member.toLowerCase() === target),
  );
}

/**
 * Returns the groups a contact can still be added to — groups the current user
 * belongs to where the contact is NOT already a member. Pubkey comparison is
 * case-insensitive. The complement of {@link commonGroups} over the same input.
 *
 * @param groups        - Groups the current user belongs to.
 * @param contactPubkeyHex - Hex pubkey of the contact to test membership for.
 * @returns The subset of `groups` that do NOT contain the contact, preserving
 *          input order. Empty array when all groups already contain them or
 *          inputs are empty.
 */
export function eligibleGroupsForContact(groups: Group[], contactPubkeyHex: string): Group[] {
  if (!contactPubkeyHex) return [];
  const target = contactPubkeyHex.toLowerCase();
  return groups.filter(
    (group) => !group.memberPubkeys.some((member) => member.toLowerCase() === target),
  );
}

/**
 * Returns the groups a contact can actually be added to: the {@link
 * eligibleGroupsForContact} subset further restricted to groups the current
 * user administers. `inviteByNpub` only succeeds for group admins (the MLS
 * `commit()` carries an admin check), so a non-admin group is never offered.
 *
 * Admin status is not part of the `Group` overlay — it lives in MLS state — so
 * the caller resolves it asynchronously and passes the resulting set of group
 * ids the current user is an admin of. Keeping that resolution outside this
 * function preserves its purity and testability.
 *
 * @param groups        - Groups the current user belongs to.
 * @param contactPubkeyHex - Hex pubkey of the contact to test membership for.
 * @param adminGroupIds - Ids of the groups the current user is an admin of.
 * @returns The eligible groups whose id is in `adminGroupIds`, preserving input
 *          order. Empty array when none qualify or inputs are empty.
 */
export function addableGroupsForContact(
  groups: Group[],
  contactPubkeyHex: string,
  adminGroupIds: ReadonlySet<string>,
): Group[] {
  return eligibleGroupsForContact(groups, contactPubkeyHex).filter((group) =>
    adminGroupIds.has(group.id),
  );
}

export type AddContactResult =
  | { ok: true; pubkeyHex: string; reactivated: boolean }
  | { ok: false; error: 'invalid_npub' | 'self' | 'already_exists' };

/**
 * Adds a contact by npub, the entry point for "add contact by npub" (S1).
 *
 * Decodes `npub` to hex first — no storage read or write happens before that
 * check, so an invalid npub never touches storage. Self-addressing is
 * rejected next, comparing `ownPubkeyHex` case-insensitively (Nostr pubkeys
 * arrive in varying capitalisations from different clients), also before any
 * storage mutation.
 *
 * `npubToPubkeyHex` decodes any well-formed bech32 npub, including ones that
 * checksum-decode to a payload that is not a valid 32-byte pubkey (e.g. an
 * npub built from a 2-character payload). Its result is therefore validated
 * here as exactly 64 lowercase hex characters (`/^[0-9a-f]{64}$/`) before it
 * is treated as a pubkey — a decoded-but-malformed payload is rejected as
 * `invalid_npub` with no storage mutation, same as a decode failure.
 *
 * Contact lookup is **case-insensitive** against `readStoredContacts()`.
 * `npubToPubkeyHex` always returns lowercase hex, but stored keys are NOT
 * guaranteed to be lowercase: `rememberContact` and `rememberContactsFromGroups`
 * index by whatever case the caller (or a group's `memberPubkeys`) happens to
 * supply, un-normalized. An exact-key match would therefore miss an existing
 * entry stored under a mixed/upper-case key — silently creating a duplicate
 * and bypassing both the `already_exists` guard and archived-contact
 * reactivation. The resolution below gathers ALL case-insensitive matches
 * (there can be more than one, e.g. an active entry and a separately-stored
 * archived entry differing only in case) and operates on that set, consistent
 * with the case-insensitive comparisons used elsewhere in this module
 * (`commonGroups`, `eligibleGroupsForContact`, `listContacts`). If ANY match
 * is active, the request is rejected as `already_exists` even if another
 * matching entry is archived — an active entry always wins the guard check
 * over reactivating a different archived duplicate.
 *
 * An existing, non-archived contact is left completely untouched (not even
 * `lastSeenAt` is bumped) and reported as `already_exists`. An existing,
 * archived contact (with no active match) is reactivated: `rememberKnownPeers`
 * runs BEFORE any contacts-store write, in both the reactivate and new-contact
 * branches — this ordering is load-bearing (ADR-005). It closes a window
 * where a concurrent `purgeStrangerContacts` sweep (e.g. from another browser
 * tab sharing localStorage) could otherwise delete the contact before it is
 * recognized as an ever-known peer. Do not reorder for convenience.
 *
 * @param npub          - Bech32 npub string supplied by the user.
 * @param ownPubkeyHex  - The local user's hex pubkey (any case, or
 *                        null/undefined). When falsy, the self-check is
 *                        skipped.
 * @returns `{ ok: true, pubkeyHex, reactivated }` on success — `reactivated`
 *   is `true` when an archived entry was restored, `false` for a brand-new
 *   entry. `{ ok: false, error }` otherwise, where `error` identifies which
 *   guard rejected the request.
 */
export function addContactByNpub(
  npub: string,
  ownPubkeyHex: string | null | undefined,
): AddContactResult {
  const decoded = npubToPubkeyHex(npub);
  if (decoded === null || !/^[0-9a-f]{64}$/.test(decoded.toLowerCase())) {
    return { ok: false, error: 'invalid_npub' };
  }
  const pubkeyHex = decoded.toLowerCase();

  if (ownPubkeyHex && pubkeyHex === ownPubkeyHex.toLowerCase()) {
    return { ok: false, error: 'self' };
  }

  const contacts = readStoredContacts();
  // Resolve ALL stored keys matching case-insensitively — pubkeyHex is
  // already lowercase (validated above), but the stored key(s) may not be,
  // and more than one case-variant entry can coexist.
  const matchingKeys = Object.keys(contacts).filter((key) => key.toLowerCase() === pubkeyHex);
  const hasActiveMatch = matchingKeys.some((key) => !contacts[key].archivedAt);

  if (hasActiveMatch) {
    return { ok: false, error: 'already_exists' };
  }

  if (matchingKeys.length > 0) {
    // All matches are archived — reactivate the first one deterministically;
    // any remaining archived duplicates are left as-is.
    const existingKey = matchingKeys[0];
    rememberKnownPeers([pubkeyHex]);
    unarchiveContact(existingKey);
    rememberContact(existingKey);
    return { ok: true, pubkeyHex, reactivated: true };
  }

  rememberKnownPeers([pubkeyHex]);
  rememberContact(pubkeyHex);
  return { ok: true, pubkeyHex, reactivated: false };
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
 *
 * @returns `{ deleted: number }` — total number of contact entries deleted
 *   across both storage keys (AC-OBS-5).
 */
export function purgeStrangerContacts(
  getWhitelist: () => WhitelistArgs,
): { deleted: number } {
  if (!isStorageAvailable()) return { deleted: 0 };

  const { groups, knownPeers, ownPubkeyHex } = getWhitelist();
  let deleted = 0;

  // --- contacts store ---
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.contacts);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      let changed = false;
      for (const pubkey of Object.keys(parsed)) {
        if (!isAllowedDmSender(pubkey, groups, knownPeers, ownPubkeyHex)) {
          delete parsed[pubkey];
          changed = true;
          deleted++;
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
        if (!isAllowedDmSender(pubkey, groups, knownPeers, ownPubkeyHex)) {
          delete parsed[pubkey];
          changed = true;
          deleted++;
        }
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEYS.contactCache, JSON.stringify(parsed));
      }
    }
  } catch {
    // Non-fatal — storage may be full or corrupt
  }

  return { deleted };
}
