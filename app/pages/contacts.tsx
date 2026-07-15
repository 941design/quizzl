import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { useRouter } from 'next/router';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Heading,
  HStack,
  IconButton,
  LinkBox,
  LinkOverlay,
  Text,
  VStack,
} from '@chakra-ui/react';
import ThemeIcon from '@/src/components/ThemeIcon';
import ProfileSummary from '@/src/components/ProfileSummary';
import ContactChat from '@/src/components/contacts/ContactChat';
import BlockContactButton from '@/src/components/contacts/BlockContactButton';
import PendingConfirmationPrompt from '@/src/components/contacts/PendingConfirmationPrompt';
// Voice/video calls are gated behind the CALLS_ENABLED feature toggle.
import { ContactCallToolbar } from '@/src/components/calls/CallToolbar';
import { CALLS_ENABLED } from '@/src/config/features';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useProfile } from '@/src/context/ProfileContext';
import { commonGroups, confirmContact, getContact, listContacts, rememberContactsFromGroups } from '@/src/lib/contacts';
import { isMaintainerPubkey } from '@/src/config/maintainer';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import type { MemberProfile, UserProfile } from '@/src/types';

function ContactListView() {
  const copy = useCopy();
  const router = useRouter();
  const { pubkeyHex } = useNostrIdentity();
  const { groups, ready } = useMarmot();
  const [showHidden, setShowHidden] = useState(false);
  // Revision counter forces a re-read of localStorage after rememberContactsFromGroups runs.
  const [contactsRevision, setContactsRevision] = useState(0);

  // Keep the contacts list in sync with current group membership.
  // Layout.tsx also calls rememberContactsFromGroups, but its useEffect may not
  // have fired yet when this component first renders (e.g. immediately after a
  // group join). Calling it here ensures the contacts store is up-to-date before
  // we derive the list, and the revision bump causes the memos to re-read.
  useEffect(() => {
    if (!ready) return;
    rememberContactsFromGroups(groups, pubkeyHex);
    setContactsRevision((r) => r + 1);
  }, [groups, pubkeyHex, ready]);

  const contacts = useMemo(
    () => listContacts(pubkeyHex, { includeArchived: showHidden }).filter(
      (contact) => !isMaintainerPubkey(contact.pubkeyHex),
    ),
    // contactsRevision ensures a re-read after rememberContactsFromGroups writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubkeyHex, showHidden, contactsRevision],
  );
  const hiddenCount = useMemo(
    () => listContacts(pubkeyHex, { includeArchived: true })
      .filter((contact) => !isMaintainerPubkey(contact.pubkeyHex))
      .filter((contact) => contact.isArchived).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubkeyHex, contactsRevision],
  );
  const hasAnyContacts = contacts.length > 0 || hiddenCount > 0;

  // Epic: pending-contact-confirmation, S2 (AC-UX-1). Confirms a pending
  // contact directly from the list row, then bumps the existing
  // `contactsRevision` counter (already used to re-derive `listContacts`
  // after `rememberContactsFromGroups`) so the badge/row re-renders in the
  // same session — no new revision counter needed here, unlike the detail
  // view's `ContactDetailView` below.
  //
  // Gate-remediation (Codex P2, 2026-07-15): deliberately calls
  // `confirmContact` directly instead of `PendingConfirmationPrompt`'s
  // `confirmPendingContact` (which also runs
  // `reconcileConfirmedContactDirectMessageCount`) — this list row never
  // mounts `ContactChat` afterward, so there is no reason to reconcile the
  // bell here at all; AC-OBS-1/AC-OBS-2 already guarantee it was never
  // incorrectly bumped while pending, and it simply catches up the next
  // time the user actually opens the conversation (ContactChat's own
  // mount-time `loadMessages` + `markDirectMessagesRead`).
  //
  // (Historical note: at the time this list-path fix landed,
  // `reconcileConfirmedContactDirectMessageCount` itself routed through
  // `chatPersistence.ts#loadMessages`, whose one-time-per-thread self-heal
  // side effect this list row could never consume — that was a second,
  // independent bug, since fixed directly in
  // `reconcileConfirmedContactDirectMessageCount` by switching it to a raw
  // idb-keyval read. See that function's doc comment in unreadStore.ts.
  // Skipping the call here remains correct regardless, since this row has
  // no use for reconciliation in the first place.)
  //
  // Gate-remediation (2026-07-15, finding G): this handler is a plain
  // synchronous function, not `async` — both `confirmContact` and
  // `setContactsRevision` are synchronous, so there was never anything to
  // await. A prior version was declared `async` with a dead
  // `if (!pubkeyHex) return;` guard (a residue of an earlier call shape that
  // once needed the signed-in user's own pubkey); that guard silently
  // no-op'd the whole confirm action whenever identity state had not yet
  // hydrated. Dropped both — the guard was never load-bearing since
  // `peerPubkeyHex` (the confirm target) is unrelated to `pubkeyHex` (the
  // local user).
  function handleConfirmFromList(peerPubkeyHex: string) {
    confirmContact(peerPubkeyHex);
    setContactsRevision((r) => r + 1);
  }

  return (
    <>
      <Head>
        <title>{`${copy.contacts.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="contacts-page">
        <Box mb={6}>
          <Heading as="h1" size="xl" mb={2}>
            {copy.contacts.heading}
          </Heading>
        </Box>

        {!hasAnyContacts ? (
          <Alert
            status="info"
            borderRadius="md"
            flexDirection="column"
            alignItems="flex-start"
            gap={2}
            data-testid="contacts-empty-state"
          >
            <AlertIcon />
            <Box>
              <Text fontWeight="semibold">{copy.contacts.emptyTitle}</Text>
              <AlertDescription>
                <Text>{copy.contacts.emptyBody}</Text>
              </AlertDescription>
            </Box>
          </Alert>
        ) : contacts.length === 0 ? (
          <Alert status="info" borderRadius="md" data-testid="contacts-hidden-state">
            <AlertIcon />
            <AlertDescription>{copy.contacts.hiddenOnlyBody(hiddenCount)}</AlertDescription>
          </Alert>
        ) : (
          <VStack spacing={3} align="stretch" data-testid="contacts-list">
            {contacts.map((contact) => {
              const fallbackName = truncateNpub(pubkeyToNpub(contact.pubkeyHex));
              const profile: UserProfile = {
                nickname: contact.nickname,
                avatar: contact.avatar,
              };
              const sharedGroupNames = commonGroups(groups, contact.pubkeyHex).map((group) => group.name);
              return (
                <LinkBox
                  as="article"
                  key={contact.pubkeyHex}
                  p={4}
                  borderWidth="1px"
                  borderRadius="lg"
                  borderColor="borderSubtle"
                  bg="surfaceBg"
                  cursor="pointer"
                  _hover={{ borderColor: 'brand.400', bg: 'surfaceMutedBg' }}
                  transition="all 0.15s"
                  data-testid={`contact-card-${contact.pubkeyHex}`}
                >
                  <Flex align="center" gap={3}>
                    <Box flex="1" minW={0}>
                      <NextLink href={`/contacts?id=${contact.pubkeyHex}`} passHref legacyBehavior>
                        <LinkOverlay>
                          <ProfileSummary profile={profile} fallbackName={fallbackName} size="sm" />
                        </LinkOverlay>
                      </NextLink>
                      {sharedGroupNames.length > 0 ? (
                        <Text
                          mt={1}
                          fontSize="xs"
                          color="textMuted"
                          noOfLines={1}
                          data-testid={`contact-common-groups-${contact.pubkeyHex}`}
                        >
                          {copy.contacts.commonGroups(sharedGroupNames)}
                        </Text>
                      ) : null}
                    </Box>
                    {contact.isArchived ? (
                      <Badge colorScheme="gray" flexShrink={0}>
                        {copy.contacts.hiddenBadge}
                      </Badge>
                    ) : null}
                    {/* Epic: pending-contact-confirmation, S2 (AC-UX-1).
                        Gate-remediation (2026-07-15, finding B): gated on
                        `!contact.isArchived` per spec.md Design Decision 9
                        ("blocked always wins over pending") — a contact CAN
                        be both pending and blocked at once, and DD-9 names
                        that combination as the EXPECTED post-decline state:
                        blocking is this epic's only decline mechanism (there
                        is no separate "reject" action, spec.md Non-Goals),
                        so a user who just blocked a pending contact to
                        decline them would otherwise be shown a live
                        "Confirm contact" button — an un-decline affordance
                        DD-9's precedence forbids. The detail view below and
                        the group-invite picker
                        (`contacts.ts#selectableContactsForGroup`) already
                        resolve blocked+pending to the blocked outcome; this
                        list row must match both. */}
                    {contact.isPendingConfirmation && !contact.isArchived ? (
                      <>
                        <Badge colorScheme="purple" flexShrink={0} data-testid={`contact-pending-badge-${contact.pubkeyHex}`}>
                          {copy.contacts.pendingBadge}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          flexShrink={0}
                          data-testid={`contact-pending-confirm-${contact.pubkeyHex}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleConfirmFromList(contact.pubkeyHex);
                          }}
                        >
                          {copy.contacts.pendingConfirmButton}
                        </Button>
                      </>
                    ) : null}
                    <IconButton
                      aria-label={copy.profile.viewProfile}
                      icon={<ThemeIcon name="person" size={18} />}
                      variant="ghost"
                      size="sm"
                      flexShrink={0}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        router.push(`/profile?pubkey=${contact.pubkeyHex}`);
                      }}
                    />
                  </Flex>
                </LinkBox>
              );
            })}
          </VStack>
        )}

        {hasAnyContacts ? (
          <Box mt={6} pt={4} borderTopWidth="1px" borderColor="borderSubtle">
            <Text mb={2} fontWeight="medium">
              {copy.contacts.hiddenFilterLabel}
            </Text>
            <HStack spacing={4} flexWrap="wrap" data-testid="contacts-hidden-filter">
              <Button
                variant={showHidden ? 'outline' : 'solid'}
                onClick={() => setShowHidden(false)}
                data-testid="contacts-filter-hide-hidden"
                size="lg"
              >
                {copy.contacts.hideHiddenOption}
              </Button>
              <Button
                variant={showHidden ? 'solid' : 'outline'}
                onClick={() => setShowHidden(true)}
                data-testid="contacts-filter-show-hidden"
                size="lg"
              >
                {copy.contacts.showHiddenOption(hiddenCount)}
              </Button>
            </HStack>
          </Box>
        ) : null}
      </Box>
    </>
  );
}

function ContactDetailView({ contactPubkeyHex }: { contactPubkeyHex: string }) {
  const copy = useCopy();
  const router = useRouter();
  // `?added=1` is set by the /add deep-link page after a successful card add
  // (it redirects here instead of showing its own success screen). Surface the
  // green "Contact added" confirmation on this, the selected-contact view.
  const justAdded = router.query.added === '1';
  // Epic: contact-pairing-code, story S4 (AC-SCAN-4). `?pairing=sent|pending`
  // is set by /add.tsx exactly when a pairing-ack echo was attempted for this
  // add (v2 code, unexpired). Neither value implies A has admitted yet — no
  // ack-of-ack exists — so this MUST show honesty copy ("reciprocation in
  // flight"), never a "connected"/"paired" claim. Copy TEXT is S5's; this
  // story only wires the key and the trigger condition.
  const pairingEchoInFlight = router.query.pairing === 'sent' || router.query.pairing === 'pending';
  const { pubkeyHex, privateKeyHex } = useNostrIdentity();
  const { profile: ownProfile } = useProfile();
  // blockedPeersRevision (epic: block-contact, S1) in the dependency array:
  // any block/unblock action bumps this revision (notifyBlockedPeersChanged),
  // so `contact.isArchived` re-derives reactively within the SAME mounted
  // tree, without requiring a route change. This is what makes AC-VIEW-14's
  // "transition an open ContactChat to the Blocked state, tearing down its
  // live subscriptions" hold generically: if this contact somehow gets
  // blocked while its (non-archived) ContactChat is still mounted here, the
  // very next render swaps ContactChat out for the Blocked banner below,
  // and React's own unmount lifecycle stops ContactChat's live subs (its
  // effect cleanup already does this on any unmount) — no manual teardown
  // hook into ContactChat is needed. Symmetrically, an Unblock action taken
  // from the Blocked banner's own button (below) re-derives `contact` the
  // same way, swapping back to ContactChat without a page navigation.
  const { blockedPeersRevision } = useMarmot();
  // Epic: pending-contact-confirmation, S2 (AC-UX-2). Mirrors
  // `blockedPeersRevision` above, but local rather than MarmotContext-hosted
  // — this epic's only reactive consumer of pending-confirmation state is
  // this component (the bell gate in directMessageNotifications.ts reads the
  // predicate live at message-arrival time, not via React state), and
  // MarmotContext.tsx is outside this story's scope. Bumped by
  // `PendingConfirmationPrompt`'s `onConfirmed` callback after
  // `confirmContact` + the bell reconciliation resolve, so `contact` below
  // re-derives within the same mounted session — no navigation away and back.
  const [pendingConfirmationRevision, setPendingConfirmationRevision] = useState(0);
  const contact = useMemo(
    () => getContact(contactPubkeyHex, pubkeyHex, { includeArchived: true }),
    [contactPubkeyHex, pubkeyHex, blockedPeersRevision, pendingConfirmationRevision],
  );
  const signer = useMemo(
    () => (privateKeyHex ? createPrivateKeySigner(privateKeyHex) : null),
    [privateKeyHex],
  );

  if (!contact) {
    return (
      <Box data-testid="contact-detail-not-found">
        <Alert status="warning" borderRadius="md">
          <AlertIcon />
          <AlertDescription>
            {copy.contacts.contactNotFound}{' '}
            <NextLink href="/contacts" passHref legacyBehavior>
              <Button as="a" variant="link" size="sm">
                {copy.contacts.backToContacts}
              </Button>
            </NextLink>
          </AlertDescription>
        </Alert>
      </Box>
    );
  }

  if (!pubkeyHex || !privateKeyHex || !signer) {
    return null;
  }

  const fallbackName = truncateNpub(pubkeyToNpub(contact.pubkeyHex));
  const displayName = contact.nickname || fallbackName || copy.contacts.profileNameFallback;
  const profileMap: Record<string, MemberProfile> = {
    [pubkeyHex]: {
      pubkeyHex,
      nickname: ownProfile.nickname || truncateNpub(pubkeyToNpub(pubkeyHex)),
      avatar: ownProfile.avatar,
      updatedAt: new Date().toISOString(),
    },
    [contact.pubkeyHex]: {
      pubkeyHex: contact.pubkeyHex,
      nickname: contact.nickname || fallbackName,
      avatar: contact.avatar,
      updatedAt: contact.updatedAt ?? contact.lastSeenAt,
    },
  };

  return (
    <>
      <Head>
        <title>{`${displayName} - ${copy.contacts.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="contact-detail-page">
        <NextLink href="/contacts" passHref legacyBehavior>
          <Button as="a" variant="ghost" size="sm" mb={2}>
            ← {copy.contacts.backToContacts}
          </Button>
        </NextLink>
        <Flex align={{ base: 'start', md: 'center' }} justify="space-between" gap={3} wrap="wrap">
          <Box>
            <Heading as="h1" size="xl">
              {displayName}
            </Heading>
          </Box>
          <HStack spacing={2}>
            {/* Voice/video call icons — rendered only while the call feature
                is enabled (CALLS_ENABLED); feature code retained when off. */}
            {CALLS_ENABLED && <ContactCallToolbar peerPubkeyHex={contact.pubkeyHex} />}
            {/* Link to the contact's profile — same affordance as the
                contacts-list row's view-profile icon. */}
            <IconButton
              aria-label={copy.profile.viewProfile}
              icon={<ThemeIcon name="person" size={18} />}
              variant="ghost"
              size="sm"
              flexShrink={0}
              data-testid="contact-detail-view-profile"
              onClick={() => router.push(`/profile?pubkey=${contact.pubkeyHex}`)}
            />
          </HStack>
        </Flex>
        {justAdded ? (
          <Alert status="success" borderRadius="md" mt={4} data-testid="contact-added-success">
            <AlertIcon />
            <AlertDescription>
              {pairingEchoInFlight ? copy.contacts.addContactPairingInFlight : copy.contacts.addContactSuccess}
            </AlertDescription>
          </Alert>
        ) : null}
        {contact.isArchived ? (
          // AC-VIEW-1/7 (epic: block-contact, S4): the Blocked banner + Unblock
          // affordance renders INSTEAD OF ContactChat's composer — ContactChat
          // is not mounted at all in this branch, so none of the five send
          // affordances (text, image, paste, drag-drop, reactions) can ever
          // reach the DOM while blocked. This is decided synchronously on
          // first render (no async fetch gates it), so a direct navigation to
          // /contacts?id=<blockedPeerHex> renders this branch immediately,
          // with no intermediate composer frame (AC-VIEW-7).
          //
          // Epic: pending-contact-confirmation, S2 (AC-UX-2, spec.md Design
          // Decision 9): this branch is checked FIRST, ahead of
          // `isPendingConfirmation` below — blocked always wins over pending,
          // so a contact that is both archived and pending still renders the
          // existing Blocked banner, never the confirmation prompt.
          <>
            <Alert status="info" borderRadius="md" mt={4} data-testid="contact-archived-alert">
              <AlertIcon />
              <AlertDescription>{copy.contacts.archivedDetailNotice}</AlertDescription>
            </Alert>
            <Box mt={4}>
              <BlockContactButton
                peerPubkeyHex={contact.pubkeyHex}
                isArchived
                onChanged={() => { /* blockedPeersRevision bump already drives the re-derive above */ }}
                testId="contact-detail-unblock"
              />
            </Box>
          </>
        ) : contact.isPendingConfirmation ? (
          // AC-UX-2: a pending, non-blocked contact shows the confirmation
          // prompt IN PLACE OF ContactChat — ContactChat is not mounted at
          // all in this branch either (matching the archived-branch
          // precedent above), which is also why `markDirectMessagesRead`
          // (fired from inside ContactChat on mount) correctly does not fire
          // for a still-pending contact.
          <PendingConfirmationPrompt
            contact={contact}
            ownPubkeyHex={pubkeyHex}
            displayName={displayName}
            onConfirmed={() => setPendingConfirmationRevision((r) => r + 1)}
          />
        ) : (
          <>
            <Divider my={6} />
            <Box>
              <ContactChat
                peerPubkeyHex={contact.pubkeyHex}
                pubkeyHex={pubkeyHex}
                privateKeyHex={privateKeyHex}
                signer={signer}
                profileMap={profileMap}
              />
            </Box>
          </>
        )}
      </Box>
    </>
  );
}

export default function ContactsPage() {
  const router = useRouter();
  // router.query.id is string | string[] | undefined — for a repeated query
  // param (?id=a&id=b) it is an array. Normalize to the first value so the
  // maintainer check below never calls hex.toLowerCase() on an array.
  const rawId = router.query.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  // Maintainer keys are reserved for the feedback channel and must not be
  // reachable as an ordinary contact chat (spec §2.7). A contact record can
  // exist (a reply called rememberContact), so a direct /contacts?id=<maintainer>
  // URL would otherwise render ContactDetailView and send DMs WITHOUT the sealed
  // feedback marker tags. Redirect such IDs to the feedback surface.
  useEffect(() => {
    if (id && isMaintainerPubkey(id)) {
      router.replace('/feedback');
    }
  }, [id, router]);

  if (id) {
    if (isMaintainerPubkey(id)) {
      // Render nothing while the redirect effect runs — never the ordinary chat.
      return null;
    }
    return <ContactDetailView contactPubkeyHex={id} />;
  }

  return <ContactListView />;
}
