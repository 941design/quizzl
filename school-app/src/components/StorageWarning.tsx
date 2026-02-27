import React, { useEffect, useState } from 'react';
import { Alert, AlertIcon, AlertTitle, AlertDescription, CloseButton, Box } from '@chakra-ui/react';
import { isStorageAvailable } from '@/src/lib/storage';

export default function StorageWarning() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isStorageAvailable()) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <Alert status="warning" mb={4} borderRadius="md" data-testid="storage-warning">
      <AlertIcon />
      <Box flex="1">
        <AlertTitle>Storage Unavailable</AlertTitle>
        <AlertDescription>
          Your browser&apos;s local storage is not available (private mode?).
          The app will work, but your progress and settings won&apos;t be saved between sessions.
        </AlertDescription>
      </Box>
      <CloseButton
        alignSelf="flex-start"
        onClick={() => setShow(false)}
        aria-label="Dismiss warning"
      />
    </Alert>
  );
}
