/**
 * IndexedDB-backed group state storage using idb-keyval.
 *
 * Stores:
 * - Group metadata list (name, members, relays) in 'quizzl_groups_v1'
 * - Member scores per group in 'quizzl_member_scores_v1'
 * - MLS group state bytes (passed directly to MarmotClient as groupStateStore)
 * - KeyPackage private material (passed directly as keyPackageStore)
 */

import { createStore, get, set, del, keys, clear } from 'idb-keyval';
import type { Group, MemberScore, MemberProfile, ScoreUpdate } from '@/src/types';
import type { StoredKeyPackage, SerializedClientState } from '@internet-privacy/marmot-ts';
// KeyValueStoreBackend is an internal utility type — import directly from subpath
type KeyValueStoreBackend<T> = {
  getItem(key: string): Promise<T | null>;
  setItem(key: string, value: T): Promise<T>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
};

// ---------------------------------------------------------------------------
// IDB stores (separate IDB object stores for isolation)
// ---------------------------------------------------------------------------

const groupMetaStore = createStore('quizzl-groups-meta', 'groups');
const groupStateStore = createStore('quizzl-groups-state', 'state');
const keyPackageStore = createStore('quizzl-keypackages', 'keypackages');
const memberScoreStore = createStore('quizzl-member-scores', 'scores');
const memberProfileStore = createStore('quizzl-member-profiles', 'profiles');

// ---------------------------------------------------------------------------
// Group metadata (name, members, relays) — our own overlay, not MLS state
// ---------------------------------------------------------------------------

export async function saveGroup(group: Group): Promise<void> {
  await set(group.id, group, groupMetaStore);
}

export async function loadGroup(id: string): Promise<Group | undefined> {
  return get<Group>(id, groupMetaStore);
}

export async function loadAllGroups(): Promise<Group[]> {
  const groupKeys = await keys<string>(groupMetaStore);
  const groups = await Promise.all(
    groupKeys.map((k) => get<Group>(k, groupMetaStore))
  );
  return groups.filter((g): g is Group => g !== undefined);
}

export async function deleteGroup(id: string): Promise<void> {
  await del(id, groupMetaStore);
}

export async function clearAllGroupMeta(): Promise<void> {
  await clear(groupMetaStore);
}

// ---------------------------------------------------------------------------
// Member scores
// ---------------------------------------------------------------------------

const memberScoreKey = (groupId: string) => `group:${groupId}`;

export async function loadMemberScores(groupId: string): Promise<MemberScore[]> {
  return (await get<MemberScore[]>(memberScoreKey(groupId), memberScoreStore)) ?? [];
}

export async function saveMemberScores(groupId: string, scores: MemberScore[]): Promise<void> {
  await set(memberScoreKey(groupId), scores, memberScoreStore);
}

/**
 * Merge an incoming ScoreUpdate for a member using last-writer-wins by sequenceNumber.
 */
export async function mergeMemberScore(
  groupId: string,
  pubkeyHex: string,
  nickname: string,
  update: ScoreUpdate
): Promise<void> {
  const existing = await loadMemberScores(groupId);
  const idx = existing.findIndex((m) => m.pubkeyHex === pubkeyHex);

  if (idx === -1) {
    // New member
    existing.push({
      pubkeyHex,
      nickname,
      scores: { [update.topicSlug]: update },
      lastSeq: update.sequenceNumber,
    });
  } else {
    const member = existing[idx];
    // Only update if the incoming sequence is newer for this topic
    const existingTopicScore = member.scores[update.topicSlug];
    if (
      !existingTopicScore ||
      update.sequenceNumber > (existingTopicScore.sequenceNumber ?? 0)
    ) {
      member.scores = { ...member.scores, [update.topicSlug]: update };
    }
    // Update global lastSeq if newer
    if (update.sequenceNumber > member.lastSeq) {
      member.lastSeq = update.sequenceNumber;
    }
    member.nickname = nickname || member.nickname;
    existing[idx] = member;
  }

  await saveMemberScores(groupId, existing);
}

