import { useEffect, useRef } from 'react';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { initDirectMessageCounts } from '@/src/lib/unreadStore';
import { readStoredContacts } from '@/src/lib/contacts';
import { useMarmot } from '@/src/context/MarmotContext';
import { isAllowedDmSender } from '@/src/lib/walledGarden';
import { loadKnownPeers } from '@/src/lib/knownPeers';

export default function DirectMessageNotificationsWatcher() {
  const { hydrated, pubkeyHex, privateKeyHex } = useNostrIdentity();
  const { groups, knownPeersRevision } = useMarmot();

  // Live ref keeps the gate current without recreating the subscription on
  // every group membership change. Pattern matches ContactChat.tsx groupsRef.
  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  // Ever-known peers ref — refreshed whenever groups change (when MarmotContext's
  // maintenance effect may have updated lp_knownPeers_v1) OR when
  // knownPeersRevision bumps (an out-of-band write, e.g. manual add-contact-by-npub,
  // that doesn't correlate with a groups change).
  const knownPeersRef = useRef(loadKnownPeers());
  useEffect(() => { knownPeersRef.current = loadKnownPeers(); }, [groups, knownPeersRevision]);

  useEffect(() => {
    if (!hydrated || !pubkeyHex || !privateKeyHex) return;
    if (typeof window === 'undefined') return;
    if (!globalThis.isSecureContext) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const ownPubkey = pubkeyHex;

    void (async () => {
      try {
        const peerPubkeys = Object.keys(readStoredContacts())
          .filter((pk) => pk.toLowerCase() !== ownPubkey.toLowerCase());
        await initDirectMessageCounts(peerPubkeys, ownPubkey);

        const { connectNdk } = await import('@/src/lib/ndkClient');
        const ndk = await connectNdk(privateKeyHex);
        if (cancelled) return;

        const { subscribeDirectMessageNotifications } = await import(
          '@/src/lib/directMessageNotifications'
        );
        // groupsRef.current is always up-to-date: the separate effect above
        // keeps it in sync with the latest groups array without triggering a
        // subscription teardown/rebuild on every membership change.
        unsubscribe = subscribeDirectMessageNotifications({
          ndk,
          ownPubkeyHex: ownPubkey,
          privateKeyHex,
          isAllowedSender: (peer) => isAllowedDmSender(peer, groupsRef.current, knownPeersRef.current, ownPubkey),
        });
      } catch (err) {
        console.warn('[DMNotifications] subscribe failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [hydrated, pubkeyHex, privateKeyHex]); // groups intentionally omitted — live ref handles updates

  return null;
}
