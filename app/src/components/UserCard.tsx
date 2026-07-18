import React from 'react';
import {
  Box,
  Button,
  Flex,
  HStack,
  LinkBox,
  LinkOverlay,
  type ButtonProps,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import ProfileSummary from '@/src/components/ProfileSummary';
import type { UserProfile } from '@/src/types';

/**
 * The single card used to present a person across the app — contacts, group
 * members, and pending join requests. Its layout is the contacts-list card:
 * a round avatar + display name on the left (via {@link ProfileSummary}), with
 * status badges and action buttons right-aligned. Callers differ only in which
 * badges/actions they pass and whether the whole card links somewhere.
 *
 * Action buttons must be one of two categories so the affordance reads
 * consistently everywhere: {@link ConfirmButton} for confirming/affirmative
 * actions (Confirm contact, Make admin, Approve) and {@link RejectButton} for
 * rejecting/destructive ones (Cancel invite, Deny). Navigation-only affordances
 * (the view-profile icon) stay neutral ghost buttons and are exempt.
 */

/** Filled brand button — the "confirming" action category. */
export function ConfirmButton(props: ButtonProps) {
  return <Button size="sm" variant="solid" colorScheme="brand" {...props} />;
}

/** Filled danger (red) button — the "rejecting / destructive" action category. */
export function RejectButton(props: ButtonProps) {
  return <Button size="sm" variant="solid" colorScheme="danger" {...props} />;
}

type UserCardProps = {
  profile: UserProfile;
  /** Display name used when the profile has no nickname (truncated npub, "You", …). */
  fallbackName: string;
  /**
   * When set, the whole card becomes a link to this href (the contacts list
   * opens the direct chat). Only a linked card gets the hover highlight and
   * pointer cursor — a non-linked card (member rows, join-request rows) stays
   * visually static so it never implies a click target it does not have.
   */
  href?: string;
  /** `data-testid` for the card container. */
  cardTestId?: string;
  /** Forwarded to ProfileSummary so per-row test hooks survive (e.g. member-name-*). */
  nameTestId?: string;
  avatarTestId?: string;
  /** Secondary line beneath the name (common groups, npub, …). */
  subline?: React.ReactNode;
  /** Right-aligned cluster: status badges followed by action buttons. */
  actions?: React.ReactNode;
  /** Full-width content below the row (e.g. an inline error alert). */
  footer?: React.ReactNode;
  /** Dim the card (e.g. a pending, not-yet-confirmed member). */
  dimmed?: boolean;
};

export default function UserCard({
  profile,
  fallbackName,
  href,
  cardTestId,
  nameTestId,
  avatarTestId,
  subline,
  actions,
  footer,
  dimmed,
}: UserCardProps) {
  const summary = (
    <ProfileSummary
      profile={profile}
      fallbackName={fallbackName}
      size="sm"
      nameTestId={nameTestId}
      avatarTestId={avatarTestId}
    />
  );

  const row = (
    <Flex align="center" gap={3}>
      <Box flex="1" minW={0}>
        {href ? (
          <NextLink href={href} passHref legacyBehavior>
            <LinkOverlay>{summary}</LinkOverlay>
          </NextLink>
        ) : (
          summary
        )}
        {subline}
      </Box>
      {actions ? (
        // position/zIndex keep these controls clickable above LinkOverlay's
        // full-card ::before overlay when the card is a link.
        <HStack
          spacing={2}
          flexShrink={0}
          flexWrap="wrap"
          justify="flex-end"
          position="relative"
          zIndex={1}
        >
          {actions}
        </HStack>
      ) : null}
    </Flex>
  );

  const containerProps = {
    p: 4,
    borderWidth: '1px',
    borderRadius: 'lg',
    borderColor: 'borderSubtle',
    bg: 'surfaceBg',
    opacity: dimmed ? 0.6 : 1,
    'data-testid': cardTestId,
  } as const;

  if (href) {
    return (
      <LinkBox
        as="article"
        {...containerProps}
        cursor="pointer"
        _hover={{ borderColor: 'brand.400', bg: 'surfaceMutedBg' }}
        transition="all 0.15s"
      >
        {row}
        {footer}
      </LinkBox>
    );
  }

  return (
    <Box {...containerProps}>
      {row}
      {footer}
    </Box>
  );
}
