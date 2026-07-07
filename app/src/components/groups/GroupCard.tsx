import React, { useEffect, useState } from 'react';
import {
  Box,
  HStack,
  VStack,
  Text,
  Badge,
  LinkBox,
  LinkOverlay,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import type { Group } from '@/src/types';
import { useCopy } from '@/src/context/LanguageContext';
import { loadMessages } from '@/src/lib/marmot/chatPersistence';
import { formatThreadPreviewText } from '@/src/lib/messageEdits/messageActionUi';

type GroupCardProps = {
  group: Group;
};

export default function GroupCard({ group }: GroupCardProps) {
  const copy = useCopy();
  const memberCount = group.memberPubkeys.length;
  const nearLimit = memberCount >= 45;

  // S6 (epic-feature-request-message-edit-and-delete): AC-LIST-1/AC-LIST-2 —
  // the group list preview reflects an edit to the thread's last message and
  // falls back past a deleted last message (or to the empty state). Loaded
  // once per mount (mirrors AC-LIST-1's DM-ingest-on-open relaxation: this
  // list has no live chatVersion subscription, so the preview refreshes on
  // next view of the groups list, not live while it's open).
  const [previewText, setPreviewText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMessages(group.id)
      .then(({ messages }) => {
        if (cancelled) return;
        setPreviewText(formatThreadPreviewText(messages, {
          emptyText: copy.groups.listPreviewEmpty,
          photoText: copy.groups.listPreviewPhoto,
          structuredText: copy.groups.listPreviewStructured,
        }));
      })
      .catch(() => {
        if (!cancelled) setPreviewText(null);
      });
    return () => {
      cancelled = true;
    };
  }, [group.id, copy.groups.listPreviewEmpty, copy.groups.listPreviewPhoto, copy.groups.listPreviewStructured]);

  return (
    <LinkBox
      as="article"
      p={4}
      borderWidth="1px"
      borderRadius="lg"
      borderColor="borderSubtle"
      bg="surfaceBg"
      cursor="pointer"
      _hover={{ borderColor: 'brand.400', bg: 'surfaceMutedBg' }}
      transition="all 0.15s"
      data-testid={`group-card-${group.id}`}
    >
      <HStack justify="space-between" align="flex-start" flexWrap="wrap" gap={2}>
        <VStack align="flex-start" spacing={1} flex={1} minW={0}>
          <NextLink href={`/groups?id=${group.id}`} passHref legacyBehavior>
            <LinkOverlay>
              <Text fontWeight="semibold" fontSize="md" noOfLines={1}>
                {group.name}
              </Text>
            </LinkOverlay>
          </NextLink>
          <HStack spacing={2}>
            <Badge
              colorScheme={nearLimit ? 'warning' : 'brand'}
              variant="subtle"
              data-testid={`group-member-count-${group.id}`}
            >
              {copy.groups.memberCount(memberCount)}
            </Badge>
            {nearLimit && (
              <Text fontSize="xs" color="textMuted">
                {copy.groups.softLimitWarning}
              </Text>
            )}
          </HStack>
          {previewText !== null && (
            <Text
              fontSize="xs"
              color="textMuted"
              noOfLines={1}
              data-testid={`group-card-preview-${group.id}`}
            >
              {previewText}
            </Text>
          )}
        </VStack>
      </HStack>
    </LinkBox>
  );
}
