import type {
  Settings,
  UserProfile,
} from '@/src/types';
import { STORAGE_KEYS } from '@/src/types';
import { DEFAULT_THEME_NAME, normalizeThemeName } from '@/src/lib/theme';
import { AVATAR_BROWSER_CONFIG, PROFILE_NICKNAME_MAX_LENGTH } from '@/src/config/profile';

// ============================
// localStorage availability check
// ============================

let _storageAvailable: boolean | null = null;

export function isStorageAvailable(): boolean {
  if (_storageAvailable !== null) return _storageAvailable;

  try {
    const testKey = '__lp_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    _storageAvailable = true;
  } catch {
    _storageAvailable = false;
  }

  return _storageAvailable;
}

// ============================
// Generic read/write helpers
// ============================

function readItem<T>(key: string, defaultValue: T): T {
  if (!isStorageAvailable()) return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function writeItem<T>(key: string, value: T): void {
  if (!isStorageAvailable()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Silent fail — storage may be full or restricted
  }
}

// ============================
// Settings
// ============================

const DEFAULT_SETTINGS: Settings = { theme: DEFAULT_THEME_NAME, language: 'en' };
const DEFAULT_USER_PROFILE: UserProfile = { nickname: '', avatar: null };

export function readSettings(): Settings {
  const stored = readItem<Partial<Settings> | null>(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
  const storedTheme = normalizeThemeName(stored?.theme ?? stored?.mood);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    theme: storedTheme,
  };
}

export function writeSettings(settings: Settings): void {
  writeItem(STORAGE_KEYS.settings, {
    theme: normalizeThemeName(settings.theme ?? settings.mood),
    language: settings.language,
  });
}

// ============================
// User Profile
// ============================

function normalizeUserProfile(raw: Partial<UserProfile> | null | undefined): UserProfile {
  const nickname = typeof raw?.nickname === 'string'
    ? raw.nickname.trim().slice(0, PROFILE_NICKNAME_MAX_LENGTH)
    : '';

  // Canonical shape carries only imageUrl. Legacy profiles (and restored legacy
  // backups) stored an `id` instead — reconstruct the imageUrl from it.
  const rawAvatar = raw?.avatar as { imageUrl?: unknown; id?: unknown } | null | undefined;
  let avatar: UserProfile['avatar'] = null;
  if (rawAvatar && typeof rawAvatar.imageUrl === 'string') {
    avatar = { imageUrl: rawAvatar.imageUrl };
  } else if (rawAvatar && typeof rawAvatar.id === 'string') {
    avatar = { imageUrl: `${AVATAR_BROWSER_CONFIG.endpointBaseUrl}/${rawAvatar.id}.png` };
  }

  return {
    nickname,
    avatar,
  };
}

export function readUserProfile(): UserProfile {
  const stored = readItem<Partial<UserProfile> | null>(STORAGE_KEYS.userProfile, DEFAULT_USER_PROFILE);
  return normalizeUserProfile(stored);
}

export function writeUserProfile(profile: UserProfile): void {
  writeItem(STORAGE_KEYS.userProfile, normalizeUserProfile(profile));
}

// ============================
// Reset all app data
// ============================
//
// CURRENTLY UNUSED. The "Reset All Data" / "Clear all data" action was removed
// from the frontend (the Settings page) because an accidental trigger would
// irreversibly wipe the user's identity and all local state. The logic below is
// intentionally retained — it is still correct and unit-tested — so the
// capability can be re-exposed behind stronger safeguards in the future. Do not
// wire it back into the UI without a deliberate, hard-to-misfire confirmation flow.

export function resetAllData(): void {
  if (!isStorageAvailable()) return;
  Object.values(STORAGE_KEYS).forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Silent fail
    }
  });

  // Also clear IndexedDB account-scoped data. Fire-and-forget — the caller
  // typically reloads the page right after this returns, but each clear must
  // run regardless of whether the previous one rejects so leftover data from
  // the prior identity does not survive on disk.
  if (typeof window !== 'undefined') {
    void clearAccountScopedIdbData();
  }
}

async function clearAccountScopedIdbData(): Promise<void> {
  const tasks: Array<Promise<unknown>> = [
    import('@/src/lib/marmot/groupStorage').then(({ clearAllGroupData }) => clearAllGroupData()),
    import('@/src/lib/marmot/chatPersistence').then(({ clearAllMessages }) => clearAllMessages()),
    import('@/src/lib/marmot/inviteLinkStorage').then(({ clearAllInviteLinks }) => clearAllInviteLinks()),
    import('@/src/lib/marmot/joinRequestStorage').then(({ clearAllPendingJoinRequests }) => clearAllPendingJoinRequests()),
    import('@/src/lib/marmot/pollPersistence').then(({ clearAllPollData }) => clearAllPollData()),
    import('@/src/lib/marmot/mediaPersistence').then(({ clearAllMedia }) => clearAllMedia()),
    // Wipe both reaction namespaces (quizzl:reactions:group:* and quizzl:reactions:dm:*)
    // so reactions from one identity do not survive an account switch (AC-14, D11).
    import('@/src/lib/reactions/api').then(({ clearAllReactions }) => clearAllReactions()),
  ];
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[storage] resetAllData IDB clear failed:', result.reason);
    }
  }
}
