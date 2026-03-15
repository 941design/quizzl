import React, { useEffect, useState } from 'react';
import { Alert, AlertIcon, AlertTitle, AlertDescription, CloseButton, Box } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { isStorageAvailable } from '@/src/lib/storage';

export default function StorageWarning() {
  const copy = useCopy();
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
        <AlertTitle>{copy.storage.title}</AlertTitle>
        <AlertDescription>
          {copy.storage.description}
        </AlertDescription>
      </Box>
      <CloseButton
        alignSelf="flex-start"
        onClick={() => setShow(false)}
        aria-label={copy.storage.dismiss}
      />
    </Alert>
  );
}
