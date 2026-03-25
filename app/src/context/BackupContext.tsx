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
  const { privateKeyHex, pubkeyHex } = useNostrIdentity();
  const schedulerRef = useRef<BackupScheduler | null>(null);

  useEffect(() => {
    if (!privateKeyHex || !pubkeyHex) return;

    const currentPubkey = pubkeyHex;
    const currentPrivKey = privateKeyHex;

    const scheduler = new BackupScheduler(async () => {
      const { createPrivateKeySigner } = await import('@/src/lib/marmot/signerAdapter');
      const signer = createPrivateKeySigner(currentPrivKey);
      // Get NDK instance (should already be connected if groups are active)
      const { getNdk } = await import('@/src/lib/ndkClient');
      const ndk = getNdk();
      if (!ndk) return;
      await publishBackup(signer, currentPubkey, ndk);
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
  }, [privateKeyHex, pubkeyHex]);

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
