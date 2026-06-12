import React, { useState } from 'react';
import {
  VStack,
  HStack,
  Text,
  Code,
  Box,
  Badge,
  Button,
  IconButton,
  Image,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
} from '@chakra-ui/react';
import { useRouter } from 'next/router';
import { useCopy } from '@/src/context/LanguageContext';
import { pubkeyToNpub, truncateNpub } from '@/src/lib/nostrKeys';
import ThemeIcon from '@/src/components/ThemeIcon';
import type { MemberProfile } from '@/src/types';

type MemberListProps = {
  memberPubkeys: string[];
  ownPubkeyHex: string | null;
  memberProfiles?: Record<string, MemberProfile>;
  /** Pubkeys that have confirmed membership (sent a profile in this group) */
  confirmedPubkeys?: Set<string>;
  /** Called when the user confirms cancellation of a pending invite for the given pubkey */
  onCancelInvite?: (pubkey: string) => Promise<void>;
  /** Pubkeys that hold admin role in this group; drives Admin badge and Make-admin eligibility */
  adminPubkeys?: string[];
  /** Whether the current user is an admin; gates all "Make admin" button visibility */
  isCurrentUserAdmin?: boolean;
  /** Called when the user confirms granting admin to a member; only invoked on confirm */
  onMakeAdmin?: (pubkey: string) => Promise<void>;
  /** Hex pubkeys with a pending eviction commit; drives the leave/removal-pending badge */
  pendingRemovalPubkeys?: string[];
};

/** True when `pubkey` is in `adminPubkeys` (case-insensitive). */
export function isRowAdmin(pubkey: string, adminPubkeys?: string[]): boolean {
  return adminPubkeys?.some((pk) => pk.toLowerCase() === pubkey.toLowerCase()) ?? false;
}

/**
 * The single source of truth for "Make admin" button visibility (AC-GRANT-1/3/4).
 * The button renders ONLY when ALL hold:
 *  - the current user is an admin (AC-GRANT-1 — non-admins see no button),
 *  - the row is not already an admin (AC-GRANT-3),
 *  - the row is not the current user (AC-GRANT-3),
 *  - the row is a confirmed member, not pending/unconfirmed (AC-GRANT-4),
 *  - a handler is wired.
 * Exported so the component and its tests bind to the SAME predicate (no shadow copy).
 */
export function computeShowMakeAdmin(opts: {
  isCurrentUserAdmin?: boolean;
  isRowAdmin: boolean;
  isYou: boolean;
  isPending: boolean;
  hasHandler: boolean;
}): boolean {
  return (
    (opts.isCurrentUserAdmin ?? false) &&
    !opts.isRowAdmin &&
    !opts.isYou &&
    !opts.isPending &&
    opts.hasHandler
  );
}

export default function MemberList({
  memberPubkeys,
  ownPubkeyHex,
  memberProfiles,
  confirmedPubkeys,
  onCancelInvite,
  adminPubkeys,
  isCurrentUserAdmin,
  onMakeAdmin,
  pendingRemovalPubkeys,
}: MemberListProps) {
  const copy = useCopy();

  if (memberPubkeys.length === 0) {
    return (
      <Text color="textMuted" fontSize="sm">
        {copy.groups.noMembersYet}
      </Text>
    );
  }

  return (
    <VStack align="stretch" spacing={2}>
      {memberPubkeys.map((pubkey) => {
        const npub = pubkeyToNpub(pubkey);
        const isYou = pubkey === ownPubkeyHex;
        const profile = memberProfiles?.[pubkey];
        const isPending = confirmedPubkeys ? !confirmedPubkeys.has(pubkey) && !isYou : false;
        const rowIsAdmin = isRowAdmin(pubkey, adminPubkeys);
        const isPendingRemoval = pendingRemovalPubkeys?.includes(pubkey) ?? false;
        const showMakeAdmin = computeShowMakeAdmin({
          isCurrentUserAdmin,
          isRowAdmin: rowIsAdmin,
          isYou,
          isPending,
          hasHandler: !!onMakeAdmin,
        });

        return (
          <MemberListItem
            key={pubkey}
            pubkey={pubkey}
            npub={npub}
            isYou={isYou}
            isPending={isPending}
            profile={profile}
            viewProfileLabel={copy.profile.viewProfile}
            pendingLabel={copy.groups.memberPending}
            youLabel={copy.groups.memberYou}
            cancelInviteLabel={copy.groups.cancelInviteButton}
            cancelInviteTitle={copy.groups.cancelInviteTitle}
            cancelInviteBody={copy.groups.cancelInviteBody}
            cancelInviteConfirm={copy.groups.cancelInviteConfirm}
            cancelLabel={copy.groups.cancel}
            onCancelInvite={isPending && !isYou ? onCancelInvite : undefined}
            isRowAdmin={rowIsAdmin}
            adminBadgeLabel={copy.groups.adminBadge}
            isPendingRemoval={isPendingRemoval}
            removalPendingLabel={copy.groups.leavePendingBadge}
            showMakeAdmin={showMakeAdmin}
            makeAdminLabel={copy.groups.makeAdminButton}
            makeAdminTitle={copy.groups.makeAdminTitle}
            makeAdminBody={copy.groups.makeAdminBody}
            makeAdminConfirm={copy.groups.makeAdminConfirm}
            onMakeAdmin={showMakeAdmin ? onMakeAdmin : undefined}
          />
        );
      })}
    </VStack>
  );
}

