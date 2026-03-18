import React, { useState, useEffect } from 'react';
import {
  Alert,
  AlertIcon,
  AlertDescription,
  CloseButton,
  Box,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useOnlineStatus } from '@/src/hooks/useOnlineStatus';

/**
 * Shows a dismissible offline banner. Re-shows automatically when connectivity changes.
 */
export default function OfflineBanner() {
  const copy = useCopy();
  const { isOnline, lastOnlineAt } = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);

  // Re-show banner whenever we go offline
  useEffect(() => {
    if (!isOnline) {
      setDismissed(false);
    }
  }, [isOnline]);

  if (isOnline || dismissed) return null;

  const lastSyncLabel = lastOnlineAt
    ? copy.groups.offlineLastSync(new Date(lastOnlineAt).toLocaleTimeString())
    : null;

  return (
    <Alert
      status="warning"
      borderRadius="md"
      mb={4}
      data-testid="offline-banner"
    >
      <AlertIcon />
      <Box flex="1">
        <AlertDescription fontSize="sm">
          {copy.groups.offlineBanner}
          {lastSyncLabel && (
            <Box as="span" ml={1} opacity={0.7}>
              {lastSyncLabel}
            </Box>
          )}
        </AlertDescription>
      </Box>
      <CloseButton
        alignSelf="flex-start"
        onClick={() => setDismissed(true)}
        data-testid="offline-banner-dismiss"
      />
    </Alert>
  );
}
