import React, { useState } from 'react';
import {
  Alert,
  AlertIcon,
  AlertDescription,
  CloseButton,
  HStack,
  Button,
  Box,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { useCopy } from '@/src/context/LanguageContext';

/** Session-dismissible banner reminding user to back up their identity */
export default function BackupReminderBanner() {
  const copy = useCopy();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <Alert
      status="warning"
      borderRadius="md"
      mb={4}
      data-testid="backup-reminder-banner"
    >
      <AlertIcon />
      <Box flex="1">
        <AlertDescription fontSize="sm">
          <strong>{copy.identity.backupReminderTitle}:</strong>{' '}
          {copy.identity.backupReminderBody}
        </AlertDescription>
        <HStack mt={2} spacing={2}>
          <NextLink href="/settings" passHref legacyBehavior>
            <Button as="a" size="xs" colorScheme="warning" variant="solid">
              {copy.identity.backupReminderAction}
            </Button>
          </NextLink>
        </HStack>
      </Box>
      <CloseButton
        alignSelf="flex-start"
        onClick={() => setDismissed(true)}
        aria-label={copy.identity.backupReminderDismiss}
        data-testid="backup-reminder-dismiss"
      />
    </Alert>
  );
}
