/**
 * contactCache.ts — Global localStorage cache of known contact profiles.
 *
 * Stores nickname + avatar for contacts seen via MLS profile messages,
 * so group member lists can show names immediately even before the
 * per-group profile sync has completed.
 */

import type { ProfileAvatar } from '@/src/types';
import { STORAGE_KEYS } from '@/src/types';
import { isStorageAvailable } from '@/src/lib/storage';

export type CachedContact = {
  nickname: string;
  avatar: ProfileAvatar | null;
  updatedAt: string;
};

type ContactCacheMap = Record<string, CachedContact>;

export function readContactCache(): ContactCacheMap {
  if (!isStorageAvailable()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.contactCache);
    return raw ? (JSON.parse(raw) as ContactCacheMap) : {};
  } catch {
    return {};
  }
}

/** Upsert a contact using LWW by updatedAt. */
export function writeContactEntry(pubkeyHex: string, contact: CachedContact): void {
  if (!isStorageAvailable()) return;
  try {
    const cache = readContactCache();
    const existing = cache[pubkeyHex];
    if (existing && existing.updatedAt >= contact.updatedAt) return;
    cache[pubkeyHex] = contact;
    localStorage.setItem(STORAGE_KEYS.contactCache, JSON.stringify(cache));
  } catch {
    // silent — storage may be full
  }
}

export function readContactEntry(pubkeyHex: string): CachedContact | undefined {
  return readContactCache()[pubkeyHex];
}
