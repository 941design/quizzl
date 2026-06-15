import React, { useMemo } from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { Box, Button, Heading, Text } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useProfile } from '@/src/context/ProfileContext';
import ContactChat from '@/src/components/contacts/ContactChat';
import { MAINTAINER_ACTIVE_PUBKEY_HEX, MAINTAINER_DISPLAY_NAME } from '@/src/config/maintainer';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import type { MemberProfile } from '@/src/types';

export default function FeedbackPage() {
  const copy = useCopy();
  const { pubkeyHex, privateKeyHex } = useNostrIdentity();
  const { profile: ownProfile } = useProfile();

  const signer = useMemo(
    () => (privateKeyHex ? createPrivateKeySigner(privateKeyHex) : null),
    [privateKeyHex],
  );

  if (!MAINTAINER_ACTIVE_PUBKEY_HEX) {
    return (
      <>
        <Head>
          <title>{`${copy.feedback.pageTitle} - ${copy.appName}`}</title>
        </Head>
        <Box data-testid="feedback-unavailable">
          <Text color="textMuted">{copy.feedback.unavailableState}</Text>
        </Box>
      </>
    );
  }

  if (!pubkeyHex || !privateKeyHex || !signer) {
    return null;
  }

  const ownFallback = truncateNpub(pubkeyToNpub(pubkeyHex));

  const profileMap: Record<string, MemberProfile> = {
    [pubkeyHex]: {
      pubkeyHex,
      nickname: ownProfile.nickname || ownFallback,
      avatar: ownProfile.avatar,
      updatedAt: new Date().toISOString(),
    },
    [MAINTAINER_ACTIVE_PUBKEY_HEX]: {
      pubkeyHex: MAINTAINER_ACTIVE_PUBKEY_HEX,
      nickname: MAINTAINER_DISPLAY_NAME,
      avatar: null,
      updatedAt: new Date().toISOString(),
    },
  };

  return (
    <>
      <Head>
        <title>{`${copy.feedback.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="feedback-page">
        <NextLink href="/settings" passHref legacyBehavior>
          <Button as="a" variant="ghost" size="sm" mb={2}>
            ←
          </Button>
        </NextLink>
        <Heading as="h1" size="xl" mb={1}>
          {copy.feedback.pageTitle}
        </Heading>
        <Text color="textMuted" fontSize="sm" mb={4}>
          {copy.feedback.encryptedSubtitle}
        </Text>
        <ContactChat
          peerPubkeyHex={MAINTAINER_ACTIVE_PUBKEY_HEX}
          pubkeyHex={pubkeyHex}
          privateKeyHex={privateKeyHex}
          signer={signer}
          profileMap={profileMap}
          source="feedback"
          composerPlaceholder={copy.feedback.composerPlaceholder}
        />
      </Box>
    </>
  );
}
