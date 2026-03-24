/**
 * profileSync.ts — Utilities for building and processing profile messages.
 *
 * Mirrors scoreSync.ts. Serialises/deserialises profile data for MLS
 * application messages so group members can see each other's nicknames,
 * avatars, and badges.
 */

import type { UserProfile, ProfileAvatar, MemberProfile } from '@/src/types';
import { AVATAR_BROWSER_CONFIG } from '@/src/config/profile';

/** MLS application-message rumor kind for profile updates (kind 0 = metadata). */
export const PROFILE_RUMOR_KIND = 0;

/** Wire format for the profile data section */
export type ProfilePayload = {
  nickname: string;
  avatar: { id: string; subject: string; accessories: string[] } | null;
  badgeIds: string[];
  updatedAt: string;
};

/** Serialise a UserProfile to JSON content for MLS application rumor. */
export function serialiseProfileUpdate(profile: UserProfile): string {
  const data: ProfilePayload = {
    nickname: profile.nickname,
    avatar: profile.avatar
      ? { id: profile.avatar.id, subject: profile.avatar.subject, accessories: profile.avatar.accessories }
      : null,
    badgeIds: profile.badgeIds,
    updatedAt: new Date().toISOString(),
  };
  return JSON.stringify(data);
}

/** Parse rumor content as a ProfilePayload. Returns null if not valid. */
export function parseProfilePayload(content: string): ProfilePayload | null {
  try {
    const d = JSON.parse(content) as ProfilePayload;
    if (typeof d.nickname !== 'string' || !Array.isArray(d.badgeIds) || typeof d.updatedAt !== 'string') {
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

/** Reconstruct a full MemberProfile from a parsed payload and the sender's pubkey */
export function payloadToMemberProfile(pubkeyHex: string, payload: ProfilePayload): MemberProfile {
  let avatar: ProfileAvatar | null = null;
  if (payload.avatar) {
    avatar = {
      id: payload.avatar.id,
      subject: payload.avatar.subject,
      accessories: payload.avatar.accessories,
      imageUrl: `${AVATAR_BROWSER_CONFIG.endpointBaseUrl}/avatars/${payload.avatar.id}.png`,
    };
  }
  return {
    pubkeyHex,
    nickname: payload.nickname,
    avatar,
    badgeIds: payload.badgeIds,
    updatedAt: payload.updatedAt,
  };
}
