/**
 * useOnlineStatus — tracks browser online/offline status.
 *
 * Returns { isOnline, lastOnlineAt }.
 * lastOnlineAt is updated whenever the browser transitions from offline → online.
 */
import { useEffect, useState } from 'react';

export type OnlineStatus = {
  isOnline: boolean;
  /** ISO string of last time we were online. null if never tracked yet. */
  lastOnlineAt: string | null;
};

export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [lastOnlineAt, setLastOnlineAt] = useState<string | null>(
    typeof navigator !== 'undefined' && navigator.onLine
      ? new Date().toISOString()
      : null
  );

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      setLastOnlineAt(new Date().toISOString());
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, lastOnlineAt };
}
