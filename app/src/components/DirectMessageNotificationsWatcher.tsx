import { useEffect } from 'react';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { initDirectMessageCounts } from '@/src/lib/unreadStore';
import { readStoredContacts } from '@/src/lib/contacts';

export default function DirectMessageNotificationsWatcher() {
  const { hydrated, pubkeyHex, privateKeyHex } = useNostrIdentity();

  useEffect(() => {
    if (!hydrated || !pubkeyHex || !privateKeyHex) return;
    if (typeof window === 'undefined') return;
    if (!globalThis.isSecureContext) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      try {
        const peerPubkeys = Object.keys(readStoredContacts())
          .filter((pk) => pk.toLowerCase() !== pubkeyHex.toLowerCase());
        await initDirectMessageCounts(peerPubkeys, pubkeyHex);

        const { connectNdk } = await import('@/src/lib/ndkClient');
        const ndk = await connectNdk(privateKeyHex);
        if (cancelled) return;

        const { subscribeDirectMessageNotifications } = await import(
          '@/src/lib/directMessageNotifications'
        );
        unsubscribe = subscribeDirectMessageNotifications({ ndk, ownPubkeyHex: pubkeyHex, privateKeyHex });
      } catch (err) {
        console.warn('[DMNotifications] subscribe failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [hydrated, pubkeyHex, privateKeyHex]);

  return null;
}