type MemberListItemProps = {
  pubkey: string;
  npub: string;
  isYou: boolean;
  isPending: boolean;
  profile?: MemberProfile;
  viewProfileLabel: string;
  pendingLabel: string;
  youLabel: string;
  cancelInviteLabel: string;
  cancelInviteTitle: string;
  cancelInviteBody: string;
  cancelInviteConfirm: string;
  cancelLabel: string;
  onCancelInvite?: (pubkey: string) => Promise<void>;
  /** Whether this row's member holds the admin role */
  isRowAdmin?: boolean;
  /** Resolved i18n string for the admin badge */
  adminBadgeLabel?: string;
  /** Whether this row has a pending eviction commit */
  isPendingRemoval?: boolean;
  /** Resolved i18n string for the removal-pending badge (leavePendingBadge copy) */
  removalPendingLabel?: string;
  /** Whether to show the Make admin trigger button on this row */
  showMakeAdmin?: boolean;
  /** Resolved i18n string for the Make admin trigger button */
  makeAdminLabel?: string;
  /** Resolved i18n string for the Make admin dialog title */
  makeAdminTitle?: string;
  /** Resolved i18n string for the Make admin dialog body */
  makeAdminBody?: string;
  /** Resolved i18n string for the Make admin dialog confirm button */
  makeAdminConfirm?: string;
  /** Called only when the user clicks Confirm in the Make admin dialog */
  onMakeAdmin?: (pubkey: string) => Promise<void>;
};

