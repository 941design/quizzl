import React, { useState } from 'react';
import {
  Box,
  Heading,
  Text,
  VStack,
  Button,
  Alert,
  AlertIcon,
  AlertDescription,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { useCopy } from '@/src/context/LanguageContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { npubToPubkeyHex } from '@/src/lib/nostrKeys';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { sendJoinRequest } from '@/src/lib/marmot/joinRequestSender';

type JoinRequestCardProps = {
  nonce: string;
  adminNpub: string;
  groupName: string;
};

export default function JoinRequestCard({ nonce, adminNpub, groupName }: JoinRequestCardProps) {
  const copy = useCopy();
  const { pubkeyHex, privateKeyHex, hydrated } = useNostrIdentity();
  const { groups } = useMarmot();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adminPubkeyHex = npubToPubkeyHex(adminNpub);

  // Check if the user is already a member of the specific group referenced by this invite link.
  // Match on both admin membership AND group name to avoid blocking joins to a different group
  // when the admin runs multiple groups.
  const alreadyMemberGroupId = adminPubkeyHex
    ? groups.find((g) => g.name === groupName && g.memberPubkeys.includes(adminPubkeyHex) && pubkeyHex && g.memberPubkeys.includes(pubkeyHex))?.id
    : null;

  if (!hydrated) {
    return (
      <Box py={8} textAlign="center">
        <Text color="textMuted">{copy.groups.loading}</Text>
      </Box>
    );
  }

  if (!pubkeyHex || !privateKeyHex) {
    // Identity not ready — the standard identity setup should run first
    // (handled by NostrIdentityProvider auto-generating on first mount)
    return (
      <Box py={8} textAlign="center">
        <Text color="textMuted">{copy.identity.notReady}</Text>
      </Box>
    );
  }

  if (!adminPubkeyHex) {
    return (
      <Box py={8}>
        <Alert status="error" borderRadius="md">
          <AlertIcon />
          <AlertDescription>{copy.groups.inviteErrorInvalidNpub}</AlertDescription>
        </Alert>
      </Box>
    );
  }

  if (alreadyMemberGroupId) {
    return (
      <Box py={8} data-testid="join-request-already-member">
        <Alert status="info" borderRadius="md">
          <AlertIcon />
          <AlertDescription>
            {copy.groups.joinRequestAlreadyMember}{' '}
            <NextLink href={`/groups?id=${alreadyMemberGroupId}`} passHref legacyBehavior>
              <Button as="a" variant="link" size="sm">
                {copy.groups.joinRequestGoToGroup}
              </Button>
            </NextLink>
          </AlertDescription>
        </Alert>
      </Box>
    );
  }

  async function handleSendRequest() {
    if (!pubkeyHex || !privateKeyHex || !adminPubkeyHex) return;

    setSending(true);
    setError(null);

    try {
      const signer = createPrivateKeySigner(privateKeyHex);
      await sendJoinRequest({
        requesterPubkeyHex: pubkeyHex,
        adminPubkeyHex,
        nonce,
        groupName,
        signer,
      });
      setSent(true);
    } catch (err) {
      console.error('[JoinRequestCard] Failed to send join request:', err);
      setError(copy.groups.joinRequestError);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <Box py={8} data-testid="join-request-sent">
        <Alert status="success" borderRadius="md">
          <AlertIcon />
          <AlertDescription>{copy.groups.joinRequestSent}</AlertDescription>
        </Alert>
      </Box>
    );
  }

  return (
    <Box py={8} data-testid="join-request-card">
      <VStack spacing={4} align="stretch" maxW="md" mx="auto">
        <Heading as="h2" size="lg" textAlign="center">
          {copy.groups.joinRequestHeading}
        </Heading>
        <Text textAlign="center" fontSize="lg">
          <strong>{groupName}</strong>
        </Text>
        <Text textAlign="center" color="textMuted">
          {copy.groups.joinRequestDescription}
        </Text>

        {error && (
          <Alert status="error" borderRadius="md">
            <AlertIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={() => void handleSendRequest()}
          isLoading={sending}
          size="lg"
          data-testid="join-request-send-btn"
        >
          {copy.groups.joinRequestButton}
        </Button>
      </VStack>
    </Box>
  );
}
