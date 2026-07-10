import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { readUserProfile, writeUserProfile } from '@/src/lib/storage';
import { capNickname } from '@/src/config/profile';
import { ensureAvatar } from '@/src/lib/avatar';
import type { UserProfile } from '@/src/types';
import { useBackup } from '@/src/context/BackupContext';

const EMPTY_USER_PROFILE: UserProfile = {
  nickname: '',
  avatar: null,
};

type ProfileContextValue = {
  profile: UserProfile;
  hydrated: boolean;
  saveProfile: (profile: UserProfile) => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { markDirty: markBackupDirty } = useBackup();
  const [profile, setProfile] = useState<UserProfile>(EMPTY_USER_PROFILE);
  const [hydrated, setHydrated] = useState(false);

  // On hydration, guarantee the profile carries an avatar image: brand-new
  // profiles and legacy profiles saved with `avatar: null` are backfilled with
  // a random avatar and persisted once. This is the single seed point for the
  // "a profile is never without an avatar" invariant. The backfilled avatar is
  // NOT broadcast here — it reaches groups only on the user's next profile
  // update (broadcast lives in the profile page), so no silent MLS traffic.
  useEffect(() => {
    const stored = readUserProfile();
    const ensured = ensureAvatar(stored);
    if (ensured !== stored) {
      writeUserProfile(ensured);
      markBackupDirty(true);
    }
    setProfile(ensured);
    setHydrated(true);
    // markBackupDirty is stable (useCallback); this effect runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enforce two invariants at the single save chokepoint, so every caller
  // (profile edit, avatar select, identity-restore in settings) is covered:
  //   1. the 32-UTF-8-byte nickname cap (AC-CARD-7), and
  //   2. a profile always carries an avatar image — `ensureAvatar` backfills a
  //      random one if a caller ever passes `avatar: null`.
  // Both the in-memory value (the source broadcast over MLS) and the persisted
  // value are normalized — not just the profile-edit input.
  const saveProfile = useCallback((nextProfile: UserProfile) => {
    const capped = { ...nextProfile, nickname: capNickname(nextProfile.nickname).value };
    const ensured = ensureAvatar(capped);
    setProfile(ensured);
    writeUserProfile(ensured);
    markBackupDirty(true);
  }, [markBackupDirty]);

  const value = useMemo(
    () => ({ profile, hydrated, saveProfile }),
    [profile, hydrated, saveProfile]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);

  if (!context) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }

  return context;
}
