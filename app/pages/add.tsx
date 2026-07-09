import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Heading,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { readLocationHash, resolveAddDeepLink, type AddDeepLinkOutcome } from '@/src/lib/addDeepLink';

/**
 * `/add` — static onboarding/deep-link page (epic: contact-card-exchange,
 * story S7). Reads a contact card from `window.location.hash` (fragment,
 * never a query param — DD 9, AC-UX-3) and drives the existing add-contact
 * flow (S4's `processContactInput`, which itself owns the single
 * `parseContactCard` call and S2's `importCard`).
 *
 * A static top-level page (no `[param].tsx` dynamic segment — CLAUDE.md
 * static-export constraint), so it resolves identically on a fresh direct
 * load and on a reload.
 *
 * Two modes (AC-UX-7):
 *   (a) visitor already has a local identity -> the add completes as soon as
 *       the hash is read.
 *   (b) visitor has no local identity yet -> this app auto-generates one on
 *       first mount (NostrIdentityContext; there is no separate onboarding
 *       wizard to route into). The page shows a brief "setting up…" state
 *       until `useNostrIdentity().hydrated` flips true — which is exactly
 *       the moment the auto-generated identity becomes available — then
 *       completes the add. The card is held only in the retained hash/page
 *       state across that wait; it is never transmitted to the server in
 *       either mode (AC-SEC-1).
 */
export default function AddPage(): JSX.Element {
  const copy = useCopy();
  const { hydrated, pubkeyHex } = useNostrIdentity();
  const { notifyKnownPeersChanged } = useMarmot();
  const [outcome, setOutcome] = useState<AddDeepLinkOutcome | null>(null);
  // Guards processContactInput (and therefore parseContactCard, VQ-S7-002)
  // from ever running more than once per page load, even across React
  // StrictMode's double-invoke or repeated hydration-state re-renders.
  const settledRef = useRef(false);

  useEffect(() => {
    // `window` is always defined here in practice — React never runs effects
    // during the static export's build-time prerender pass, so this can only
    // fire client-side. The guard is still explicit (matches this repo's
    // convention, e.g. DirectMessageNotificationsWatcher.tsx) and is what
    // makes `readLocationHash`'s `undefined` branch a real, tested case
    // rather than a check that never differs (VQ-S7-001).
    if (settledRef.current) return;
    const hash = readLocationHash(typeof window === 'undefined' ? undefined : window);
    const result = resolveAddDeepLink(hash, hydrated, pubkeyHex);
    setOutcome(result);
    if (result.state !== 'awaiting_identity') {
      settledRef.current = true;
      if (result.state === 'complete' && result.ok) {
        // Mirrors AddContactModal.tsx's handleAdd — bump the revision so the
        // always-mounted watchers refresh their cached knownPeers ref
        // immediately instead of waiting for an unrelated change.
        notifyKnownPeersChanged();
      }
    }
  }, [hydrated, pubkeyHex, notifyKnownPeersChanged]);

  function getErrorMessage(errorCode: string | undefined): string {
    switch (errorCode) {
      case 'invalid_npub':
        return copy.contacts.addContactErrorInvalidNpub;
      case 'self':
        return copy.contacts.addContactErrorSelf;
      case 'already_exists':
        return copy.contacts.addContactErrorAlreadyExists;
      default:
        return copy.contacts.addContactErrorGeneric;
    }
  }

  let body: JSX.Element;
  if (outcome === null || outcome.state === 'awaiting_identity') {
    body = (
      <VStack spacing={4} py={10} data-testid="add-page-setting-up">
        <Spinner />
        <Text color="textMuted">{copy.add.settingUp}</Text>
      </VStack>
    );
  } else if (outcome.state === 'no_card') {
    body = (
      <Alert status="warning" borderRadius="md" data-testid="add-page-no-card">
        <AlertIcon />
        <AlertDescription>{copy.add.noCard}</AlertDescription>
      </Alert>
    );
  } else if (outcome.ok) {
    body = (
      <Alert status="success" borderRadius="md" data-testid="add-page-success">
        <AlertIcon />
        <AlertDescription>{copy.contacts.addContactSuccess}</AlertDescription>
      </Alert>
    );
  } else {
    body = (
      <Alert status="error" borderRadius="md" data-testid="add-page-error">
        <AlertIcon />
        <AlertDescription>{getErrorMessage(outcome.error)}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Head>
        <title>{`${copy.add.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="add-page" maxW="480px" mx="auto">
        <Heading as="h1" size="lg" mb={4}>
          {copy.add.heading}
        </Heading>
        {body}
        <Box mt={6}>
          <NextLink href="/contacts" passHref legacyBehavior>
            <Button as="a" variant="ghost" size="sm" data-testid="add-page-go-to-contacts">
              {copy.add.goToContacts}
            </Button>
          </NextLink>
        </Box>
      </Box>
    </>
  );
}
