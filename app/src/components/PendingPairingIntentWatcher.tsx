/**
 * PendingPairingIntentWatcher.tsx — always-mounted retry trigger for held
 * pairing-ack echoes (epic: contact-pairing-code, story S4; AC-SCAN-3).
 *
 * architecture.md's "pending intent" module row requires the retry queue to
 * be drained "on window 'online' + on app mount". `pendingIntent.ts` itself
 * stays a React-free stateless adapter (matching `nonceStore.ts`'s
 * precedent), so this component is the minimal wiring that satisfies that
 * requirement — it owns no state and renders nothing, exactly mirroring
 * `DirectMessageNotificationsWatcher.tsx`'s shape (identity-gated effect,
 * `window.addEventListener('online', …)`, dynamic imports for the
 * heavy NDK/signer modules so they never load until actually needed).
 *
 * A drain attempt here is a no-op whenever there is nothing persisted to
 * drain (the common case) or the local profile still has no shareable name
 * (drainPendingIntents leaves those intents untouched) — so mounting this
 * unconditionally on every page carries negligible cost.
 */
import { useEffect } from 'react';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useProfile } from '@/src/context/ProfileContext';
import { drainPendingIntents, type PendingIntentSendContext } from '@/src/lib/pairing/pendingIntent';

export default function PendingPairingIntentWatcher() {
  const { hydrated, pubkeyHex, privateKeyHex } = useNostrIdentity();
  const { profile } = useProfile();

  useEffect(() => {
    if (!hydrated || !pubkeyHex || !privateKeyHex) return;
    if (typeof window === 'undefined') return;

    const ownPubkeyHex = pubkeyHex;
    const ownPrivateKeyHex = privateKeyHex;

    function buildCtx(): PendingIntentSendContext {
      return {
        ownPubkeyHex,
        ownPrivateKeyHex,
        ownProfile: { nickname: profile.nickname, createdAt: Math.floor(Date.now() / 1000) },
        resolveSendDeps: async () => {
          const [{ connectNdk }, { activeEventSignerOverride, createPrivateKeySigner }] = await Promise.all([
            import('@/src/lib/ndkClient'),
            import('@/src/lib/marmot/signerAdapter'),
          ]);
          const ndk = await connectNdk(ownPrivateKeyHex);
          const signer = activeEventSignerOverride.current ?? createPrivateKeySigner(ownPrivateKeyHex);
          return { ndk, signEvent: signer.signEvent };
        },
      };
    }

    function drain() {
      void drainPendingIntents(buildCtx()).catch((err) => {
        console.warn('[PendingPairingIntentWatcher] drain failed:', err);
      });
    }

    // On app mount (this effect's own run) — retries anything left over from
    // a prior session (e.g. a send that failed while offline last time).
    drain();

    // On reconnect (AC-SCAN-3).
    window.addEventListener('online', drain);
    return () => {
      window.removeEventListener('online', drain);
    };
  }, [hydrated, pubkeyHex, privateKeyHex, profile.nickname]);

  return null;
}
