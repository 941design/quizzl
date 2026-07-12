import React, { useSyncExternalStore, useState, useCallback } from 'react';
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
import { useDynamicBanner, shouldRenderScrim, resolveScrimColor } from '@/src/hooks/useDynamicBanner';
import { useAppTheme } from '@/src/hooks/useMoodTheme';
import ThemeIcon from '@/src/components/ThemeIcon';
import NotificationBell from '@/src/components/NotificationBell';
import DirectMessageNotificationsWatcher from '@/src/components/DirectMessageNotificationsWatcher';
import PendingPairingIntentWatcher from '@/src/components/PendingPairingIntentWatcher';
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
  const { profile } = useProfile();
  const { pubkeyHex, backedUp } = useNostrIdentity();
  const { groups, ready } = useMarmot();
  const copy = useCopy();
  const { isOpen, onToggle } = useDisclosure();
  const { navStyle, surfaceStyle, bannerDecorStyle, contentPanelStyle } = useThemeStyles();
  const { activeThemeDefinition, hydrated } = useAppTheme();
  // Measure the banner box's rendered size the moment it mounts, so the dynamic
  // banner SVG is generated at exactly that size (1:1) rather than an image
  // stretched to fit. For the dynamic-banner theme the box covers the WHOLE
  // header (see the full-cover override below), so this is the header's size.
  // A ref callback (not a mount effect) is used so the measure fires when the
  // box actually appears — i.e. AFTER `hydrated` gates it in below.
  // Regenerate-on-load only: a later window resize is intentionally NOT
  // remeasured (the banner then stretches until the next load).
  const [bannerSize, setBannerSize] = useState<{ width: number; height: number } | undefined>(undefined);
  const measureBanner = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      const r = el.getBoundingClientRect();
      setBannerSize({ width: Math.round(r.width), height: Math.round(r.height) });
    }
  }, []);
  const dynamicBanner = useDynamicBanner(activeThemeDefinition, bannerSize);
  const activeBanner = dynamicBanner ?? bannerDecorStyle;
  // AC-A11Y-1/AC-A11Y-2 (S4): legibility scrim behind the nav logo. Gated on
  // the SAME declaration-based hasDynamicBanner semantic S3 established (see
  // shouldRenderScrim's docstring) — never on generation success, so the
  // scrim doesn't flicker off during a generation-failure window. Colors.brand
  // index 5 is the 500 shade (SCALE_STEPS in buildChakraTheme.ts: 50,100,...,900),
  // i.e. the same value the logo Text below resolves via Chakra's `brand.500`
  // token for the CURRENTLY active theme (brand.500 is theme-specific, not a
  // fixed app-wide color — see resolveScrimColor's docstring).
  const showNavLogoScrim = shouldRenderScrim(dynamicBanner?.hasDynamicBanner ?? false);
  const navLogoScrimColor = resolveScrimColor(activeThemeDefinition.colors.brand[5]);

  // AC-INVITE-8: reactive pending invitation count for Groups nav badge
  const pendingInvitations = useSyncExternalStore(
    subscribePendingInvitations,
    getPendingInvitationsSnapshot,
    getPendingInvitationsServerSnapshot,
  );
  const pendingInvitationCount = pendingInvitations.length;

  const navItems = [
    { label: copy.layout.nav.contacts, href: '/contacts', icon: 'contacts' },
    { label: copy.layout.nav.groups, href: '/groups', icon: 'groups' },
  ];

  React.useEffect(() => {
    if (!ready) return;
    rememberContactsFromGroups(groups, pubkeyHex);
  }, [groups, pubkeyHex, ready]);

  return (
    // Flex column + a growing <main> pins the footer to the bottom of the
    // viewport even when the page content is short (sticky-footer pattern).
    <Box minH="100vh" bg="appBg" display="flex" flexDirection="column">
      <DirectMessageNotificationsWatcher />
      <PendingPairingIntentWatcher />
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
        {/* Gate on `hydrated`: until the saved theme is read from storage the
            app renders the DEFAULT theme (spring), and rendering its banner here
            would flash the wrong theme's art for a beat before the saved
            theme's banner swaps in. Waiting for hydration means the first
            banner shown is already the correct theme's. */}
        {hydrated && activeBanner && (
          <Box
            ref={measureBanner}
            data-testid="nav-banner-decor"
            {...activeBanner.boxProps}
            {...(dynamicBanner?.hasDynamicBanner
              ? // Dynamic-banner theme: the watercolor is the FULL HEADER
                // background, not the small corner box the static themes use.
                // Override the corner-box geometry to cover the whole nav, and
                // composite with `mix-blend-mode: multiply` so the transparent
                // SVG (no paper of its own) multiplies straight onto the real
                // header background exactly once. The SVG is generated at this
                // box's measured size (Layout measures it here), so it fills
                // 1:1 with no stretch. Static-banner themes keep their corner
                // box untouched (they don't enter this branch).
                {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  w: '100%',
                  h: '100%',
                  transform: 'none',
                  sx: { mixBlendMode: 'multiply' },
                }
              : {})}
            style={{ transition: 'background-image 0.3s ease-in-out', ...activeBanner.style }}
          />
        )}
        <Container maxW="container.xl" position="relative" zIndex={1}>
          <Flex h={16} align="center" justify="space-between">
            <NextLink href="/" passHref legacyBehavior>
              <Link _hover={{ textDecoration: 'none' }}>
                {showNavLogoScrim ? (
                  // AC-A11Y-1: opaque scrim, fully occludes the banner behind
                  // it — the only free variable left is navLogoScrimColor vs
                  // brand.500, proven >= 4.5:1 by resolveScrimColor's
                  // black-or-white guarantee (see its docstring).
                  <Box
                    data-testid="nav-logo-scrim"
                    display="inline-block"
                    bg={navLogoScrimColor}
                    px={2}
                    py={1}
                    borderRadius="md"
                  >
                    <Text fontWeight="bold" fontSize="lg" color="brand.500">
                      {copy.appName}
                    </Text>
                  </Box>
                ) : (
                  // AC-A11Y-2: static-only themes render exactly as before —
                  // no scrim, no wrapping Box, no layout change.
                  <Text fontWeight="bold" fontSize="lg" color="brand.500">
                    {copy.appName}
                  </Text>
                )}
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
                          aria-label={item.label}
                          fontWeight={isActive ? 'semibold' : 'normal'}
                          color={isActive ? 'brand.500' : 'textMuted'}
                          _hover={{ color: 'brand.500', textDecoration: 'none' }}
                          aria-current={isActive ? 'page' : undefined}
                          position="relative"
                          display="inline-flex"
                          alignItems="center"
                          gap={1}
                        >
                          <ThemeIcon name={item.icon} size={20} aria-hidden />
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
              <NextLink href="/info" passHref legacyBehavior>
                <Link
                  aria-label={copy.layout.nav.info}
                  display="inline-flex"
                  alignItems="center"
                  justifyContent="center"
                  w={10}
                  h={10}
                  borderRadius="md"
                  position="relative"
                  color={router.pathname === '/info' ? 'brand.500' : 'textMuted'}
                  _hover={{ bg: 'surfaceMutedBg', textDecoration: 'none' }}
                  _focusVisible={{ boxShadow: 'outline' }}
                  data-testid="header-info-link"
                >
                  <ThemeIcon name="info" size={20} aria-hidden />
                </Link>
              </NextLink>
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
              <NotificationBell />
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
                      size="sm"
                    />
                  </Box>
                </Link>
              </NextLink>
            </HStack>

            {/* Mobile actions */}
            <HStack spacing={1} display={{ base: 'flex', md: 'none' }}>
              <NotificationBell />
              <NextLink href="/info" passHref legacyBehavior>
                <Link
                  aria-label={copy.layout.nav.info}
                  display="inline-flex"
                  alignItems="center"
                  justifyContent="center"
                  w={10}
                  h={10}
                  borderRadius="md"
                  position="relative"
                  color={router.pathname === '/info' ? 'brand.500' : 'textMuted'}
                  _hover={{ bg: 'surfaceMutedBg', textDecoration: 'none' }}
                  _focusVisible={{ boxShadow: 'outline' }}
                  data-testid="mobile-header-info-link"
                >
                  <ThemeIcon name="info" size={20} aria-hidden />
                </Link>
              </NextLink>
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
        <Container maxW="container.xl" py={8} as="main" flex="1">
          <Box data-testid="content-panel" {...contentPanelStyle} {...surfaceStyle}>
            <StorageWarning />
            {children}
          </Box>
        </Container>
      ) : (
        <Container maxW="container.xl" py={8} as="main" flex="1" {...surfaceStyle}>
          <StorageWarning />
          {children}
        </Container>
      )}

      {/* Footer — legal links at the very bottom of every page */}
      <Box as="footer" borderTopWidth="1px" borderTopColor="borderSubtle" py={4}>
        <Container maxW="container.xl">
          <Flex justify="center">
            <NextLink href="/imprint" passHref legacyBehavior>
              <Link
                fontSize="sm"
                color="textMuted"
                _hover={{ color: 'brand.500', textDecoration: 'underline' }}
                data-testid="footer-imprint-link"
              >
                {copy.layout.imprintLink}
              </Link>
            </NextLink>
          </Flex>
        </Container>
      </Box>
    </Box>
  );
}