export async function clearMemberScores(groupId: string): Promise<void> {
  await del(memberScoreKey(groupId), memberScoreStore);
}

// ---------------------------------------------------------------------------
// Member profiles
// ---------------------------------------------------------------------------

const memberProfileKey = (groupId: string) => `group:${groupId}`;

export async function loadMemberProfiles(groupId: string): Promise<MemberProfile[]> {
  return (await get<MemberProfile[]>(memberProfileKey(groupId), memberProfileStore)) ?? [];
}

export async function saveMemberProfiles(groupId: string, profiles: MemberProfile[]): Promise<void> {
  await set(memberProfileKey(groupId), profiles, memberProfileStore);
}

/**
 * Merge an incoming MemberProfile using last-writer-wins by updatedAt timestamp.
 */
export async function mergeMemberProfile(
  groupId: string,
  profile: MemberProfile
): Promise<void> {
  const existing = await loadMemberProfiles(groupId);
  const idx = existing.findIndex((p) => p.pubkeyHex === profile.pubkeyHex);

  if (idx === -1) {
    existing.push(profile);
  } else {
    // LWW by ISO timestamp
    if (profile.updatedAt > existing[idx].updatedAt) {
      existing[idx] = profile;
    }
  }

  await saveMemberProfiles(groupId, existing);
}

export async function clearMemberProfiles(groupId: string): Promise<void> {
  await del(memberProfileKey(groupId), memberProfileStore);
}

/**
 * Update the nickname in a MemberScore record so the leaderboard shows real names
 * without requiring a separate profile lookup.
 */
export async function updateMemberScoreNickname(
  groupId: string,
  pubkeyHex: string,
  nickname: string
): Promise<void> {
  if (!nickname) return;
  const scores = await loadMemberScores(groupId);
  const idx = scores.findIndex((m) => m.pubkeyHex === pubkeyHex);
  if (idx !== -1) {
    scores[idx].nickname = nickname;
    await saveMemberScores(groupId, scores);
  }
}

// ---------------------------------------------------------------------------
// Clear all group data (for resetAllData)
// ---------------------------------------------------------------------------

export async function clearAllGroupData(): Promise<void> {
  await clear(groupMetaStore);
  await clear(groupStateStore);
  await clear(keyPackageStore);
  await clear(memberScoreStore);
  await clear(memberProfileStore);
}

// ---------------------------------------------------------------------------
// KeyValueStoreBackend implementations for marmot-ts
// ---------------------------------------------------------------------------

/** MLS group state backend backed by IndexedDB */
export class IdbGroupStateBackend implements KeyValueStoreBackend<SerializedClientState> {
  async getItem(key: string): Promise<SerializedClientState | null> {
    return (await get<SerializedClientState>(key, groupStateStore)) ?? null;
  }

  async setItem(key: string, value: SerializedClientState): Promise<SerializedClientState> {
    await set(key, value, groupStateStore);
    return value;
  }

  async removeItem(key: string): Promise<void> {
    await del(key, groupStateStore);
  }

  async clear(): Promise<void> {
    await clear(groupStateStore);
  }

  async keys(): Promise<string[]> {
    return keys<string>(groupStateStore);
  }
}

/** KeyPackage private material backend backed by IndexedDB */
export class IdbKeyPackageBackend implements KeyValueStoreBackend<StoredKeyPackage> {
  async getItem(key: string): Promise<StoredKeyPackage | null> {
    return (await get<StoredKeyPackage>(key, keyPackageStore)) ?? null;
  }

  async setItem(key: string, value: StoredKeyPackage): Promise<StoredKeyPackage> {
    await set(key, value, keyPackageStore);
    return value;
  }

  async removeItem(key: string): Promise<void> {
    await del(key, keyPackageStore);
  }

  async clear(): Promise<void> {
    await clear(keyPackageStore);
  }

  async keys(): Promise<string[]> {
    return keys<string>(keyPackageStore);
  }
}
