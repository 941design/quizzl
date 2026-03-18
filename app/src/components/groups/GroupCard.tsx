import React from 'react';
import {
  Box,
  HStack,
  VStack,
  Text,
  Badge,
  Button,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import type { Group } from '@/src/types';
import { useCopy } from '@/src/context/LanguageContext';

type GroupCardProps = {
  group: Group;
};

export default function GroupCard({ group }: GroupCardProps) {
  const copy = useCopy();
  const memberCount = group.memberPubkeys.length;
  const nearLimit = memberCount >= 45;

  return (
    <Box
      p={4}
      borderWidth="1px"
      borderRadius="lg"
      borderColor="borderSubtle"
      bg="surfaceBg"
      _hover={{ borderColor: 'brand.400', bg: 'surfaceMutedBg' }}
      transition="all 0.15s"
      data-testid={`group-card-${group.id}`}
    >
      <HStack justify="space-between" align="flex-start" flexWrap="wrap" gap={2}>
        <VStack align="flex-start" spacing={1} flex={1} minW={0}>
          <Text fontWeight="semibold" fontSize="md" noOfLines={1}>
            {group.name}
          </Text>
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
        </VStack>

        <NextLink href={`/groups/${group.id}`} passHref legacyBehavior>
          <Button
            as="a"
            size="sm"
            variant="outline"
            data-testid={`group-card-open-${group.id}`}
          >
            Open
          </Button>
        </NextLink>
      </HStack>
    </Box>
  );
}
