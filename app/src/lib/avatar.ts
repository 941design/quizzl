import avatarManifest from '@/src/data/avatarManifest.json';
import type { ProfileAvatar, UserProfile } from '@/src/types';

type AvatarManifestItem = { imageUrl: string };

const AVATAR_ITEMS = (avatarManifest as { items: AvatarManifestItem[] }).items;

/**
 * Pick a random avatar from the bundled manifest. Used to seed every profile
 * with an image so a profile is never avatar-less (see {@link ensureAvatar}).
 * Falls back to the first item if the manifest were ever empty, so the return
 * value is always a usable {@link ProfileAvatar}.
 */
export function pickRandomAvatar(): ProfileAvatar {
  const index = Math.floor(Math.random() * AVATAR_ITEMS.length);
  const item = AVATAR_ITEMS[index] ?? AVATAR_ITEMS[0];
  return { imageUrl: item.imageUrl };
}

/**
 * Enforce the "a profile always has an avatar image" invariant: return the
 * profile unchanged when it already carries an avatar, otherwise return a copy
 * with a freshly-picked random avatar. Pure — the caller decides whether to
 * persist/broadcast the result. Legacy profiles saved with `avatar: null` are
 * backfilled the first time they are loaded through this helper.
 */
export function ensureAvatar(profile: UserProfile): UserProfile {
  return profile.avatar ? profile : { ...profile, avatar: pickRandomAvatar() };
}
