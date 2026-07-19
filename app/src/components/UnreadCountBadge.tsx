import React from 'react';
import { Badge } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';

type UnreadCountBadgeProps = {
  /** Unread message count; the badge renders only when this is > 0. */
  count: number;
  /** `data-testid` for the badge element. */
  testId?: string;
};

/**
 * The unread-message count pill shown on a contact or group list row. Shares one
 * look across both lists and mirrors the notification bell's numeric badge (solid
 * red, capped at 99+). Renders nothing when there is nothing unread, so callers
 * can pass the raw count unconditionally.
 */
export default function UnreadCountBadge({ count, testId }: UnreadCountBadgeProps) {
  const copy = useCopy();
  if (count <= 0) return null;
  return (
    <Badge
      colorScheme="danger"
      variant="solid"
      borderRadius="full"
      minW="20px"
      textAlign="center"
      data-testid={testId}
      aria-label={copy.layout.unreadMessages(count)}
    >
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
