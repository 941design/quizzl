import React, { useEffect, useState } from 'react';
import {
  Box,
  Heading,
  Text,
  VStack,
  Button,
  Input,
  Alert,
  AlertIcon,
  AlertDescription,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { useCopy } from '@/src/context/LanguageContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { useProfile } from '@/src/context/ProfileContext';
import { npubToPubkeyHex } from '@/src/lib/nostrKeys';
import { sendJoinRequest } from '@/src/lib/marmot/joinRequestSender';
import { hasShareableName } from '@/src/lib/shareCard';

type JoinRequestCardProps = {
  nonce: string;
  adminNpub: string;
  groupName: string;
};

// Pure predicates for the name gate (S1) — kept outside the component so they
// can be unit-tested without a DOM/render environment (this repo has no
// jsdom/@testing-library capability). `hasShareableName` is the single source
// of truth for "has a name"; these delegate rather than re-deriving it.
export function isNameGateActive(savedNickname: string): boolean {
  return !hasShareableName(savedNickname);
}

export function isJoinRequestDisabled(gateActive: boolean, draftName: string): boolean {
  return gateActive && !hasShareableName(draftName);
}

export default function JoinRequestCard({ nonce, adminNpub, groupName }: JoinRequestCardProps) {
  const copy = useCopy();
  const { pubkeyHex, privateKeyHex, hydrated } = useNostrIdentity();
  const { groups } = useMarmot();
  const { profile, saveProfile } = useProfile();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(profile.nickname);

  useEffect(() => {
    setNameDraft(profile.nickname);
  }, [profile.nickname]);

  const gateActive = isNameGateActive(profile.nickname);
  const requestDisabled = isJoinRequestDisabled(gateActive, nameDraft);

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
    if (requestDisabled) return;

    if (gateActive) {
      saveProfile({ ...profile, nickname: nameDraft });
    }

    setSending(true);
    setError(null);

    try {
      await sendJoinRequest({
        requesterPubkeyHex: pubkeyHex,
        adminPubkeyHex,
        nonce,
        groupName,
        requesterPrivateKeyHex: privateKeyHex,
        requesterName: nameDraft,
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

        {gateActive && (
          <Box data-testid="join-request-name-gate">
            <Text fontWeight="semibold" mb={1}>
              {copy.groups.joinRequestNameLabel}
            </Text>
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              bg="surfaceBg"
              data-testid="join-request-name-input"
            />
            <Text fontSize="sm" color="textMuted" mt={1}>
              {copy.groups.joinRequestNameHelper}
            </Text>
            {requestDisabled && (
              <Text fontSize="xs" color="textMuted" mt={1} data-testid="join-request-name-required-hint">
                {copy.groups.joinRequestNameRequiredHint}
              </Text>
            )}
          </Box>
        )}

        {error && (
          <Alert status="error" borderRadius="md">
            <AlertIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={() => void handleSendRequest()}
          isLoading={sending}
          isDisabled={requestDisabled}
          size="lg"
          data-testid="join-request-send-btn"
        >
          {copy.groups.joinRequestButton}
        </Button>
      </VStack>
    </Box>
  );
}
