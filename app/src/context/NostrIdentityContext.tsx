/**
 * Nostr Identity Context — Tier 1 (auto-generated local keypair).
 *
 * On first mount (client-side only):
 * 1. Load or generate a Nostr keypair from localStorage.
 * 2. Connect NDK to default relays.
 * 3. Publish kind 0 (metadata) and 5 kind 443 (KeyPackages).
 *
 * Provides pubkeyHex, npub, and the NDKPrivateKeySigner to the app.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { NostrIdentity } from '@/src/types';
import { STORAGE_KEYS } from '@/src/types';
import {
  loadStoredIdentity,
  saveStoredIdentity,
  generateIdentityFromSeed,
  derivePublicKeyHex,
  pubkeyToNpub,
  type StoredNostrIdentity,
} from '@/src/lib/nostrKeys';
import { readUserProfile } from '@/src/lib/storage';

type NostrIdentityContextValue = {
  /** Whether the identity has been loaded from storage (may be null on SSR) */
  hydrated: boolean;
  /** Hex-encoded public key */
  pubkeyHex: string | null;
  /** Npub (NIP-19 bech32 encoded public key) */
  npub: string | null;
  /** Hex private key — needed to pass to MarmotClient signer */
  privateKeyHex: string | null;
  /** 128-bit seed hex for BIP-39 mnemonic backup (null for legacy identities without seed) */
  seedHex: string | null;
  /** Whether the identity has been backed up with a seed phrase */
  backedUp: boolean;
  /** Replace identity (e.g. after seed phrase restore) */
  replaceIdentity: (identity: StoredNostrIdentity) => Promise<void>;
};

const NostrIdentityContext = createContext<NostrIdentityContextValue | null>(null);

export function NostrIdentityProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [identity, setIdentity] = useState<StoredNostrIdentity | null>(null);
  const [backedUp, setBackedUp] = useState(false);

  // Initialize identity on client
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Check backed-up status
      const isBackedUp =
        typeof localStorage !== 'undefined' &&
        localStorage.getItem(STORAGE_KEYS.nostrBackedUp) === 'true';

      setBackedUp(isBackedUp);

      // Load or generate identity
      let stored = loadStoredIdentity();

      if (!stored) {
        // First launch: generate keypair from 128-bit seed
        const { seedHex, privateKeyHex } = await generateIdentityFromSeed();
        const pubkeyHex = await derivePublicKeyHex(privateKeyHex);
        stored = { privateKeyHex, pubkeyHex, seedHex };
        saveStoredIdentity(stored);
      }

      if (cancelled) return;
      setIdentity(stored);
      setHydrated(true);

      // Background: publish kind 0 + KeyPackages (non-blocking)
      void publishIdentityToRelays(stored).catch((err) => {
        console.warn('[NostrIdentity] Background publish failed:', err);
      });
    }

    void init();
    return () => { cancelled = true; };
  }, []);

  const replaceIdentity = useCallback(async (newIdentity: StoredNostrIdentity) => {
    saveStoredIdentity(newIdentity);
    setIdentity(newIdentity);
    // Re-publish kind 0 + KeyPackages for restored identity
    void publishIdentityToRelays(newIdentity).catch((err) => {
      console.warn('[NostrIdentity] Re-publish after restore failed:', err);
    });
  }, []);

  const value = useMemo<NostrIdentityContextValue>(
    () => ({
      hydrated,
      pubkeyHex: identity?.pubkeyHex ?? null,
      npub: identity ? pubkeyToNpub(identity.pubkeyHex) : null,
      privateKeyHex: identity?.privateKeyHex ?? null,
      seedHex: identity?.seedHex ?? null,
      backedUp,
      replaceIdentity,
    }),
    [hydrated, identity, backedUp, replaceIdentity]
  );

  return (
    <NostrIdentityContext.Provider value={value}>
      {children}
    </NostrIdentityContext.Provider>
  );
}

const NOOP_REPLACE: NostrIdentityContextValue['replaceIdentity'] = async () => {};

const DEFAULT_CONTEXT: NostrIdentityContextValue = {
  hydrated: false,
  pubkeyHex: null,
  npub: null,
  privateKeyHex: null,
  seedHex: null,
  backedUp: false,
  replaceIdentity: NOOP_REPLACE,
};

export function useNostrIdentity(): NostrIdentityContextValue {
  const context = useContext(NostrIdentityContext);
  // Return safe defaults when called outside provider (e.g., during dynamic load)
  return context ?? DEFAULT_CONTEXT;
}

// ---------------------------------------------------------------------------
// Internal: background relay publishing
// ---------------------------------------------------------------------------

async function publishIdentityToRelays(stored: StoredNostrIdentity): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const { connectNdk } = await import('@/src/lib/ndkClient');
    const NDK = await import('@nostr-dev-kit/ndk');
    const ndk = await connectNdk(stored.privateKeyHex);

    // Publish kind 0 metadata
    const profile = readUserProfile();
    const metadataEvent = new NDK.NDKEvent(ndk, {
      kind: 0,
      content: JSON.stringify({
        name: profile.nickname || 'Quizzl User',
        about: 'Learning with Quizzl',
        client: 'quizzl',
      }),
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    });

    await metadataEvent.sign();
    await metadataEvent.publish().catch((err) => {
      console.warn('[NostrIdentity] kind 0 publish failed:', err);
    });
  } catch (err) {
    console.warn('[NostrIdentity] publishIdentityToRelays failed:', err);
    // Non-fatal — identity is still valid locally
  }
}
