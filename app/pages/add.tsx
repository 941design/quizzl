import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { useRouter } from 'next/router';
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
import { useProfile } from '@/src/context/ProfileContext';
import { readLocationHash, resolveAddDeepLink, type AddDeepLinkOutcome } from '@/src/lib/addDeepLink';
import { attemptOrQueuePairingEcho, type PendingIntentSendContext } from '@/src/lib/pairing/pendingIntent';

/**
 * Builds the lazy NDK/signer-resolving send context `attemptOrQueuePairingEcho`
 * needs (epic: contact-pairing-code, story S4). Module-level and pure over its
 * params — shared by both call sites below (the fresh-add path and the
 * review-remediated already_exists/returning-scanner path) so the
 * `resolveSendDeps` closure is written once, not duplicated.
 */
function buildPendingIntentSendContext(
  ownPubkeyHex: string,
  ownPrivateKeyHex: string,
  nickname: string,
): PendingIntentSendContext {
  return {
    ownPubkeyHex,
    ownPrivateKeyHex,
    ownProfile: { nickname, createdAt: Math.floor(Date.now() / 1000) },
    resolveSendDeps: async () => {
      const [{ connectNdk }, { activeEventSignerOverride, createPrivateKeySigner }] = await Promise.all([
        import('@/src/lib/ndkClient'),
        import('@/src/lib/marmot/signerAdapter'),
      ]);
      const ndk = await connectNdk(ownPrivateKeyHex);
      const signer = activeEventSignerOverride.current ?? createPrivateKeySigner(ownPrivateKeyHex);
      return { ndk, signEvent: signer.signEvent };
    },
  };
}

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
 *
 * On a SUCCESSFUL add this page is not a visible stop: it `router.replace`s
 * straight to `/contacts?id=<pubkeyHex>&added=1`, selecting the just-added
 * contact and letting the contacts page render the green "Contact added"
 * confirmation. `replace` (not `push`) keeps `/add` out of history, so it is
 * omitted as an intermediary. Only the non-success outcomes (no card / parse
 * or add error) remain rendered here, where there is no contact to navigate to.
 *
 * Epic: contact-pairing-code, story S4 (RD-7). When the scanned card carries
 * an unexpired `pairing` field (`processContactInput`'s `pairingEcho`
 * candidate), this page is also the scanner-side reciprocation trigger: a
 * named scanner echoes immediately (AC-SCAN-1/8, still redirecting to
 * `/contacts`, now carrying `&pairing=sent|pending` for the honesty-copy
 * wiring on that page) and a nameless one is redirected to `/profile?pairing=1`
 * instead (AC-SCAN-5) — the pending intent is durably persisted first
 * (`pendingIntent.ts#attemptOrQueuePairingEcho`), so the redirect never risks
 * losing the echo.
 */
