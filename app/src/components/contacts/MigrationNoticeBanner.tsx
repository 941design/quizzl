/**
 * MigrationNoticeBanner — AC-MIGRATE-5 (Walled Garden v2, S3).
 *
 * Displays a one-time dismissible info banner on the contacts page when the S3
 * migration backfill has completed and the user has not yet acknowledged the
 * notice. The banner renders only static i18n text — no pubkeys or user-derived
 * content are ever displayed.
 *
 * Dismissal writes `lp_knownPeersMigrationNoticeAck_v1` to localStorage so
 * the banner remains hidden on subsequent page loads.
 */

import React, { useState } from 'react';
import { Alert, AlertDescription, CloseButton } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import {
  acknowledgeMigrationNotice,
  isMigrationNoticeAcknowledged,
  knownPeersMigrationComplete,
} from '@/src/lib/knownPeers';

export function MigrationNoticeBanner() {
  const copy = useCopy();
  const [dismissed, setDismissed] = useState(() => isMigrationNoticeAcknowledged());

  // Only show if: migration completed AND notice not yet acknowledged.
  if (!knownPeersMigrationComplete() || dismissed) return null;

  function handleDismiss() {
    acknowledgeMigrationNotice();
    setDismissed(true);
  }

  return (
    <Alert
      status="info"
      borderRadius="md"
      mb={4}
      data-testid="migration-notice-banner"
    >
      <AlertDescription flex="1">
        {copy.groups.pendingInvitations.migrationNotice.body}
      </AlertDescription>
      <CloseButton
        aria-label={copy.groups.pendingInvitations.migrationNotice.dismissBtn}
        onClick={handleDismiss}
        data-testid="migration-notice-dismiss"
      />
    </Alert>
  );
}
