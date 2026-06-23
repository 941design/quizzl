import React, { useSyncExternalStore } from 'react';
import {
  Box,
  Flex,
  HStack,
  VStack,
  Link,
  Text,
  Container,
  useDisclosure,
  Collapse,
  IconButton,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { useRouter } from 'next/router';
import { useCopy } from '@/src/context/LanguageContext';
import ProfileSummary from '@/src/components/ProfileSummary';
import { useProfile } from '@/src/context/ProfileContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import { useMarmot } from '@/src/context/MarmotContext';
import StorageWarning from '@/src/components/StorageWarning';
import { useThemeStyles } from '@/src/hooks/useThemeStyles';
import ThemeIcon from '@/src/components/ThemeIcon';
import NotificationBell from '@/src/components/NotificationBell';
import DirectMessageNotificationsWatcher from '@/src/components/DirectMessageNotificationsWatcher';
import { IncomingCallWatcher } from '@/src/components/calls/IncomingCallWatcher';
import { IncomingCallModal } from '@/src/components/calls/IncomingCallModal';
import { CallScreen } from '@/src/components/calls/CallScreen';
import { rememberContactsFromGroups } from '@/src/lib/contacts';
import { subscribe as subscribePendingInvitations, getSnapshot as getPendingInvitationsSnapshot } from '@/src/lib/pendingInvitations';

function getPendingInvitationsServerSnapshot() {
  return [] as ReturnType<typeof getPendingInvitationsSnapshot>;
}

type LayoutProps = {
  children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const { profile, hydrated: profileHydrated } = useProfile();
  const { pubkeyHex, backedUp } = useNostrIdentity();
  // Fresh user (no display name yet): nudge toward setting a name instead of
  // surfacing the meaningless npub. Gated on hydration so a returning user
  // never flashes the prompt before their saved profile loads.
  const promptForName = profileHydrated && !profile.nickname;
  const { groups, ready } = useMarmot();
  const copy = useCopy();
  const { isOpen, onToggle } = useDisclosure();
  const { navStyle, surfaceStyle, bannerDecorStyle, contentPanelStyle } = useThemeStyles();

  // AC-INVITE-8: reactive pending invitation count for Groups nav badge
  const pendingInvitations = useSyncExternalStore(
    subscribePendingInvitations,
    getPendingInvitationsSnapshot,
    getPendingInvitationsServerSnapshot,
  );
  const pendingInvitationCount = pendingInvitations.length;

  const navItems = [
    { label: copy.layout.nav.contacts, href: '/contacts' },
    { label: copy.layout.nav.groups, href: '/groups' },
  ];

  React.useEffect(() => {
    if (!ready) return;
    rememberContactsFromGroups(groups, pubkeyHex);
  }, [groups, pubkeyHex, ready]);

  return (
    <Box minH="100vh" bg="appBg">
      <DirectMessageNotificationsWatcher />
      <IncomingCallWatcher />
      <IncomingCallModal />
      <CallScreen />
      {/* Navigation Bar */}
      <Box
        as="nav"
        bg="surfaceBg"
        borderBottomWidth="1px"
        borderBottomColor="borderSubtle"
        position="sticky"
        top={0}
        zIndex={10}
        aria-label="Main navigation"
        {...navStyle}
      >
        {bannerDecorStyle && (
          <Box
            data-testid="nav-banner-decor"
            {...bannerDecorStyle.boxProps}
            style={bannerDecorStyle.style}
          />
        )}
        <Container maxW="container.xl" position="relative" zIndex={1}>
          <Flex h={16} align="center" justify="space-between">
            <NextLink href="/" passHref legacyBehavior>
              <Link _hover={{ textDecoration: 'none' }}>
                <Text fontWeight="bold" fontSize="lg" color="brand.500">
                  {copy.appName}
                </Text>
              </Link>
            </NextLink>

            {/* Desktop nav */}
            <HStack spacing={6} display={{ base: 'none', md: 'flex' }}>
              <HStack as="ul" spacing={{ base: 2, md: 6 }} listStyleType="none">
                {navItems.map((item) => {
                  const isActive = router.pathname === item.href;
                  const isGroups = item.href === '/groups';
                  const showBadge = isGroups && pendingInvitationCount > 0;
                  return (
                    <Box as="li" key={item.href}>
                      <NextLink href={item.href} passHref legacyBehavior>
                        <Link
                          fontWeight={isActive ? 'semibold' : 'normal'}
                          color={isActive ? 'brand.500' : 'textMuted'}
                          _hover={{ color: 'brand.500', textDecoration: 'none' }}
                          aria-current={isActive ? 'page' : undefined}
                          position="relative"
                          display="inline-flex"
                          alignItems="center"
                          gap={1}
                        >
                          {item.label}
                          {showBadge && (
                            <Box
                              as="span"
                              display="inline-flex"
                              alignItems="center"
                              justifyContent="center"
                              bg="orange.500"
                              color="white"
                              fontSize="2xs"
                              fontWeight="bold"
                              lineHeight="1"
                              minW="16px"
                              h="16px"
                              borderRadius="full"
                              px="4px"
                              data-testid="groups-invitation-badge"
                            >
                              {pendingInvitationCount > 99 ? '99+' : pendingInvitationCount}
                            </Box>
                          )}
                        </Link>
                      </NextLink>
                    </Box>
                  );
                })}
              </HStack>
              <NextLink href="/profile" passHref legacyBehavior>
                <Link _hover={{ textDecoration: 'none' }}>
                  <Box
                    px={2}
                    py={1}
                    borderWidth="1px"
                    borderRadius="full"
                    borderColor="borderSubtle"
                    bg="surfaceMutedBg"
                    data-testid="header-profile-chip"
                  >
                    <ProfileSummary
                      profile={profile}
                      fallbackName={copy.layout.profileNamePlaceholder}
                      promptForName={promptForName}
                      size="sm"
                    />
                  </Box>
                </Link>
              </NextLink>
              <NotificationBell />
              <NextLink href="/settings" passHref legacyBehavior>
                <Link
                  aria-label={copy.layout.nav.settings}
                  display="inline-flex"
                  alignItems="center"
                  justifyContent="center"
                  w={10}
                  h={10}
                  borderRadius="md"
                  position="relative"
                  color={router.pathname === '/settings' ? 'brand.500' : 'textMuted'}
                  _hover={{ bg: 'surfaceMutedBg', textDecoration: 'none' }}
                  _focusVisible={{ boxShadow: 'outline' }}
                  data-testid="header-settings-link"
                >
                  <ThemeIcon name="settings" size={20} aria-hidden />
                  {!backedUp && (
                    <Box
                      as="span"
                      position="absolute"
                      top="6px"
                      right="6px"
                      w="8px"
                      h="8px"
                      borderRadius="full"
                      bg="orange.400"
                      aria-label={copy.layout.backupNeededLabel}
                      data-testid="gear-backup-dot"
                    />
                  )}
                </Link>
              </NextLink>
            </HStack>

            {/* Mobile actions */}
            <HStack spacing={1} display={{ base: 'flex', md: 'none' }}>
              <NotificationBell />
              <NextLink href="/settings" passHref legacyBehavior>
                <Link
                  aria-label={copy.layout.nav.settings}
                  display="inline-flex"
                  alignItems="center"
                  justifyContent="center"
                  w={10}
                  h={10}
                  borderRadius="md"
                  position="relative"
                  color={router.pathname === '/settings' ? 'brand.500' : 'textMuted'}
                  _hover={{ bg: 'surfaceMutedBg', textDecoration: 'none' }}
                  _focusVisible={{ boxShadow: 'outline' }}
                  data-testid="mobile-header-settings-link"
                >
                  <ThemeIcon name="settings" size={20} aria-hidden />
                  {!backedUp && (
                    <Box
                      as="span"
                      position="absolute"
                      top="6px"
                      right="6px"
                      w="8px"
                      h="8px"
                      borderRadius="full"
                      bg="orange.400"
                      data-testid="gear-backup-dot-mobile"
                    />
                  )}
                </Link>
              </NextLink>
              <IconButton
                onClick={onToggle}
                variant="ghost"
                aria-label={copy.layout.mobileMenuLabel}
                data-testid="mobile-menu-btn"
                icon={
                  <Text fontSize="xl" lineHeight="1">
                    {isOpen ? '\u2715' : '\u2630'}
                  </Text>
                }
              />
            </HStack>
          </Flex>

          {/* Mobile nav dropdown */}
          <Collapse in={isOpen} animateOpacity>
            <VStack
              as="ul"
              listStyleType="none"
              spacing={0}
              pb={4}
              display={{ base: 'flex', md: 'none' }}
              data-testid="mobile-nav"
            >
              <Box w="100%" px={3} pb={3}>
                <NextLink href="/profile" passHref legacyBehavior>
                  <Link
                    display="block"
                    mb={3}
                    p={3}
                    borderRadius="lg"
                    bg="surfaceMutedBg"
                    data-testid="mobile-header-profile-chip"
                    _hover={{ textDecoration: 'none' }}
                    onClick={onToggle}
                  >
                    <ProfileSummary
                      profile={profile}
                      fallbackName={copy.layout.profileNamePlaceholder}
                      promptForName={promptForName}
                      size="sm"
                    />
                  </Link>
                </NextLink>
              </Box>
              {navItems.map((item) => {
                const isActive = router.pathname === item.href;
                const isGroups = item.href === '/groups';
                const showBadge = isGroups && pendingInvitationCount > 0;
                return (
                  <Box as="li" key={item.href} w="100%">
                    <NextLink href={item.href} passHref legacyBehavior>
                      <Link
                        display="flex"
                        alignItems="center"
                        gap={2}
                        py={2}
                        px={3}
                        borderRadius="md"
                        fontWeight={isActive ? 'semibold' : 'normal'}
                        color={isActive ? 'brand.500' : 'textMuted'}
                        bg={isActive ? 'surfaceMutedBg' : 'transparent'}
                        _hover={{ bg: 'surfaceMutedBg', textDecoration: 'none' }}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={onToggle}
                      >
                        {item.label}
                        {showBadge && (
                          <Box
                            as="span"
                            display="inline-flex"
                            alignItems="center"
                            justifyContent="center"
                            bg="orange.500"
                            color="white"
                            fontSize="2xs"
                            fontWeight="bold"
                            lineHeight="1"
                            minW="16px"
                            h="16px"
                            borderRadius="full"
                            px="4px"
                            data-testid="groups-invitation-badge-mobile"
                          >
                            {pendingInvitationCount > 99 ? '99+' : pendingInvitationCount}
                          </Box>
                        )}
                      </Link>
                    </NextLink>
                  </Box>
                );
              })}
            </VStack>
          </Collapse>
        </Container>
      </Box>

      {/* Main Content */}
      {contentPanelStyle ? (
        // Dark-background themes (e.g. minecraft) float content on a light
        // GUI panel so dark text tokens stay legible against the backdrop.
        <Container maxW="container.xl" py={8} as="main">
          <Box data-testid="content-panel" {...contentPanelStyle} {...surfaceStyle}>
            <StorageWarning />
            {children}
          </Box>
        </Container>
      ) : (
        <Container maxW="container.xl" py={8} as="main" {...surfaceStyle}>
          <StorageWarning />
          {children}
        </Container>
      )}
    </Box>
  );
}
