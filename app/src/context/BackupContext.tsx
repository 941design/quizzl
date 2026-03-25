/**
 * BackupContext — provides BackupScheduler lifecycle and markDirty to the app.
 *
 * Wraps a BackupScheduler that calls publishBackup when state changes.
 * Other contexts (MarmotContext, ProfileContext) call markDirty to trigger
 * a debounced backup publish.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { BackupScheduler, publishBackup } from '@/src/lib/backup/relayBackup';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';

type BackupContextValue = {
  markDirty: (immediate?: boolean) => void;
};

const BackupContext = createContext<BackupContextValue | null>(null);

export function BackupProvider({ children }: { children: React.ReactNode }) {
  const { signer, identity } = useNostrIdentity();
  const schedulerRef = useRef<BackupScheduler | null>(null);

  useEffect(() => {
    if (!signer || !identity?.pubkeyHex) return;

    const pubkeyHex = identity.pubkeyHex;
    const currentSigner = signer;

    const scheduler = new BackupScheduler(async () => {
      const { connectNdk } = await import('@/src/lib/ndkClient');
      // We need the private key for NDK connection, but we only have the signer.
      // publishBackup uses the signer for encryption and NDK for relay publishing.
      // Get NDK instance (should already be connected if groups are active)
      const { getNdk } = await import('@/src/lib/ndkClient');
      const ndk = getNdk();
      if (!ndk) return;
      await publishBackup(currentSigner, pubkeyHex, ndk);
    });

    schedulerRef.current = scheduler;

    // Visibility change listener — backup on page hide
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        scheduler.markDirty(true);
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [signer, identity?.pubkeyHex]);

  const markDirty = useCallback((immediate?: boolean) => {
    schedulerRef.current?.markDirty(immediate);
  }, []);

  return (
    <BackupContext.Provider value={{ markDirty }}>
      {children}
    </BackupContext.Provider>
  );
}

export function useBackup(): BackupContextValue {
  const context = useContext(BackupContext);
  if (!context) {
    // Return a no-op if not wrapped in provider (e.g. during testing)
    return { markDirty: () => {} };
  }
  return context;
}
