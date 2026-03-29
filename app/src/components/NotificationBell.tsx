import React, { useRef } from 'react';
import {
  Box,
  Text,
  VStack,
  HStack,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
  PopoverArrow,
  useDisclosure,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { useUnreadCounts, markAsRead, markJoinRequestsRead } from '@/src/lib/unreadStore';
import { useMarmot } from '@/src/context/MarmotContext';
import { useCopy } from '@/src/context/LanguageContext';
import ThemeIcon from '@/src/components/ThemeIcon';

export default function NotificationBell() {
  const { counts, joinRequests, totalUnread } = useUnreadCounts();
  const { groups } = useMarmot();
  const copy = useCopy();
  const { isOpen, onToggle, onClose } = useDisclosure();
  const btnRef = useRef<HTMLButtonElement>(null);

  // Build list of groups with unread messages
  const unreadGroups = groups
    .filter((g) => (counts[g.id] ?? 0) > 0)
    .map((g) => ({ ...g, unread: counts[g.id] }));

  // Build list of groups with pending join requests
  const joinRequestGroups = groups
    .filter((g) => (joinRequests[g.id] ?? 0) > 0)
    .map((g) => ({ ...g, requestCount: joinRequests[g.id] }));

  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      placement="bottom-end"
      initialFocusRef={btnRef}
    >
      <PopoverTrigger>
        <Box
          as="button"
          ref={btnRef}
          onClick={onToggle}
          position="relative"
          display="inline-flex"
          alignItems="center"
          justifyContent="center"
          w={10}
          h={10}
          borderRadius="md"
          color="textMuted"
          _hover={{ bg: 'surfaceMutedBg' }}
          _focusVisible={{ boxShadow: 'outline' }}
          aria-label={copy.layout.notificationsLabel}
          data-testid="notification-bell"
        >
          <ThemeIcon name="bell" size={20} aria-hidden />
          {totalUnread > 0 && (
            <Box
              position="absolute"
              top="1"
              right="1"
              bg="red.500"
              color="white"
              fontSize="2xs"
              fontWeight="bold"
              lineHeight="1"
              minW="16px"
              h="16px"
              borderRadius="full"
              display="flex"
              alignItems="center"
              justifyContent="center"
              px="4px"
              data-testid="notification-badge"
            >
              {totalUnread > 99 ? '99+' : totalUnread}
            </Box>
          )}
        </Box>
      </PopoverTrigger>

      <PopoverContent
        w="280px"
        bg="surfaceBg"
        borderColor="borderSubtle"
        data-testid="notification-dropdown"
      >
        <PopoverArrow bg="surfaceBg" />
        <PopoverBody p={0}>
          {unreadGroups.length === 0 && joinRequestGroups.length === 0 ? (
            <Box p={4} textAlign="center">
              <Text fontSize="sm" color="textMuted">
                {copy.layout.noNotifications}
              </Text>
            </Box>
          ) : (
            <VStack spacing={0} align="stretch">
              {unreadGroups.map((g) => (
                <NextLink
                  key={g.id}
                  href={`/groups?id=${g.id}`}
                  passHref
                  legacyBehavior
                >
                  <HStack
                    as="a"
                    px={4}
                    py={3}
                    spacing={3}
                    _hover={{ bg: 'surfaceMutedBg', textDecoration: 'none' }}
                    cursor="pointer"
                    onClick={() => {
                      markAsRead(g.id);
                      onClose();
                    }}
                    data-testid={`notification-item-${g.id}`}
                  >
                    <Box flex="1" minW={0}>
                      <Text
                        fontSize="sm"
                        fontWeight="semibold"
                        isTruncated
                      >
                        {g.name}
                      </Text>
                      <Text fontSize="xs" color="textMuted">
                        {copy.layout.unreadMessages(g.unread)}
                      </Text>
                    </Box>
                    <Box
                      bg="brand.500"
                      color="white"
                      fontSize="xs"
                      fontWeight="bold"
                      minW="20px"
                      h="20px"
                      borderRadius="full"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      px="6px"
                      flexShrink={0}
                    >
                      {g.unread > 99 ? '99+' : g.unread}
                    </Box>
                  </HStack>
                </NextLink>
              ))}
              {joinRequestGroups.map((g) => (
                <NextLink
                  key={`jr-${g.id}`}
                  href={`/groups?id=${g.id}`}
                  passHref
                  legacyBehavior
                >
                  <HStack
                    as="a"
                    px={4}
                    py={3}
                    spacing={3}
                    _hover={{ bg: 'surfaceMutedBg', textDecoration: 'none' }}
                    cursor="pointer"
                    onClick={() => {
                      markJoinRequestsRead(g.id);
                      onClose();
                    }}
                    data-testid={`notification-join-request-${g.id}`}
                  >
                    <Box flex="1" minW={0}>
                      <Text
                        fontSize="sm"
                        fontWeight="semibold"
                        isTruncated
                      >
                        {g.name}
                      </Text>
                      <Text fontSize="xs" color="textMuted">
                        {copy.layout.joinRequestNotification(g.requestCount)}
                      </Text>
                    </Box>
                    <Box
                      bg="orange.500"
                      color="white"
                      fontSize="xs"
                      fontWeight="bold"
                      minW="20px"
                      h="20px"
                      borderRadius="full"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      px="6px"
                      flexShrink={0}
                    >
                      {g.requestCount > 99 ? '99+' : g.requestCount}
                    </Box>
                  </HStack>
                </NextLink>
              ))}
            </VStack>
          )}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
