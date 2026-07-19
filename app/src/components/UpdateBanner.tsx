import React, { useState } from 'react';
import {
  Alert,
  AlertIcon,
  AlertDescription,
  Button,
  CloseButton,
  Box,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';

type UpdateBannerProps = {
  updateAvailable: boolean;
};

/**
 * Non-blocking dismissible banner shown when a new version is available.
 * Modelled on OfflineBanner.tsx.
 *
 * Returns null when updateAvailable is false or the user has dismissed it.
 * Dismissed state is session-only (not persisted to storage).
 */
export default function UpdateBanner({ updateAvailable }: UpdateBannerProps) {
  const copy = useCopy();
  const [dismissed, setDismissed] = useState(false);

  if (!updateAvailable || dismissed) return null;

  return (
    <Alert
      status="info"
      borderRadius="md"
      mb={4}
      data-testid="update-banner"
    >
      <AlertIcon />
      <Box flex="1">
        <AlertDescription fontSize="sm">
          {copy.updateBanner.message}
        </AlertDescription>
      </Box>
      <Button
        size="sm"
        variant="solid"
        colorScheme="brand"
        mr={2}
        onClick={() => window.location.reload()}
        data-testid="update-banner-reload"
      >
        {copy.updateBanner.reload}
      </Button>
      <CloseButton
        alignSelf="flex-start"
        onClick={() => setDismissed(true)}
        aria-label={copy.updateBanner.dismissAriaLabel}
        data-testid="update-banner-dismiss"
      />
    </Alert>
  );
}