function MemberListItem({
  pubkey,
  npub,
  isYou,
  isPending,
  profile,
  viewProfileLabel,
  pendingLabel,
  youLabel,
  cancelInviteLabel,
  cancelInviteTitle,
  cancelInviteBody,
  cancelInviteConfirm,
  cancelLabel,
  onCancelInvite,
  isRowAdmin,
  adminBadgeLabel,
  isPendingRemoval,
  removalPendingLabel,
  showMakeAdmin,
  makeAdminLabel,
  makeAdminTitle,
  makeAdminBody,
  makeAdminConfirm,
  onMakeAdmin,
}: MemberListItemProps) {
  const router = useRouter();
  const cancelDisclosure = useDisclosure();
  const makeAdminDisclosure = useDisclosure();
  const [isCancelling, setIsCancelling] = useState(false);
  const [isMakingAdmin, setIsMakingAdmin] = useState(false);

  async function handleConfirmCancel() {
    if (!onCancelInvite) return;
    setIsCancelling(true);
    try {
      await onCancelInvite(pubkey);
    } finally {
      setIsCancelling(false);
      cancelDisclosure.onClose();
    }
  }

  async function handleConfirmMakeAdmin() {
    if (!onMakeAdmin) return;
    setIsMakingAdmin(true);
    try {
      await onMakeAdmin(pubkey);
    } finally {
      setIsMakingAdmin(false);
      makeAdminDisclosure.onClose();
    }
  }

  const displayName = profile?.nickname ?? truncateNpub(npub) + '…';

  return (
    <>
      <Box
        p={3}
        borderRadius="md"
        bg="surfaceMutedBg"
        borderWidth="1px"
        borderColor="borderSubtle"
        opacity={isPending ? 0.6 : 1}
        data-testid={`member-item-${pubkey.slice(0, 8)}`}
      >
        <HStack justify="space-between" flexWrap="wrap" gap={2}>
          <HStack spacing={2}>
            {profile?.avatar && (
              <Image
                src={profile.avatar.imageUrl}
                alt={profile.nickname}
                boxSize="28px"
                borderRadius="md"
                objectFit="contain"
                bg="white"
              />
            )}
            {profile?.nickname ? (
              <Text fontSize="sm" fontWeight="medium"
                data-testid={`member-name-${pubkey.slice(0, 8)}`}>
                {profile.nickname}
              </Text>
            ) : (
              <Code
                fontSize="xs"
                bg="transparent"
                userSelect="all"
                data-testid={`member-npub-${pubkey.slice(0, 8)}`}
              >
                {truncateNpub(npub)}
              </Code>
            )}
            {isPending && (
              <Badge
                colorScheme="yellow"
                variant="subtle"
                fontSize="2xs"
                data-testid={`member-pending-${pubkey.slice(0, 8)}`}
              >
                {pendingLabel}
              </Badge>
            )}
            {isRowAdmin && adminBadgeLabel && (
              <Badge
                colorScheme="purple"
                variant="subtle"
                fontSize="2xs"
                data-testid={`admin-badge-${pubkey.slice(0, 8)}`}
              >
                {adminBadgeLabel}
              </Badge>
            )}
            {isPendingRemoval && removalPendingLabel && (
              <Badge
                colorScheme="orange"
                variant="subtle"
                fontSize="2xs"
                data-testid={`removal-pending-${pubkey.slice(0, 8)}`}
              >
                {removalPendingLabel}
              </Badge>
            )}
            <IconButton
              aria-label={viewProfileLabel}
              icon={<ThemeIcon name="person" size={18} />}
              variant="ghost"
              size="xs"
              onClick={() => isYou ? router.push('/settings') : router.push(`/profile?pubkey=${pubkey}`)}
              data-testid={`member-view-profile-${pubkey.slice(0, 8)}`}
            />
          </HStack>
          <HStack spacing={2}>
            {isYou && (
              <Text
                fontSize="xs"
                fontWeight="semibold"
                color="brand.500"
                data-testid="member-you-badge"
              >
                {youLabel}
              </Text>
            )}
            {showMakeAdmin && makeAdminLabel && (
              <Button
                size="xs"
                colorScheme="purple"
                variant="ghost"
                onClick={makeAdminDisclosure.onOpen}
                data-testid={`make-admin-${pubkey.slice(0, 8)}`}
              >
                {makeAdminLabel}
              </Button>
            )}
            {isPending && !isYou && onCancelInvite && (
              <Button
                size="xs"
                colorScheme="red"
                variant="ghost"
                onClick={cancelDisclosure.onOpen}
                data-testid={`cancel-invite-${pubkey.slice(0, 8)}`}
              >
                {cancelInviteLabel}
              </Button>
            )}
          </HStack>
        </HStack>
      </Box>

      <Modal isOpen={cancelDisclosure.isOpen} onClose={cancelDisclosure.onClose} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{cancelInviteTitle}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text fontWeight="medium" mb={2}>{displayName}</Text>
            <Text fontSize="sm" color="textMuted">{cancelInviteBody}</Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={cancelDisclosure.onClose} isDisabled={isCancelling}>
              {cancelLabel}
            </Button>
            <Button
              colorScheme="red"
              onClick={handleConfirmCancel}
              isLoading={isCancelling}
              data-testid={`cancel-invite-confirm-${pubkey.slice(0, 8)}`}
            >
              {cancelInviteConfirm}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={makeAdminDisclosure.isOpen} onClose={makeAdminDisclosure.onClose} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{makeAdminTitle}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text fontWeight="medium" mb={2}>{displayName}</Text>
            <Text fontSize="sm" color="textMuted">{makeAdminBody}</Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={makeAdminDisclosure.onClose} isDisabled={isMakingAdmin}>
              {cancelLabel}
            </Button>
            <Button
              colorScheme="purple"
              onClick={handleConfirmMakeAdmin}
              isLoading={isMakingAdmin}
              data-testid={`make-admin-confirm-${pubkey.slice(0, 8)}`}
            >
              {makeAdminConfirm}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
