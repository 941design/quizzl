import React, { useEffect, useState } from 'react';
import {
  Box,
  VStack,
  Text,
  Heading,
  Alert,
  AlertDescription,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import UserCard, { ConfirmButton, RejectButton } from '@/src/components/UserCard';
import type { UserProfile } from '@/src/types';
import type { PendingJoinRequest } from '@/src/lib/marmot/joinRequestStorage';

type PendingRequestRowProps = {
  request: PendingJoinRequest;
  onApprove: (request: PendingJoinRequest) => void;
  onDeny: (request: PendingJoinRequest) => void;
  approving: boolean;
  error?: string;
};

function PendingRequestRow({ request, onApprove, onDeny, approving, error }: PendingRequestRowProps) {
  const copy = useCopy();
  const npub = pubkeyToNpub(request.pubkeyHex);
  const fallbackName = truncateNpub(npub);
  const cardProfile: UserProfile = {
    nickname: request.nickname ?? '',
    avatar: null,
  };

  return (
    <UserCard
      profile={cardProfile}
      fallbackName={fallbackName}
      cardTestId={`pending-request-row-${request.eventId}`}
      subline={request.nickname ? (
        <Text mt={1} fontSize="xs" color="textMuted" isTruncated>
          {fallbackName}
        </Text>
      ) : null}
      actions={
        <>
          <ConfirmButton
            onClick={() => onApprove(request)}
            isLoading={approving}
            data-testid={`approve-request-${request.eventId}`}
          >
            {copy.groups.pendingRequestsApprove}
          </ConfirmButton>
          <RejectButton
            onClick={() => onDeny(request)}
            isDisabled={approving}
            data-testid={`deny-request-${request.eventId}`}
          >
            {copy.groups.pendingRequestsDeny}
          </RejectButton>
        </>
      }
      footer={error ? (
        <Alert status="error" mt={2} borderRadius="md" py={1} px={3}>
          <AlertDescription fontSize="xs">{copy.groups.pendingRequestsApproveError}</AlertDescription>
        </Alert>
      ) : null}
    />
  );
}

type PendingRequestsSectionProps = {
  groupId: string;
};

export default function PendingRequestsSection({ groupId }: PendingRequestsSectionProps) {
  const copy = useCopy();
  const { pendingRequests, loadPendingRequestsForGroup, approveJoinRequest, denyJoinRequest } = useMarmot();
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadPendingRequestsForGroup(groupId);
  }, [groupId, loadPendingRequestsForGroup]);

  const requests = pendingRequests[groupId] ?? [];

  if (requests.length === 0) return null;

  const handleApprove = async (request: PendingJoinRequest) => {
    setApprovingId(request.eventId);
    setErrors((prev) => { const next = { ...prev }; delete next[request.eventId]; return next; });
    const result = await approveJoinRequest(request);
    if (!result.ok) {
      setErrors((prev) => ({ ...prev, [request.eventId]: result.error ?? 'unknown' }));
    }
    setApprovingId(null);
  };

  const handleDeny = async (request: PendingJoinRequest) => {
    await denyJoinRequest(request);
  };

  return (
    <Box data-testid="pending-requests-section">
      <Heading as="h2" size="md" mb={3}>
        {copy.groups.pendingRequestsHeading}
      </Heading>
      <VStack spacing={2} align="stretch">
        {requests.map((req) => (
          <PendingRequestRow
            key={req.eventId}
            request={req}
            onApprove={handleApprove}
            onDeny={handleDeny}
            approving={approvingId === req.eventId}
            error={errors[req.eventId]}
          />
        ))}
      </VStack>
    </Box>
  );
}
