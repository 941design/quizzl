/**
 * ReactionBadgeRow — renders the horizontal row of reaction badges below a message bubble.
 *
 * One badge per unique emoji in the aggregates array.
 * - Shows emoji glyph + count (count omitted when count === 1 per spec §1.2).
 * - Own-reaction highlight: selfReacted=true → brand.50 bg + brand.300 border.
 * - Click toggles: selfReacted → onReact(..., 'remove'); !selfReacted → onReact(..., 'add').
 * - Hover shows Chakra Tooltip listing reactor display names / truncated npubs.
 *
 * data-testid discipline (AC-49, AC-50):
 * - Badge button: reaction-badge-{messageId}-{emoji}
 * - Count span: reaction-count-{messageId}-{emoji}
 * - Tooltip: reaction-tooltip-{messageId}-{emoji}
 *
 * i18n: all user-visible strings via useCopy() (AC-66).
 * Module boundary: no ChatStoreContext or useDirectReactions imports (AC-55).
 */

import React, { useMemo } from 'react';
import { Box, Flex, Tooltip } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import type { ReactionAggregate } from '@/src/lib/reactions/api';
import type { ChatMessage } from '@/src/lib/marmot/chatPersistence';
import type { MemberProfile } from '@/src/types';
import { truncateNpub, pubkeyToNpub } from '@/src/lib/nostrKeys';
import { selfReactedStyle, formatReactorList } from '@/src/lib/reactions/reactionUiHelpers';

type Props = {
  messageId: string;
  message: ChatMessage;
  aggregates: ReactionAggregate[];
  onReact: (emoji: string, message: ChatMessage, op: 'add' | 'remove') => Promise<void>;
  /**
   * Profile map for display name resolution in the reactor tooltip.
   * Keys are hex pubkeys; nickname is used when present.
   */
  profileMap: Record<string, MemberProfile>;
  /**
   * Self pubkey used to label the current user as "you" in the reactor tooltip.
   * Passed from ChatBox (which receives it via the pubkey prop).
   */
  selfPubkey: string;
};

export default function ReactionBadgeRow({
  messageId,
  message,
  aggregates,
  onReact,
  profileMap,
  selfPubkey,
}: Props) {
  const copy = useCopy();

  // Build a display-name lookup Map from the profileMap prop.
  // This is synchronous — profile lookups are already in-memory.
  const displayNameCache = useMemo(() => {
    const cache = new Map<string, string>();
    for (const [pubkeyHex, profile] of Object.entries(profileMap)) {
      if (profile?.nickname) {
        cache.set(pubkeyHex, profile.nickname);
      }
    }
    return cache;
  }, [profileMap]);

  if (aggregates.length === 0) return null;

  return (
    <Flex gap={1} mt={1} flexWrap="wrap" aria-label={copy.emoji.reactors}>
      {aggregates.map((agg) => {
        const style = selfReactedStyle(agg.selfReacted);

        // Build aria-label: "👍 3" (reactionCount key) — AC-65
        const countLabel = agg.count > 1
          ? `${agg.emoji} ${agg.count} ${copy.emoji.reactionCount}`
          : agg.emoji;

        // Build tooltip content: comma-separated reactor names — AC-53
        const tooltipLabel = formatReactorList(
          agg.reactors,
          displayNameCache,
          selfPubkey,
        );

        // Fallback: if display name cache misses, use truncated npub
        const tooltipContent = tooltipLabel || agg.reactors
          .map((pk) => truncateNpub(pubkeyToNpub(pk)))
          .join(', ');

        const op: 'add' | 'remove' = agg.selfReacted ? 'remove' : 'add';

        return (
          <Tooltip
            key={agg.emoji}
            label={tooltipContent}
            aria-label={`${copy.emoji.reactors}: ${tooltipContent}`}
            placement="top"
            hasArrow
            data-testid={`reaction-tooltip-${messageId}-${agg.emoji}`}
          >
            <Box
              as="button"
              data-testid={`reaction-badge-${messageId}-${agg.emoji}`}
              aria-label={countLabel}
              onClick={() => {
                void onReact(agg.emoji, message, op).catch(() => {
                  // Failure is handled by the onReact owner, which silently rolls
                  // back the optimistic reaction (no user-facing notice).
                });
              }}
              px={1.5}
              py={0.5}
              borderRadius="full"
              fontSize="xs"
              bg={style.bg}
              borderWidth={style.borderWidth}
              borderColor={style.borderColor}
              _hover={{ opacity: 0.8 }}
              cursor="pointer"
              display="flex"
              alignItems="center"
              gap={0.5}
              lineHeight="1"
            >
              <Box as="span" fontSize="sm">{agg.emoji}</Box>
              {agg.count > 1 && (
                <Box
                  as="span"
                  data-testid={`reaction-count-${messageId}-${agg.emoji}`}
                  fontSize="xs"
                  fontWeight="medium"
                  color={agg.selfReacted ? 'brand.700' : 'text'}
                >
                  {agg.count}
                </Box>
              )}
            </Box>
          </Tooltip>
        );
      })}
    </Flex>
  );
}
