import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { readUserProfile, writeUserProfile } from '@/src/lib/storage';
import { capNickname } from '@/src/config/profile';
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

  useEffect(() => {
    setProfile(readUserProfile());
    setHydrated(true);
  }, []);

  // Enforce the 32-UTF-8-byte nickname cap at the single save chokepoint, so
  // every caller (profile edit, avatar select, identity-restore in settings)
  // caps both the in-memory value (the source broadcast over MLS) and the
  // persisted value — not just the profile-edit input. (AC-CARD-7)
  const saveProfile = useCallback((nextProfile: UserProfile) => {
    const capped = { ...nextProfile, nickname: capNickname(nextProfile.nickname).value };
    setProfile(capped);
    writeUserProfile(capped);
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
