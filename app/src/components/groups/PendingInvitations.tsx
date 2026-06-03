/**
 * PendingInvitations — displays pending MLS Welcome invitations on the Groups
 * list page so the user can explicitly Accept or Decline each one.
 *
 * AC-INVITE-4: shows ONLY the truncated inviter pubkey (first 8 + last 8 hex
 *   chars) and a relative timestamp. No display name, avatar, or group name.
 * AC-INVITE-7: renders above the joined-groups list; shows empty-state when
 *   no invitations are pending.
 * AC-INVITE-5 / AC-INVITE-6: Accept / Decline routed via MarmotContext.
 * AC-REACT-6: reactive via useSyncExternalStore over the pendingInvitations
 *   module-level store — no polling, no new React context layer.
 */

import React, { useSyncExternalStore, useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Heading,
  Alert,
  AlertDescription,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import {
  subscribe,
  getSnapshot,
} from '@/src/lib/pendingInvitations';
import type { PendingInvitation } from '@/src/lib/pendingInvitations';

// ─── Relative time helper (i18n-aware) ───────────────────────────────────────

type RelativeCopy = {
  relativeJustNow: string;
  relativeMinutesAgo: (n: number) => string;
  relativeHoursAgo: (n: number) => string;
  relativeDaysAgo: (n: number) => string;
};

function relativeTime(receivedAt: number, copy: RelativeCopy): string {
  const diffMs = Date.now() - receivedAt;
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return copy.relativeJustNow;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return copy.relativeMinutesAgo(diffMinutes);
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return copy.relativeHoursAgo(diffHours);
  const diffDays = Math.floor(diffHours / 24);
  return copy.relativeDaysAgo(diffDays);
}

// ─── Server snapshot (SSR-safe) ───────────────────────────────────────────────

function getServerSnapshot(): ReadonlyArray<PendingInvitation> {
  return [];
}

// ─── Row component ────────────────────────────────────────────────────────────

type PendingInvitationRowProps = {
  invitation: PendingInvitation;
  onAccept: (id: string) => Promise<void>;
  onDecline: (id: string) => void;
  accepting: boolean;
  error?: string;
};

function PendingInvitationRow({
  invitation,
  onAccept,
  onDecline,
  accepting,
  error,
}: PendingInvitationRowProps) {
  const copy = useCopy();
  const pk = invitation.inviterPubkeyHex;
  // AC-INVITE-4: only show first 8 + last 8 hex chars — no names or avatars
  const truncatedPubkey =
    pk.length >= 16 ? `${pk.slice(0, 8)}…${pk.slice(-8)}` : pk;

  return (
    <Box data-testid={`pending-invitation-row-${invitation.id}`}>
      <HStack spacing={3} py={2} px={3} bg="surfaceMutedBg" borderRadius="md">
        <Box flex="1" minW={0}>
          <Text fontSize="sm" fontWeight="semibold" isTruncated>
            {truncatedPubkey}
          </Text>
          <Text fontSize="xs" color="textMuted">
            {relativeTime(invitation.receivedAt, copy.groups.pendingInvitations)}
          </Text>
        </Box>
        <HStack spacing={2} flexShrink={0}>
          <Button
            size="xs"
            colorScheme="green"
            onClick={() => void onAccept(invitation.id)}
            isLoading={accepting}
            data-testid={`accept-invitation-${invitation.id}`}
          >
            {copy.groups.pendingInvitations.acceptBtn}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onDecline(invitation.id)}
            isDisabled={accepting}
            data-testid={`decline-invitation-${invitation.id}`}
          >
            {copy.groups.pendingInvitations.declineBtn}
          </Button>
        </HStack>
      </HStack>
      {error && (
        <Alert status="error" mt={1} borderRadius="md" py={1} px={3}>
          <AlertDescription fontSize="xs">
            {copy.groups.pendingInvitations.acceptError}
          </AlertDescription>
        </Alert>
      )}
    </Box>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Renders the pending invitation queue above the joined-groups list.
 *
 * Reactivity: uses useSyncExternalStore with the module-level pendingInvitations
 * store (same pattern as unreadStore.ts) — no polling, no context.
 */
export default function PendingInvitations() {
  const copy = useCopy();
  const { acceptPendingInvitation, declinePendingInvitation } = useMarmot();

  // AC-REACT-6: reactive via module-level store — updates within 2s of relay delivery
  const invitations = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleAccept = async (id: string) => {
    setAcceptingId(id);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await acceptPendingInvitation(id);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'unknown',
      }));
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDecline = (id: string) => {
    void declinePendingInvitation(id);
  };

  return (
    <Box data-testid="pending-invitations-section" mb={invitations.length > 0 ? 6 : 2}>
      <Heading as="h2" size="md" mb={3}>
        {copy.groups.pendingInvitations.heading}
      </Heading>

      {invitations.length === 0 ? (
        // AC-INVITE-7: show visible empty-state (not null, not hidden via CSS)
        <Text
          fontSize="sm"
          color="textMuted"
          data-testid="pending-invitations-empty"
        >
          {copy.groups.pendingInvitations.empty}
        </Text>
      ) : (
        <VStack spacing={2} align="stretch">
          {invitations.map((inv) => (
            <PendingInvitationRow
              key={inv.id}
              invitation={inv}
              onAccept={handleAccept}
              onDecline={handleDecline}
              accepting={acceptingId === inv.id}
              error={errors[inv.id]}
            />
          ))}
        </VStack>
      )}
    </Box>
  );
}