export default function AddPage(): JSX.Element {
  const copy = useCopy();
  const router = useRouter();
  const { hydrated, pubkeyHex, privateKeyHex } = useNostrIdentity();
  const { profile } = useProfile();
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
    if (result.state === 'awaiting_identity') return;
    settledRef.current = true;
    if (result.state !== 'complete') return;

    if (result.ok) {
      // Mirrors AddContactModal.tsx's handleAdd — bump the revision so the
      // always-mounted watchers refresh their cached knownPeers ref
      // immediately instead of waiting for an unrelated change.
      notifyKnownPeersChanged();

      // Epic: contact-pairing-code, story S4 (RD-7). A v2 code with an
      // unexpired pairing field carries a reciprocation candidate —
      // `processContactInput`'s pure decision, computed above. Route it
      // through the SAME persist-then-attempt core the retry queue uses
      // (attemptOrQueuePairingEcho), so an interrupted send can never be
      // lost (AC-SCAN-3): the intent is durably persisted before this
      // effect ever awaits the network.
      const pairingEcho = result.pairingEcho;
      if (pairingEcho && pubkeyHex && privateKeyHex) {
        const ctx = buildPendingIntentSendContext(pubkeyHex, privateKeyHex, profile.nickname);
        void attemptOrQueuePairingEcho(pairingEcho, ctx)
          .catch(() => 'queued-for-retry' as const)
          .then((status) => {
            if (status === 'deferred') {
              // AC-SCAN-5: nameless scanner — route to name setup BEFORE
              // landing on the issuer's contact. The intent is already
              // durably persisted; the deferred echo fires automatically
              // once a name is saved (profile.tsx's saveProfile
              // chokepoint, AC-SCAN-6) or on a later online/mount drain.
              router.replace(`/profile?pairing=1&issuer=${pairingEcho.issuerPubkeyHex}`);
            } else if (status === 'expired') {
              // The card's expiresAt lapsed in the moments between the
              // synchronous parse and this async attempt (an extremely
              // narrow race) — degrade exactly like AC-SCAN-2's plain
              // expired-code path: no pairing query param, no honesty copy.
              router.replace(`/contacts?id=${result.pubkeyHex}&added=1`);
            } else {
              // 'sent' | 'queued-for-retry' — the add itself already
              // succeeded regardless of echo outcome; a failed send
              // retries later (AC-SCAN-3) and never blocks this UX.
              router.replace(
                `/contacts?id=${result.pubkeyHex}&added=1&pairing=${status === 'sent' ? 'sent' : 'pending'}`,
              );
            }
          });
      } else {
        // Success is not shown here: hand off to the contacts page with the
        // new contact selected and let it render the green confirmation.
        // `replace` keeps this /add hop out of history (AC: omit intermediary).
        router.replace(`/contacts?id=${result.pubkeyHex}&added=1`);
      }
      return;
    }

    // Review-remediation (sev 5): a RETURNING scanner — `already_exists`
    // because the issuer was already a one-directional contact from before
    // this epic (or from a shared group) — must still reciprocate when the
    // live code they just scanned carries an unexpired pairing field.
    // `result.pairingEcho` is only ever populated here for exactly that
    // branch (processContactInput.ts). Fired in the BACKGROUND, deliberately
    // WITHOUT touching this page's existing already_exists rendering below
    // (the `getErrorMessage('already_exists')` alert stays exactly as it
    // was pre-remediation) — the only visible change is a possible redirect
    // to name setup for a nameless returning scanner, mirroring AC-SCAN-5
    // exactly.
    if (result.error === 'already_exists' && result.pairingEcho && pubkeyHex && privateKeyHex) {
      const pairingEcho = result.pairingEcho;
      const ctx = buildPendingIntentSendContext(pubkeyHex, privateKeyHex, profile.nickname);
      void attemptOrQueuePairingEcho(pairingEcho, ctx)
        .catch(() => 'queued-for-retry' as const)
        .then((status) => {
          if (status === 'deferred') {
            router.replace(`/profile?pairing=1&issuer=${pairingEcho.issuerPubkeyHex}`);
          }
          // 'sent' | 'queued-for-retry' | 'expired' — no redirect, no UX
          // change: the existing already_exists error alert (rendered below)
          // is left completely untouched.
        });
    }
  }, [hydrated, pubkeyHex, privateKeyHex, profile.nickname, notifyKnownPeersChanged, router]);

  function getErrorMessage(errorCode: string | undefined): string {
    switch (errorCode) {
      case 'invalid_npub':
        return copy.contacts.addContactErrorInvalidNpub;
      case 'self':
        return copy.contacts.addContactErrorSelf;
      case 'already_exists':
        return copy.contacts.addContactErrorAlreadyExists;
      case 'unsupported_version':
        return copy.contacts.addContactErrorUnsupportedVersion;
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
  } else if (outcome.state === 'complete' && outcome.ok) {
    // Add succeeded — the effect is navigating to /contacts?id=…&added=1.
    // Show a brief redirecting state rather than a terminal success alert;
    // the green confirmation is rendered on the contacts page.
    body = (
      <VStack spacing={4} py={10} data-testid="add-page-redirecting">
        <Spinner />
        <Text color="textMuted">{copy.add.redirecting}</Text>
      </VStack>
    );
  } else if (outcome.state === 'no_card') {
    body = (
      <Alert status="warning" borderRadius="md" data-testid="add-page-no-card">
        <AlertIcon />
        <AlertDescription>{copy.add.noCard}</AlertDescription>
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
