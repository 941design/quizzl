import { describe, it, expect } from 'vitest';
import manifest from '@/src/data/avatarManifest.json';
import { pickRandomAvatar, ensureAvatar } from '@/src/lib/avatar';
import type { UserProfile } from '@/src/types';

const manifestUrls = new Set(manifest.items.map((item) => item.imageUrl));

describe('pickRandomAvatar', () => {
  it('always returns an avatar whose imageUrl comes from the manifest', () => {
    for (let i = 0; i < 50; i += 1) {
      const avatar = pickRandomAvatar();
      expect(manifestUrls.has(avatar.imageUrl)).toBe(true);
    }
  });
});

describe('ensureAvatar', () => {
  it('backfills a random avatar when the profile has none', () => {
    const profile: UserProfile = { nickname: 'Jo', avatar: null };
    const ensured = ensureAvatar(profile);
    expect(ensured.avatar).not.toBeNull();
    expect(manifestUrls.has(ensured.avatar!.imageUrl)).toBe(true);
    // Nickname is preserved untouched.
    expect(ensured.nickname).toBe('Jo');
  });

  it('returns the same profile object unchanged when an avatar is already set', () => {
    const profile: UserProfile = {
      nickname: 'Jo',
      avatar: { imageUrl: '//few.chat/assets/existing.png' },
    };
    // Same reference — no needless copy, so no spurious persist/broadcast.
    expect(ensureAvatar(profile)).toBe(profile);
  });
});
