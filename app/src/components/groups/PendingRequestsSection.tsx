import React, { useEffect, useState } from 'react';
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
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
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

  return (
    <Box data-testid={`pending-request-row-${request.eventId}`}>
      <HStack spacing={3} py={2} px={3} bg="surfaceMutedBg" borderRadius="md">
        <Box flex="1" minW={0}>
          <Text fontSize="sm" fontWeight="semibold" isTruncated>
            {request.nickname ?? truncateNpub(npub)}
          </Text>
          {request.nickname && (
            <Text fontSize="xs" color="textMuted" isTruncated>
              {truncateNpub(npub)}
            </Text>
          )}
        </Box>
        <HStack spacing={2} flexShrink={0}>
          <Button
            size="xs"
            colorScheme="green"
            onClick={() => onApprove(request)}
            isLoading={approving}
            data-testid={`approve-request-${request.eventId}`}
          >
            {copy.groups.pendingRequestsApprove}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onDeny(request)}
            isDisabled={approving}
            data-testid={`deny-request-${request.eventId}`}
          >
            {copy.groups.pendingRequestsDeny}
          </Button>
        </HStack>
      </HStack>
      {error && (
        <Alert status="error" mt={1} borderRadius="md" py={1} px={3}>
          <AlertDescription fontSize="xs">{copy.groups.pendingRequestsApproveError}</AlertDescription>
        </Alert>
      )}
    </Box>
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
