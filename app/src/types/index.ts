// ============================
// Language / Theme Types
// ============================

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number];
export type AppThemeName = 'calm' | 'playful' | 'lego' | 'minecraft' | 'flower';

// ============================
// User Data / localStorage Types
// ============================

export type Settings = {
  theme: AppThemeName;
  mood?: AppThemeName;
  language: LanguageCode;
};

export type ProfileAvatar = {
  imageUrl: string;
};

export type UserProfile = {
  nickname: string;
  avatar: ProfileAvatar | null;
};

// ============================
// Storage Keys
// ============================

export const STORAGE_KEYS = {
  settings: 'lp_settings_v1',
  userProfile: 'lp_userProfile_v1',
  nostrIdentity: 'lp_nostrIdentity_v1',
  nostrBackedUp: 'lp_nostrIdentityBackedUp_v1',
  processedGiftWraps: 'lp_processedGiftWraps',
  contactCache: 'lp_contactCache_v1',
  contacts: 'lp_contacts_v1',
  knownPeers: 'lp_knownPeers_v1',
  knownPeersMigrated: 'lp_knownPeersMigrated_v2',
  pendingInvitations: 'lp_pendingInvitations_v1',
} as const;

// ============================
// Nostr / Groups Types
// ============================

/** Default public relay URLs for Nostr connections */
const ENV_RELAYS = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_RELAYS
  ? process.env.NEXT_PUBLIC_RELAYS.split(',').map(r => r.trim()).filter(Boolean)
  : null;

export const DEFAULT_RELAYS: readonly string[] = ENV_RELAYS ?? [
  'wss://relay.damus.io',
  'wss://nos.lol',
];

export type NostrIdentity = {
  pubkeyHex: string;
  npub: string;
  /** Whether the identity has been backed up via seed phrase */
  backedUp: boolean;
};

export type Group = {
  /** hex-encoded MLS group ID */
  id: string;
  name: string;
  /** Unix timestamp of creation/join */
  createdAt: number;
  /** hex pubkeys of members known to the local client */
  memberPubkeys: string[];
  /** Relay URLs this group uses */
  relays: string[];
};

export type GroupMember = {
  pubkeyHex: string;
  npub: string;
  nickname: string;
};

/**
 * Signed Nostr kind:0 envelope embedded inside a profile rumor's content.
 * Authenticates the original profile author independently of the MLS relayer,
 * enabling relay-on-behalf for offline members.
 */
export type SignedProfileEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: 0;
  tags: string[][];
  content: string;
  sig: string;
};

export type MemberProfile = {
  pubkeyHex: string;
  nickname: string;
  avatar: ProfileAvatar | null;
  /** ISO timestamp for LWW resolution */
  updatedAt: string;
  /** Verified signed envelope when the profile arrived via a sig-bearing rumor. Absent for legacy peers. */
  signedEvent?: SignedProfileEvent;
};
