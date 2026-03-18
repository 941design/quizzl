/**
 * profileSync.ts — Utilities for building and processing profile messages.
 *
 * Mirrors scoreSync.ts. Serialises/deserialises profile data for MLS
 * application messages so group members can see each other's nicknames,
 * avatars, and badges.
 */

import type { UserProfile, ProfileAvatar, MemberProfile } from '@/src/types';
import { AVATAR_BROWSER_CONFIG } from '@/src/config/profile';

const PROFILE_PAYLOAD_TYPE = 'quizzl-profile-v1';

/** Wire format for the profile data section */
export type ProfilePayload = {
  nickname: string;
  avatar: { id: string; subject: string; accessories: string[] } | null;
  badgeIds: string[];
  updatedAt: string;
};

/** Serialise a UserProfile to JSON payload for MLS application messages */
export function serialiseProfileUpdate(profile: UserProfile): string {
  const data: ProfilePayload = {
    nickname: profile.nickname,
    avatar: profile.avatar
      ? { id: profile.avatar.id, subject: profile.avatar.subject, accessories: profile.avatar.accessories }
      : null,
    badgeIds: profile.badgeIds,
    updatedAt: new Date().toISOString(),
  };
  return JSON.stringify({ type: PROFILE_PAYLOAD_TYPE, data });
}

/** Parse raw MLS application message text. Returns null if not a profile message. */
export function parseProfilePayload(text: string): ProfilePayload | null {
  try {
    const parsed = JSON.parse(text) as { type?: string; data?: ProfilePayload };
    if (parsed.type !== PROFILE_PAYLOAD_TYPE || !parsed.data) return null;
    const d = parsed.data;
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
